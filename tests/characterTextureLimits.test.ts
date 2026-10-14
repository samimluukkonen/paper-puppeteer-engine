import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import {
  CharacterTextureBudget,
  type CharacterTextureLimitOptions,
  CharacterTextureLimitError,
  getCharacterTextureLimitError,
} from '../src/engine/characterTextureLimits.js';

const PhaserFile = createRequire(import.meta.url)(
  '../node_modules/phaser/src/loader/File.js',
) as typeof Phaser.Loader.File;

function png(width: number, height: number): Blob {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes]);
}

function webp(width = 2, height = 3, chunk: 'VP8X' | 'VP8L' | 'VP8 ' = 'VP8X'): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  bytes.set(new TextEncoder().encode(chunk), 12);
  const view = new DataView(bytes.buffer);
  if (chunk === 'VP8X') {
    view.setUint32(16, 10, true);
    bytes[24] = (width - 1) & 255;
    bytes[25] = ((width - 1) >> 8) & 255;
    bytes[26] = ((width - 1) >> 16) & 255;
    bytes[27] = (height - 1) & 255;
    bytes[28] = ((height - 1) >> 8) & 255;
    bytes[29] = ((height - 1) >> 16) & 255;
  } else if (chunk === 'VP8L') {
    bytes[20] = 0x2f;
    bytes[21] = (width - 1) & 255;
    bytes[22] = (((width - 1) >> 8) & 63) | (((height - 1) & 3) << 6);
    bytes[23] = ((height - 1) >> 2) & 255;
    bytes[24] = ((height - 1) >> 10) & 15;
  } else {
    bytes.set([0x9d, 1, 0x2a], 23);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  }
  return bytes;
}

function fixture(options: CharacterTextureLimitOptions = {}) {
  const budget = new CharacterTextureBudget(options);
  let active = true;
  const loader = Object.assign(new EventEmitter(), {
    localSchemes: [],
    prefix: '',
    path: '',
    nextFile: vi.fn((file: Phaser.Loader.File, success: boolean) => {
      if (success) file.onProcess();
      else loader.emit('loaderror', file);
    }),
  });
  const error = vi.fn();
  loader.on('loaderror', error);
  const image = (key = 'body', dimensions = { naturalWidth: 2, naturalHeight: 3 }) => {
    const file = new PhaserFile(loader as unknown as Phaser.Loader.LoaderPlugin, {
      type: 'image',
      key,
      url: 'https://example.test/body.png',
      cache: false,
    });
    const xhr = {
      response: png(2, 3),
      responseURL: 'https://example.test/body.png',
      readyState: 4,
      status: 200,
      onload: vi.fn(),
      onerror: vi.fn(),
      onprogress: vi.fn(),
      ontimeout: vi.fn(),
      abort: vi.fn(),
    };
    file.xhrLoader = xhr as unknown as XMLHttpRequest;
    const complete = vi.fn();
    const processError = vi.fn();
    const decode = vi.fn(() => {
      file.data = dimensions;
      file.onProcessComplete();
    });
    file.onProcess = decode;
    file.onProcessComplete = complete;
    file.onProcessError = processError;
    budget.guard(file, () => active);
    const load = () => file.onLoad(file.xhrLoader!, { target: xhr } as unknown as ProgressEvent);
    const progress = (loaded: number, total = 0, lengthComputable = false) =>
      file.onProgress({ loaded, total, lengthComputable } as ProgressEvent);
    return { file, xhr, load, progress, decode, complete, processError };
  };
  return {
    image,
    error,
    loader,
    budget,
    cancel: () => {
      active = false;
    },
  };
}

test('unknown-length image transfers are aborted at the byte limit without decoding', () => {
  const f = fixture({ maxImageBytes: 8 });
  const image = f.image();
  image.progress(8);
  image.progress(9);
  assert.equal(image.xhr.abort.mock.calls.length, 1);
  assert.isUndefined(image.xhr.onload);
  assert.isUndefined(image.xhr.onerror);
  assert.isNull(image.xhr.ontimeout);
  assert.equal(f.error.mock.calls.length, 1);
  assert.instanceOf(getCharacterTextureLimitError(image.file), CharacterTextureLimitError);
  assert.match(getCharacterTextureLimitError(image.file)!.message, /8-byte limit/);
  image.load();
  image.progress(100);
  image.file.onError(image.file.xhrLoader!, {} as ProgressEvent);
  assert.equal(image.decode.mock.calls.length, 0);
  assert.equal(image.xhr.abort.mock.calls.length, 1);
});

