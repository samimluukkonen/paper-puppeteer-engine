import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { build } from 'vite';
import { test } from './fixtures.js';

let consumerScript = '';
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./meshRuntimeHarness.ts', import.meta.url)),
        formats: ['es'],
        fileName: 'mesh-consumer',
      },
    },
  });
  for (const output of Array.isArray(result) ? result : [result])
    if ('output' in output)
      for (const chunk of output.output) if (chunk.type === 'chunk' && chunk.isEntry) consumerScript = chunk.code;
  if (!consumerScript) throw new Error('Missing mesh runtime consumer bundle.');
});

test('native WebGL meshes preserve UVs, alpha and slot order through deformation, facing and disposal', async ({
  page,
}) => {
  await page.route('**/mesh-consumer-host', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Mesh runtime consumer</title>' }),
  );
  await page.route('**/mesh-consumer.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: consumerScript }),
  );
  await page.goto('mesh-consumer-host');
  const result = await page.evaluate(async () => {
    const path = new URL('mesh-consumer.js', location.href).href;
    const api = (await import(/* @vite-ignore */ path)) as typeof import('./meshRuntimeHarness.js');
    return api.sampleSkinnedMeshes();
  });
  const expected = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255],
  ];
  expect(result.bind.colors).toEqual(expected);
  expect(result.loadedImage.colors).toEqual(expected);
  expect(result.posed.colors).toEqual(expected);
  expect(result.reflected.colors).toEqual(expected);
  expect(result.posed.geometry).not.toEqual(result.bind.geometry);
  expect(result.posed.image).not.toEqual(result.bind.image);
  result.faded.colors.forEach((color, i) =>
    color.forEach((channel, j) =>
      expect(Math.abs(channel - (j === 3 ? 255 : expected[i]![j]! / 4))).toBeLessThanOrEqual(1),
    ),
  );
  expect(result.behind.colors[0]).toEqual(expected[0]);
  expect(result.inFront.colors[0]).toEqual(expected[3]);
  expect(result.stableBuffers).toBe(true);
  expect(result.texturesStable).toBe(true);
  expect(result.destroyed).toBe(true);
  expect(result.textureRetained).toBe(true);
  expect(result.remainingObjects).toBe(0);
});
