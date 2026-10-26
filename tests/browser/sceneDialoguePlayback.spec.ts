import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { build } from 'vite';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { sceneTimelineGroup, test, waitForPreviewPaint } from './fixtures.js';

let consumerScript = '';
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./cinematicRuntimeHarness.ts', import.meta.url)),
        formats: ['es'],
        fileName: 'dialogue-consumer',
      },
    },
  });
  for (const output of Array.isArray(result) ? result : [result])
    if ('output' in output)
      for (const chunk of output.output) if (chunk.type === 'chunk' && chunk.isEntry) consumerScript = chunk.code;
  if (!consumerScript) throw new Error('Missing runtime consumer.');
});

test('dialogue preview remains readable through camera/fades, transport, silent scrubbing and portable runtime', async ({
  page,
  context,
}, info) => {
  await page.goto('scene-editor/');
  const scene = parseSceneJson(
    await readFile(new URL('../../public/scenes/dialogue.scene.json', import.meta.url), 'utf8'),
  );
  const spokenText = `Prepare yourself.\n${'Keep your guard up. '.repeat(12)}`;
  scene.dialogue![0]!.text = spokenText;
  // Keep the same multiline line visible throughout zoom/pan and a full fade.
  scene.dialogue![0]!.duration = 2800;
  scene.cameraTracks!.x![1]!.time = 4500;
  scene.cameraTracks!.zoom![1]!.time = 4500;
  scene.transitions = [{ id: 'fade', type: 'fade-out', time: 2500, duration: 1000, color: '#000000' }];
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'dialogue-playback.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(scene)),
  });
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page
    .locator('.scene-stage-toolbar')
    .getByRole('button', { name: 'Preview Through Camera', exact: true })
    .click();
  const time = page.getByLabel('Playhead (s)', { exact: true });
  const canvas = page.locator('#scene-stage-canvas canvas');
  const frame = async (seconds: string) => {
    await time.fill(seconds);
    await waitForPreviewPaint(page);
    return canvas.screenshot();
  };
  const subtitlePixels = async (png: Buffer) =>
    page.evaluate(
      async (data) => {
        const bitmap = await createImageBitmap(await (await fetch(data)).blob());
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
        const drawing = surface.getContext('2d')!;
        drawing.drawImage(bitmap, 0, 0);
        const pixels = drawing.getImageData(0, 0, bitmap.width, bitmap.height).data;
        let count = 0;
        let minX = bitmap.width;
        let minY = bitmap.height;
        let maxX = 0;
        let maxY = 0;
        // Subtitles occupy the bottom safe region; character artwork is above this crop.
        for (let y = Math.floor(bitmap.height * 0.74); y < bitmap.height; y++)
          for (let x = 0; x < bitmap.width; x++) {
            const offset = (y * bitmap.width + x) * 4;
            if (pixels[offset]! > 250 && pixels[offset + 1]! > 250 && pixels[offset + 2]! > 250) {
              count++;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
        bitmap.close();
        return { count, minX, minY, maxX, maxY };
      },
      `data:image/png;base64,${png.toString('base64')}`,
    );
  expect((await subtitlePixels(await frame('1.999'))).count).toBe(0);
  const visible = await subtitlePixels(await frame('2'));
  expect(visible.count).toBeGreaterThan(150);
  const faded = await subtitlePixels(await frame('4'));
  for (const key of ['minX', 'maxX', 'minY', 'maxY'] as const)
    expect(Math.abs(faded[key] - visible[key])).toBeLessThanOrEqual(1);
  expect(faded.count / visible.count).toBeGreaterThan(0.9);
  expect(faded.count / visible.count).toBeLessThan(1.1);
  expect((await subtitlePixels(await frame('4.8'))).count).toBeGreaterThan(150);
  expect((await subtitlePixels(await frame('7.5'))).count).toBe(0);
  expect(await subtitlePixels(await frame('2'))).toEqual(visible);
  await play.click();
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeEnabled();
  await pause.click();
  await waitForPreviewPaint(page);
  const paused = await canvas.screenshot();
  await page.waitForTimeout(100);
  expect(Buffer.compare(paused, await canvas.screenshot())).toBe(0);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await pause.click();
  expect(Number(await time.inputValue())).toBeLessThan(2);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await waitForPreviewPaint(page);
  expect((await subtitlePixels(await canvas.screenshot())).count).toBe(0);
  await frame('3');
  // Audio remains the timeline owner's responsibility; scrubbing itself leaves it stopped.
  await sceneTimelineGroup(page, 'Audio');
  await expect(page.getByText('Audio: ready', { exact: false })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const bytes = await readFile(await (await download).path());
  const consumer = await context.newPage();
  const errors: string[] = [];
  consumer.on('pageerror', (error) => errors.push(error.message));
  await consumer.route('**/dialogue-host', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Dialogue runtime</title>' }),
  );
  await consumer.route('**/dialogue-consumer.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: consumerScript }),
  );
  await consumer.goto(new URL('dialogue-host', info.project.use.baseURL).href);
  const runtime = await consumer.evaluate(
    async (bytes) => {
      const path = new URL('dialogue-consumer.js', location.href).href;
      const api = (await import(/* @vite-ignore */ path)) as typeof import('./cinematicRuntimeHarness.js');
      return api.sampleCinematicPackage(bytes, [1999, 2000, 4000, 4800, 7500, 2000]);
    },
    [...bytes],
  );
  expect(runtime.samples[0]!.dialogue).toBeUndefined();
  expect(runtime.samples[1]!.dialogue).toMatchObject({ speaker: 'Hero', line: { id: 'challenge' } });
  expect(runtime.samples[2]!.subtitle).toMatchObject({
    text: spokenText,
    visible: true,
    depth: 8500,
  });
  expect(runtime.samples[2]!.transition.opacity).toBe(1);
  expect(runtime.samples[2]!.subtitle!.wrappedLines).toBeGreaterThan(2);
  expect(runtime.samples[2]!.subtitle!.width).toBeLessThanOrEqual(864);
  expect(runtime.samples[3]!.dialogue?.speaker).toBe('Friend');
  expect(runtime.samples[4]!.dialogue).toBeUndefined();
  expect(runtime.samples[5]).toEqual(runtime.samples[1]);
  expect(runtime.passiveCues).toEqual([]);
  expect(runtime.remainingObjects).toBe(0);
  expect(runtime.texturesAfterDispose).toBe(runtime.baseline);
  expect(errors).toEqual([]);
  await consumer.close();
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ version: 2, id: 'other', name: 'Other', duration: 8000, actors: [], actions: [] }),
    ),
  });
  expect((await subtitlePixels(await frame('3'))).count).toBe(0);
});