test('declared image sizes reject before receiving the entire response', () => {
  const f = fixture({ maxImageBytes: 8 });
  const image = f.image();
  image.progress(1, 9, true);
  assert.equal(image.xhr.abort.mock.calls.length, 1);
  assert.equal(image.decode.mock.calls.length, 0);
});

test('final blob sizes are enforced even when progress is absent or misleading', () => {
  const f = fixture({ maxImageBytes: 6 });
  const image = f.image();
  image.progress(1);
  image.load();
  assert.equal(image.xhr.abort.mock.calls.length, 1);
  assert.equal(image.decode.mock.calls.length, 0);
  assert.match(getCharacterTextureLimitError(image.file)!.message, /6-byte limit/);
});

test('total transfer accounting counts incremental progress once across distinct images', async () => {
  const f = fixture({ maxTotalImageBytes: 50 });
  const first = f.image('first');
  const second = f.image('second');
  first.progress(4);
  first.progress(24);
  first.load();
  second.progress(24);
  second.load();
  await vi.waitFor(() => assert.equal(second.complete.mock.calls.length, 1));
  assert.equal(first.complete.mock.calls.length, 1);
  const third = f.image('third');
  third.progress(3);
  assert.match(getCharacterTextureLimitError(third.file)!.message, /50-byte total limit/);
  assert.equal(third.decode.mock.calls.length, 0);
});

test('oversized PNG dimensions are rejected from their header before image decoding', async () => {
  const f = fixture({ maxImagePixels: 10 });
  const image = f.image();
  image.xhr.response = png(4, 3);
  image.load();
  await vi.waitFor(() => assert.equal(image.processError.mock.calls.length, 1));
  assert.equal(image.decode.mock.calls.length, 0);
  assert.equal(image.complete.mock.calls.length, 0);
  assert.match(getCharacterTextureLimitError(image.file)!.message, /10-pixel limit/);
  assert.equal(f.error.mock.calls.length, 1);
});

test('browser decoding failures emit one load error and cannot complete the image', async () => {
  const f = fixture();
  const image = f.image();
  image.decode.mockImplementation(() => image.file.onProcessError());
  image.load();
  await vi.waitFor(() => assert.equal(image.processError.mock.calls.length, 1));
  assert.equal(f.error.mock.calls.length, 1);
  assert.match(getCharacterTextureLimitError(image.file)!.message, /Could not decode image "body"/);
  image.file.onProcessError();
  image.file.onProcessComplete();
  assert.equal(image.processError.mock.calls.length, 1);
  assert.equal(image.complete.mock.calls.length, 0);
  assert.equal(f.error.mock.calls.length, 1);
});

test('cancelled image decoding cannot report a late processing failure', () => {
  const f = fixture();
  const image = f.image();
  f.cancel();
  image.file.onProcessError();
  assert.equal(f.error.mock.calls.length, 0);
  assert.equal(image.processError.mock.calls.length, 0);
});

test.each([
  { label: 'JPEG', bytes: [255, 216, 255, 224, 0, 16] },
  { label: 'GIF', bytes: [...new TextEncoder().encode('GIF89a')] },
  { label: 'WebP', bytes: [...new TextEncoder().encode('RIFF0000WEBP')] },
  { label: 'valid static WebP without allowWebp', bytes: [...webp()] },
  {
    label: 'SVG with a PNG MIME type',
    bytes: [...new TextEncoder().encode('<svg width="90000" height="90000"></svg>')],
  },
  { label: 'truncated PNG', bytes: [137, 80, 78, 71, 13, 10, 26, 10] },
])('$label is rejected before decoding by default', async ({ bytes }) => {
  const f = fixture();
  const image = f.image();
  image.xhr.response = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
  image.load();
  await vi.waitFor(() => assert.equal(image.processError.mock.calls.length, 1));
  assert.equal(image.decode.mock.calls.length, 0);
  assert.equal(image.complete.mock.calls.length, 0);
  assert.match(getCharacterTextureLimitError(image.file)!.message, /PNG header before decoding/);
});

test('uninspectable responses fail before decoding instead of bypassing the format policy', () => {
  const f = fixture();
  const image = f.image();
  image.file.xhrLoader = null;
  image.file.onProcess();
  assert.equal(image.decode.mock.calls.length, 0);
  assert.equal(image.processError.mock.calls.length, 1);
  assert.match(getCharacterTextureLimitError(image.file)!.message, /before decoding/);
});

