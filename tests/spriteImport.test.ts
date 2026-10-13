import nodeAssert from 'node:assert/strict';
import { afterEach, assert, test, vi } from 'vitest';
import { importSprite, inspectSpriteHeader } from '../src/devtools/shared/artwork/spriteImport.js';

function png(width = 32, height = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(30);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
function webp(chunk: 'VP8X' | 'VP8L' | 'VP8 '): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  bytes.set(new TextEncoder().encode(chunk), 12);
  const view = new DataView(bytes.buffer);
  if (chunk === 'VP8X') {
    view.setUint32(16, 10, true);
    bytes[24] = 31;
    bytes[27] = 63;
  } else if (chunk === 'VP8L') {
    bytes[20] = 0x2f;
    bytes[21] = 31;
    bytes[23] = 15;
    bytes[22] = 192;
  } else {
    bytes.set([0x9d, 1, 0x2a], 23);
    view.setUint16(26, 32, true);
    view.setUint16(28, 64, true);
  }
  return bytes;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function decoder(width = 32, height = 64, decode: () => Promise<void> = () => Promise.resolve()) {
  class Image {
    src = '';
    naturalWidth = width;
    naturalHeight = height;
    decode = decode;
  }
  vi.stubGlobal('Image', Image);
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { create, revoke };
}

test.each(['VP8X', 'VP8L', 'VP8 '] as const)('PNG and %s WebP dimensions are checked before decoding', (chunk) => {
  assert.deepEqual(inspectSpriteHeader(png()), { format: 'image/png', width: 32, height: 64 });
  assert.deepEqual(inspectSpriteHeader(webp(chunk)), { format: 'image/webp', width: 32, height: 64 });
  assert.throws(() => inspectSpriteHeader(png(0)), /positive integer/);
  assert.throws(() => inspectSpriteHeader(png(8193)), /Resize/);
  assert.throws(() => inspectSpriteHeader(png(8192, 8192)), /Resize/);
});

test.each([
  ['sprite.png', 'image/png', png()],
  ['sprite.webp', 'image/webp', webp('VP8X')],
  ['sprite.png', '', png()],
] as const)(
  'valid %s is decoded once and retains metadata/binary with idempotent cleanup',
  async (name, type, bytes) => {
    const decode = vi.fn(() => Promise.resolve());
    const { create, revoke } = decoder(32, 64, decode);
    const file = new File([bytes], name, { type });
    const sprite = await importSprite(file, new AbortController().signal);
    assert.equal(sprite.filename, name);
    assert.equal(sprite.bytes, file.size);
    assert.equal(sprite.width, 32);
    assert.equal(sprite.height, 64);
    assert.equal(sprite.blob.type, type || 'image/png');
    assert.equal(sprite.url, 'blob:test');
    assert.equal(decode.mock.calls.length, 1);
    assert.equal(create.mock.calls.length, 1);
    assert.equal(revoke.mock.calls.length, 0);
    sprite.dispose();
    sprite.dispose();
    assert.equal(revoke.mock.calls.length, 1);
    assert.equal(sprite.image.src, '');
  },
);

test('empty, unsupported, corrupt, oversized and mislabeled files reject before URL allocation', async () => {
  const { create } = decoder();
  for (const [file, message] of [
    [new File([], 'empty.png'), /empty/],
    [new File([png()], 'sprite.jpg', { type: 'image/jpeg' }), /Choose a PNG/],
    [new File(['bad data'], 'broken.png'), /not a valid/],
    [new File([png()], 'mislabeled.webp'), /does not match/],
    [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.png'), /10 MiB/],
    [new File([png(10000)], 'big.png'), /Resize/],
  ] as const)
    await nodeAssert.rejects(importSprite(file, new AbortController().signal), message);
  const animated = webp('VP8X');
  animated[20] = 2;
  await nodeAssert.rejects(
    importSprite(new File([animated], 'animated.webp'), new AbortController().signal),
    /Animated WebP/,
  );
  assert.equal(create.mock.calls.length, 0);
});

test('decode errors and mismatched decoded metadata release the object URL', async () => {
  let mocks = decoder(32, 64, () => Promise.reject(new Error('corrupt')));
  await nodeAssert.rejects(importSprite(new File([png()], 'corrupt.png'), new AbortController().signal), /corrupt/);
  assert.equal(mocks.revoke.mock.calls.length, 1);
  vi.restoreAllMocks();
  mocks = decoder(33, 64);
  await nodeAssert.rejects(importSprite(new File([png()], 'bad.png'), new AbortController().signal), /do not match/);
  assert.equal(mocks.revoke.mock.calls.length, 1);
});

test('cancel during decoding releases the URL without waiting for the browser', async () => {
  let decoding!: () => void;
  const started = new Promise<void>((resolve) => {
    decoding = resolve;
  });
  const { revoke } = decoder(32, 64, () => {
    decoding();
    return new Promise(() => {});
  });
  const abort = new AbortController();
  const pending = importSprite(new File([png()], 'sprite.png'), abort.signal);
  await started;
  abort.abort();
  await nodeAssert.rejects(pending, /abort/i);
  assert.equal(revoke.mock.calls.length, 1);
});
