import { assert, test, vi } from 'vitest';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { requestUrl } from './helpers/requestUrl.js';

const url = 'https://example.test/character.json';
const manifest = {
  version: 1,
  id: 'test',
  rig: 'rig.json',
  defaultSkin: 'default',
  skins: { default: 'skin.json' },
  animations: ['idle.json'],
  textures: {},
};
const files: Record<string, unknown> = {
  'character.json': manifest,
  'rig.json': { version: 1, root: 'root', bones: [{ id: 'root' }] },
  'skin.json': { version: 1, name: 'default', slots: {} },
  'idle.json': { version: 1, name: 'idle', duration: 1000, loop: false, tracks: {} },
};

function waitForAbort(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal.throwIfAborted();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

test.each(['https://cdn.example.test/versions/hero/character.json', ''])(
  'metadata and artwork resolve against the manifest response URL %s, with a custom-I/O fallback',
  async (responseUrl) => {
    const baseUrl = responseUrl || url;
    const redirectedManifest = {
      ...manifest,
      animations: ['../shared/idle.json'],
      poses: ['pose.json'],
      textures: { body: '../art/body.png' },
    };
    const metadata = new Map([
      [new URL('rig.json', baseUrl).href, files['rig.json']],
      [new URL('skin.json', baseUrl).href, files['skin.json']],
      [new URL('../shared/idle.json', baseUrl).href, files['idle.json']],
      [new URL('pose.json', baseUrl).href, { version: 1, name: 'rest', bones: {} }],
    ]);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const resourceUrl = requestUrl(input);
      if (resourceUrl === url) {
        const response = Response.json(redirectedManifest);
        Object.defineProperty(response, 'url', { value: responseUrl });
        return response;
      }
      if (!metadata.has(resourceUrl)) return new Response(null, { status: 404 });
      const response = Response.json(metadata.get(resourceUrl));
      // Redirects of related files must not change the manifest's base URL.
      Object.defineProperty(response, 'url', { value: 'https://storage.example.test/file.json' });
      return response;
    });
    const character = await CharacterLoader.load(url, fetcher);
    assert.deepEqual(
      fetcher.mock.calls.map(([input]) => requestUrl(input)),
      [url, ...metadata.keys()],
    );
    assert.equal(character.baseUrl, baseUrl);
    assert.equal(character.textureUrl('body'), new URL('../art/body.png', baseUrl).href);
    assert.equal(character.animations[0]?.name, 'idle');
    assert.equal(character.poses[0]?.name, 'rest');
  },
);

test('an already aborted load rejects with its reason without fetching', async () => {
  const controller = new AbortController();
  const reason = new Error('canceled');
  controller.abort(reason);
  const fetcher = vi.fn<typeof fetch>();
  const error: unknown = await CharacterLoader.load(url, fetcher, { signal: controller.signal }).catch(
    (error: unknown) => error,
  );
  assert.strictEqual(error, reason);
  assert.equal(fetcher.mock.calls.length, 0);
});

test.each(['manifest', 'related files'])(
  'caller cancellation aborts pending %s with the original reason',
  async (stage) => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const signal = init!.signal!;
      signals.push(signal);
      if (stage === 'related files' && requestUrl(input) === url) return Response.json(manifest);
      return waitForAbort(signal);
    };
    const reason = new Error('session closed');
    const loading = CharacterLoader.load(url, fetcher, { signal: controller.signal });
    const rejected = loading.catch((error: unknown) => error);
    await vi.waitFor(() => assert.equal(signals.length, stage === 'manifest' ? 1 : 4));
    controller.abort(reason);
    assert.strictEqual(await rejected, reason);
    assert.isTrue(signals.every((signal) => signal.aborted && signal.reason === reason));
  },
);

test.each(['http', 'fetch', 'json'])(
  '%s failure cancels sibling requests and retains the original error',
  async (failure) => {
    const signals: AbortSignal[] = [];
    const reason = new Error('connection failed');
    const fetcher: typeof fetch = async (input, init) => {
      if (requestUrl(input) === url) return Response.json(manifest);
      const signal = init!.signal!;
      signals.push(signal);
      if (requestUrl(input).endsWith('rig.json')) {
        if (failure === 'fetch') throw reason;
        return failure === 'http' ? new Response(null, { status: 404 }) : new Response('{invalid');
      }
      return waitForAbort(signal);
    };
    const error: unknown = await CharacterLoader.load(url, fetcher).catch((error: unknown) => error);
    assert.instanceOf(error, Error);
    if (failure === 'fetch') assert.strictEqual(error, reason);
    else if (failure === 'http') assert.match(error.message, /rig.json.*404/);
    else assert.instanceOf(error, SyntaxError);
    assert.equal(signals.length, 3);
    assert.isTrue(signals.every((signal) => signal.aborted && signal.reason === error));
  },
);

test('cancellation during JSON decoding prevents assembly even if custom I/O ignores the signal', async () => {
  const controller = new AbortController();
  let finish!: (data: unknown) => void;
  const response = Response.json(manifest);
  vi.spyOn(response, 'json').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const reason = new Error('decode canceled');
  const rejected = CharacterLoader.load(url, fetcher, { signal: controller.signal }).catch((error: unknown) => error);
  await vi.waitFor(() => assert.isFunction(finish));
  controller.abort(reason);
  finish(manifest);
  assert.strictEqual(await rejected, reason);
  assert.equal(fetcher.mock.calls.length, 1);
});

test('successful custom loads share a request signal and detach caller cancellation afterward', async () => {
  const controller = new AbortController();
  const signals: AbortSignal[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    signals.push(init!.signal!);
    return Response.json(files[new URL(requestUrl(input)).pathname.slice(1)]);
  };
  const character = await CharacterLoader.load(url, fetcher, { signal: controller.signal });
  assert.equal(character.id, 'test');
  assert.equal(character.animations[0]?.name, 'idle');
  assert.equal(signals.length, 4);
  assert.isTrue(signals.every((signal) => signal === signals[0]));
  controller.abort();
  assert.isFalse(signals[0]!.aborted);
});