test('trusted alternative formats explicitly opt out while retaining decoded pixel limits', async () => {
  for (const oversized of [false, true]) {
    const f = fixture({ requirePng: false, maxImagePixels: 10 });
    const image = f.image('body', { naturalWidth: oversized ? 4 : 2, naturalHeight: 3 });
    image.xhr.response = new Blob(['trusted artwork']);
    image.load();
    await vi.waitFor(() => assert.equal(image.decode.mock.calls.length, 1));
    assert.equal(image.complete.mock.calls.length, oversized ? 0 : 1);
    assert.equal(image.processError.mock.calls.length, oversized ? 1 : 0);
    if (oversized) assert.match(getCharacterTextureLimitError(image.file)!.message, /10-pixel limit/);
  }
});

test('trusted WebP keeps the existing opt-out when guarded WebP is not enabled', async () => {
  const f = fixture({ requirePng: false });
  const image = f.image();
  const animated = webp();
  animated[20] = 2;
  image.xhr.response = new Blob([animated]);
  image.load();
  await vi.waitFor(() => assert.equal(image.complete.mock.calls.length, 1));
  assert.equal(image.decode.mock.calls.length, 1);
});

test.each(['VP8X', 'VP8L', 'VP8 '] as const)('allowWebp validates %s headers before decoding', async (chunk) => {
  const f = fixture({ allowWebp: true, maxImagePixels: 10 });
  const image = f.image();
  image.xhr.response = new Blob([webp(2, 3, chunk)]);
  image.load();
  await vi.waitFor(() => assert.equal(image.complete.mock.calls.length, 1));
  assert.equal(image.decode.mock.calls.length, 1);

  const oversized = f.image('oversized');
  oversized.xhr.response = new Blob([webp(4, 3, chunk)]);
  oversized.load();
  await vi.waitFor(() => assert.equal(oversized.processError.mock.calls.length, 1));
  assert.equal(oversized.decode.mock.calls.length, 0);
  assert.match(getCharacterTextureLimitError(oversized.file)!.message, /10-pixel limit/);
});

test('allowWebp enforces cumulative pixels before decoding and never counts a header twice', async () => {
  const f = fixture({ allowWebp: true, maxTotalImagePixels: 12 });
  for (const key of ['first', 'second']) {
    const image = f.image(key);
    image.xhr.response = new Blob([webp()]);
    image.load();
    await vi.waitFor(() => assert.equal(image.complete.mock.calls.length, 1));
  }
  const third = f.image('third');
  third.xhr.response = new Blob([webp()]);
  third.load();
  await vi.waitFor(() => assert.equal(third.processError.mock.calls.length, 1));
  assert.equal(third.decode.mock.calls.length, 0);
  assert.match(getCharacterTextureLimitError(third.file)!.message, /12-pixel total limit/);
});

test('allowWebp rejects animated, malformed, truncated and unsupported headers before decoding', async () => {
  const animated = webp();
  animated[20] = 2;
  const malformed = webp();
  new DataView(malformed.buffer).setUint32(16, 9, true);
  for (const bytes of [animated, malformed, webp().subarray(0, 29), new TextEncoder().encode('GIF89a')]) {
    const f = fixture({ allowWebp: true });
    const image = f.image();
    image.xhr.response = new Blob([bytes]);
    image.load();
    await vi.waitFor(() => assert.equal(image.processError.mock.calls.length, 1));
    assert.equal(image.decode.mock.calls.length, 0);
    assert.equal(image.complete.mock.calls.length, 0);
  }
});

test('allowWebp guards both base64 and percent-encoded inline dimensions before queueing', () => {
  for (const chunk of ['VP8X', 'VP8L', 'VP8 '] as const) {
    const bytes = webp(4, 3, chunk);
    const base64 = Buffer.from(bytes).toString('base64');
    const percent = Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
    for (const url of [`data:image/webp;base64,${base64}`, `data:image/webp,${percent}`]) {
      const { budget } = fixture({ allowWebp: true, maxImagePixels: 10 });
      assert.throws(() => budget.checkInlineImage('body', url), /10-pixel limit/);
    }
  }
});

