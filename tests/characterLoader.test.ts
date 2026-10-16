import { assert, expect, test, vi } from 'vitest';
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

test('cancellation during body reading prevents assembly even if custom I/O ignores the signal', async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const reason = new Error('decode canceled');
  const rejected = CharacterLoader.load(url, fetcher, { signal: controller.signal }).catch((error: unknown) => error);
  await vi.waitFor(() => assert.isTrue(response.body!.locked));
  controller.abort(reason);
  assert.strictEqual(await rejected, reason);
  assert.deepEqual(cancel.mock.calls, [[reason]]);
  assert.equal(fetcher.mock.calls.length, 1);
});

test.each([
  ['maxJsonBytes', 0],
  ['maxTotalJsonBytes', -1],
  ['maxResources', Infinity],
  ['concurrency', 1.5],
  ['timeoutMs', 0],
  ['timeoutMs', Infinity],
  ['maxBones', 0],
  ['maxBoneDepth', Infinity],
  ['maxKeyframes', 1.5],
  ['maxEvents', 0],
] as const)('invalid %s is rejected before fetching', async (name, value) => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(CharacterLoader.load(url, fetcher, { [name]: value })).rejects.toThrow(/positive safe integer/);
  assert.equal(fetcher.mock.calls.length, 0);
});

test.each(['maxBones', 'maxBoneDepth'] as const)(
  'loaded rigs enforce configurable %s before assembly',
  async (limit) => {
    const metadata = {
      ...files,
      'rig.json': { version: 1, root: 'root', bones: [{ id: 'root' }, { id: 'child', parent: 'root' }] },
    };
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      Response.json(metadata[new URL(requestUrl(input)).pathname.slice(1) as keyof typeof metadata]),
    );
    await expect(CharacterLoader.load(url, fetcher, { [limit]: 1 })).rejects.toThrow(/limit/);
    assert.equal((await CharacterLoader.load(url, fetcher, { [limit]: 2 })).rig.bones.length, 2);
  },
);

test('keyframe budgets cover the combined rows of all loaded animations', async () => {
  const metadata: Record<string, unknown> = {
    ...files,
    'character.json': { ...manifest, animations: ['idle.json', 'walk.json'] },
    'idle.json': { version: 1, name: 'idle', duration: 1000, loop: false, tracks: { root: [{ time: 0, x: 1 }] } },
    'walk.json': { version: 1, name: 'walk', duration: 1000, loop: false, tracks: { root: [{ time: 0, x: 2 }] } },
  };
  const fetcher = vi.fn<typeof fetch>(async (input) =>
    Response.json(metadata[new URL(requestUrl(input)).pathname.slice(1)]),
  );
  await expect(CharacterLoader.load(url, fetcher, { maxKeyframes: 1 })).rejects.toThrow(/1-keyframe limit/);
  assert.equal((await CharacterLoader.load(url, fetcher, { maxKeyframes: 2 })).animations.length, 2);
});

test('event budgets cover the combined markers of all loaded animations', async () => {
  const metadata: Record<string, unknown> = {
    ...files,
    'character.json': { ...manifest, animations: ['idle.json', 'walk.json'] },
    ...Object.fromEntries(
      ['idle', 'walk'].map((name) => [
        `${name}.json`,
        { version: 1, name, duration: 1000, loop: false, tracks: {}, events: [{ time: 500, name: 'e' }] },
      ]),
    ),
  };
  const fetcher = vi.fn<typeof fetch>(async (input) =>
    Response.json(metadata[new URL(requestUrl(input)).pathname.slice(1)]),
  );
  await expect(CharacterLoader.load(url, fetcher, { maxEvents: 1 })).rejects.toThrow(/1-event limit/);
  assert.equal((await CharacterLoader.load(url, fetcher, { maxEvents: 2 })).animations.length, 2);
});

