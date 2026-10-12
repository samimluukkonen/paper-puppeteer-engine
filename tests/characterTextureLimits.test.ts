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
      response: new Blob(['artwork']),
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
  const f = fixture({ maxTotalImageBytes: 15 });
  const first = f.image('first');
  const second = f.image('second');
  first.progress(4);
  first.progress(7);
  first.load();
  second.progress(7);
  second.load();
  await vi.waitFor(() => assert.equal(second.complete.mock.calls.length, 1));
  assert.equal(first.complete.mock.calls.length, 1);
  const third = f.image('third');
  third.progress(2);
  assert.match(getCharacterTextureLimitError(third.file)!.message, /15-byte total limit/);
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
  const { budget } = fixture({ maxImageBytes: 3, maxTotalImageBytes: 5 });
  assert.doesNotThrow(() => budget.checkInlineImage('base64', 'data:image/png;base64,Y Q=='));
  assert.doesNotThrow(() => budget.checkInlineImage('percent', 'data:image/png,%89%50%4E'));
  assert.throws(() => budget.checkInlineImage('large', 'data:image/png;base64,YWJjZA=='), /3-byte limit/);
  assert.throws(() => budget.checkInlineImage('total', 'data:image/png,%00%01'), /5-byte total limit/);
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