test('allowWebp never permits uninspectable responses to bypass the pre-decode policy', () => {
  const f = fixture({ allowWebp: true });
  const image = f.image();
  image.file.xhrLoader = null;
  image.file.onProcess();
  assert.equal(image.decode.mock.calls.length, 0);
  assert.equal(image.processError.mock.calls.length, 1);
});

test.each(['yes', 0, null])('invalid allowWebp value %s is rejected', (allowWebp) => {
  assert.throws(
    () => new CharacterTextureBudget({ allowWebp } as unknown as CharacterTextureLimitOptions),
    /allowWebp must be a boolean/,
  );
});

test.each(['yes', 0, null])('invalid requirePng value %s is rejected', (requirePng) => {
  assert.throws(
    () => new CharacterTextureBudget({ requirePng } as unknown as CharacterTextureLimitOptions),
    /requirePng must be a boolean/,
  );
});

test.each([
  { dimensions: { naturalWidth: 8193, naturalHeight: 1 }, message: /dimension limit/ },
  { dimensions: { naturalWidth: 5000, naturalHeight: 5000 }, message: /pixel limit/ },
  { dimensions: { naturalWidth: 0, naturalHeight: 2 }, message: /positive integer/ },
])('decoded $dimensions images cannot enter the texture cache', async ({ dimensions, message }) => {
  const f = fixture();
  const image = f.image('body', dimensions);
  image.load();
  await vi.waitFor(() => assert.equal(image.processError.mock.calls.length, 1));
  assert.equal(image.complete.mock.calls.length, 0);
  assert.match(getCharacterTextureLimitError(image.file)!.message, message);
});

test('total decoded pixels include all images and do not count a PNG header twice', async () => {
  const f = fixture({ maxTotalImagePixels: 12 });
  const first = f.image('first');
  first.xhr.response = png(2, 3);
  first.load();
  await vi.waitFor(() => assert.equal(first.complete.mock.calls.length, 1));
  const second = f.image('second');
  second.load();
  await vi.waitFor(() => assert.equal(second.complete.mock.calls.length, 1));
  const third = f.image('third');
  third.load();
  await vi.waitFor(() => assert.equal(third.processError.mock.calls.length, 1));
  assert.match(getCharacterTextureLimitError(third.file)!.message, /12-pixel total limit/);
});

test('cancellation during header inspection prevents late decoding or failure notifications', async () => {
  const f = fixture();
  const image = f.image();
  let finish!: (buffer: ArrayBuffer) => void;
  const header = new Blob();
  vi.spyOn(header, 'arrayBuffer').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.spyOn(image.xhr.response, 'slice').mockReturnValue(header);
  image.load();
  f.cancel();
  finish(await png(2, 3).arrayBuffer());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(image.decode.mock.calls.length, 0);
  assert.equal(image.processError.mock.calls.length, 0);
  assert.equal(f.error.mock.calls.length, 0);
});

test('inline image byte checks handle base64 padding, whitespace and percent-encoded bytes', () => {
  const { budget } = fixture({ maxImageBytes: 3, maxTotalImageBytes: 5, requirePng: false });
  assert.doesNotThrow(() => budget.checkInlineImage('base64', 'data:image/png;base64,Y Q=='));
  assert.doesNotThrow(() => budget.checkInlineImage('percent', 'data:image/png,%89%50%4E'));
  assert.throws(() => budget.checkInlineImage('large', 'data:image/png;base64,YWJjZA=='), /3-byte limit/);
  assert.throws(() => budget.checkInlineImage('total', 'data:image/png,%00%01'), /5-byte total limit/);
});

test('inline non-PNG content cannot bypass pre-decode checks by claiming a PNG MIME type', () => {
  const bytes = Buffer.from('<svg width="90000" height="90000"></svg>');
  for (const url of [
    `data:image/png;base64,${bytes.toString('base64')}`,
    `data:image/png,${encodeURIComponent(bytes.toString())}`,
  ]) {
    const { budget } = fixture();
    assert.throws(() => budget.checkInlineImage('body', url), /PNG header before decoding/);
  }
});

test('inline PNG dimension checks run before the browser can decode base64 or percent data URLs', async () => {
  const bytes = new Uint8Array(await png(4, 3).arrayBuffer());
  const base64 = Buffer.from(bytes).toString('base64');
  const percent = Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
  for (const url of [`data:image/png;base64,${base64}`, `data:image/png,${percent}`]) {
    const { budget } = fixture({ maxImagePixels: 10 });
    assert.throws(() => budget.checkInlineImage('body', url), /10-pixel limit/);
  }
});
