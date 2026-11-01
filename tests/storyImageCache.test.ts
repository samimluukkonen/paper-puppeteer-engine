import type Phaser from 'phaser';
import { expect, test, vi } from 'vitest';
import { decodeImage } from '../src/engine/decodeImage.js';
import { SceneImageTextureCache } from '../src/engine/SceneImageTextureCache.js';

vi.mock('../src/engine/decodeImage.js', () => ({ decodeImage: vi.fn() }));

test('current/next background leases decode/upload once and release only after their final consumer', async () => {
  const decoded = {
    image: {} as HTMLImageElement,
    format: 'image/png' as const,
    width: 1,
    height: 1,
    blob: new Blob(),
    url: 'blob:test',
    dispose: vi.fn(),
  };
  vi.mocked(decodeImage).mockResolvedValueOnce(decoded);
  const textures = { addImage: vi.fn(() => true), exists: () => true, remove: vi.fn() };
  const cache = new SceneImageTextureCache({ textures } as unknown as Phaser.Scene);
  const signal = new AbortController().signal;
  const a = await cache.acquire(new Uint8Array([1, 2, 3]), signal);
  const b = await cache.acquire(new Uint8Array([1, 2, 3]), signal);
  expect(a.key).toBe(b.key);
  expect(decodeImage).toHaveBeenCalledOnce();
  expect(textures.addImage).toHaveBeenCalledOnce();
  a.dispose();
  expect(textures.remove).not.toHaveBeenCalled();
  b.dispose();
  await Promise.resolve();
  expect(textures.remove).toHaveBeenCalledOnce();
  expect(decoded.dispose).toHaveBeenCalledOnce();
  cache.dispose();
});

test('cancelled preparation releases late decoded background resources without installing a texture', async () => {
  vi.mocked(decodeImage).mockClear();
  let finish!: (value: Awaited<ReturnType<typeof decodeImage>>) => void;
  vi.mocked(decodeImage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const textures = { addImage: vi.fn(() => true), exists: () => true, remove: vi.fn() };
  const cache = new SceneImageTextureCache({ textures } as unknown as Phaser.Scene);
  const controller = new AbortController();
  const pending = cache.acquire(new Uint8Array([1, 2, 3]), controller.signal);
  void pending.catch(() => {});
  await vi.waitFor(() => expect(decodeImage).toHaveBeenCalledOnce());
  cache.dispose();
  controller.abort();
  const decoded = {
    image: {} as HTMLImageElement,
    format: 'image/png' as const,
    width: 1,
    height: 1,
    blob: new Blob(),
    url: 'blob:test',
    dispose: vi.fn(),
  };
  finish(decoded);
  await expect(pending).rejects.toThrow();
  await Promise.resolve();
  expect(textures.addImage).not.toHaveBeenCalled();
  expect(decoded.dispose).toHaveBeenCalledOnce();
});