test('work-budget failures cancel the load before a worker acquires another file', async () => {
  const metadata: Record<string, unknown> = {
    ...files,
    'rig.json': { version: 1, root: 'root', bones: [{ id: 'root' }, { id: 'child', parent: 'root' }] },
  };
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    signals.push(init!.signal!);
    return Response.json(metadata[new URL(requestUrl(input)).pathname.slice(1)]);
  });
  await expect(CharacterLoader.load(url, fetcher, { maxBones: 1, concurrency: 1 })).rejects.toThrow(/1-bone limit/);
  assert.equal(fetcher.mock.calls.length, 2);
  assert.isTrue(signals.every((signal) => signal.aborted));
});

test('compact rigs cannot bypass rendering budgets with a large slot catalog', async () => {
  const rig = {
    version: 1,
    root: 'root',
    bones: [{ id: 'root' }],
    slots: Array.from({ length: 100_000 }, (_, index) => ({ id: `s${index}`, bone: 'root' })),
  };
  const metadata: Record<string, unknown> = { ...files, 'rig.json': rig };
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    signals.push(init!.signal!);
    return Response.json(metadata[new URL(requestUrl(input)).pathname.slice(1)]);
  });
  await expect(CharacterLoader.load(url, fetcher, { concurrency: 1 })).rejects.toThrow(/4096-slot limit/);
  assert.equal(fetcher.mock.calls.length, 2);
  assert.isTrue(signals.every((signal) => signal.aborted));
  rig.slots.length = 2;
  await expect(CharacterLoader.load(url, fetcher, { maxSlots: 1 })).rejects.toThrow(/1-slot limit/);
  assert.equal((await CharacterLoader.load(url, fetcher, { maxSlots: 2 })).rig.slots.length, 2);
});

test('repeated metadata paths cannot amplify assembly past the resource budget', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ ...manifest, animations: Array.from({ length: 10 }, () => 'idle.json') }));
  await expect(CharacterLoader.load(url, fetcher, { maxResources: 4 })).rejects.toThrow(/4-resource limit/);
  assert.equal(fetcher.mock.calls.length, 1);
});

test.each([{}, { body: 'body.png', arm: 'arm.png' }])(
  'resource limits include metadata and texture entries (%j)',
  async (textures) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...manifest, textures }));
    await expect(
      CharacterLoader.load(url, fetcher, { maxResources: Object.keys(textures).length ? 5 : 3 }),
    ).rejects.toThrow(/resource limit/);
    assert.equal(fetcher.mock.calls.length, 1);
  },
);

test('metadata concurrency is bounded and a failure prevents queued requests', async () => {
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (requestUrl(input) === url) return Response.json(manifest);
    signals.push(init!.signal!);
    return waitForAbort(init!.signal!);
  });
  const controller = new AbortController();
  const reason = new Error('stop');
  const rejected = CharacterLoader.load(url, fetcher, { concurrency: 2, signal: controller.signal }).catch(
    (error: unknown) => error,
  );
  await vi.waitFor(() => assert.equal(signals.length, 2));
  assert.equal(fetcher.mock.calls.length, 3);
  controller.abort(reason);
  assert.strictEqual(await rejected, reason);
  assert.equal(fetcher.mock.calls.length, 3);
});

test('workers continue after successful requests and stop dispatching after failure', async () => {
  const fetched: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(requestUrl(input)).pathname.slice(1);
    fetched.push(path);
    return Response.json(files[path]);
  };
  assert.equal((await CharacterLoader.load(url, fetcher, { concurrency: 1 })).id, 'test');
  assert.deepEqual(fetched, Object.keys(files));
  const reason = new Error('rig failed');
  const failing = vi.fn<typeof fetch>(async (input) => {
    if (requestUrl(input) === url) return Response.json(manifest);
    throw reason;
  });
  assert.strictEqual(
    await CharacterLoader.load(url, failing, { concurrency: 1 }).catch((error: unknown) => error),
    reason,
  );
  assert.equal(failing.mock.calls.length, 2);
});

test('per-response and aggregate JSON limits count actual bytes and can be configured', async () => {
  const fetcher: typeof fetch = async (input) => Response.json(files[new URL(requestUrl(input)).pathname.slice(1)]);
  const sizes = Object.values(files).map((data) => new TextEncoder().encode(JSON.stringify(data)).byteLength);
  const largest = Math.max(...sizes);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  await expect(CharacterLoader.load(url, fetcher, { maxJsonBytes: largest - 1 })).rejects.toThrow(/size limit/);
  await expect(
    CharacterLoader.load(url, fetcher, { maxJsonBytes: largest, maxTotalJsonBytes: total - 1 }),
  ).rejects.toThrow(/total size limit/);
  assert.equal(
    (await CharacterLoader.load(url, fetcher, { maxJsonBytes: largest, maxTotalJsonBytes: total, maxResources: 4 })).id,
    'test',
  );
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

test.each(['manifest', 'metadata', 'artwork'])(
  'URL policy rejects disallowed %s URLs before requesting related files',
  async (stage) => {
    const resource = 'http://127.0.0.1/private.json';
    const data = {
      ...manifest,
      ...(stage === 'metadata' ? { rig: resource } : {}),
      ...(stage === 'artwork' ? { textures: { private: resource } } : {}),
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(data));
    const urlPolicy = (candidate: URL): boolean =>
      candidate.protocol === 'https:' && candidate.origin === new URL(url).origin;
    await expect(CharacterLoader.load(stage === 'manifest' ? resource : url, fetcher, { urlPolicy })).rejects.toThrow(
      /rejected by policy/,
    );
    assert.equal(fetcher.mock.calls.length, stage === 'manifest' ? 0 : 1);
  },
);

test('approved loads enforce redirect rejection and check resolved response URLs', async () => {
  const urlPolicy = (candidate: URL): boolean => candidate.origin === new URL(url).origin;
  const fetcher = vi.fn<typeof fetch>(async (input) =>
    Response.json(files[new URL(requestUrl(input)).pathname.slice(1)]),
  );
  assert.equal((await CharacterLoader.load(url, fetcher, { urlPolicy })).id, 'test');
  assert.isTrue(fetcher.mock.calls.every(([, init]) => init?.redirect === 'error'));
  for (const redirected of [true, false]) {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    Object.defineProperties(response, {
      url: { value: 'http://127.0.0.1/private.json' },
      redirected: { value: redirected },
    });
    const rejectedFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(CharacterLoader.load(url, rejectedFetch, { urlPolicy })).rejects.toThrow(
      /redirects are disabled|rejected by policy/,
    );
    assert.equal(rejectedFetch.mock.calls.length, 1);
    assert.equal(cancel.mock.calls.length, 1);
  }
});

test.each(['manifest', 'related files', 'body'])(
  'request timeout cancels pending %s and cleans up timers',
  async (stage) => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const cancel = vi.fn();
      const fetcher: typeof fetch = async (input, init) => {
        const signal = init!.signal!;
        signals.push(signal);
        if (stage !== 'manifest' && requestUrl(input) === url) return Response.json(manifest);
        if (stage === 'body') return new Response(new ReadableStream({ cancel }));
        return waitForAbort(signal);
      };
      const rejected = CharacterLoader.load(url, fetcher, { timeoutMs: 10 }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10);
      const error = await rejected;
      assert.instanceOf(error, DOMException);
      assert.equal(error.name, 'TimeoutError');
      assert.isTrue(signals.every((signal) => signal.aborted && signal.reason === error));
      if (stage === 'body') assert.equal(cancel.mock.calls.length, 3);
      assert.equal(vi.getTimerCount(), 0);
    } finally {
      vi.useRealTimers();
    }
  },
);

test('successful requests clear timeout timers and oversized timer intervals reject before fetching', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      Response.json(files[new URL(requestUrl(input)).pathname.slice(1)]),
    );
    assert.equal((await CharacterLoader.load(url, fetcher, { timeoutMs: 100 })).id, 'test');
    assert.equal(vi.getTimerCount(), 0);
    const count = fetcher.mock.calls.length;
    await expect(CharacterLoader.load(url, fetcher, { timeoutMs: 2_147_483_648 })).rejects.toThrow(/must not exceed/);
    assert.equal(fetcher.mock.calls.length, count);
  } finally {
    vi.useRealTimers();
  }
});
