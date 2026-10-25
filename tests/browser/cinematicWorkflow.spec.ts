import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type Frame } from '@playwright/test';
import { build } from 'vite';
import { importProjectPackage } from '../../src/devtools/project/projectPackage.js';
import { evaluateCameraAtTime } from '../../src/engine/cameraAnimation.js';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { parallaxPosition, sceneActorDepth, sceneImageDepth } from '../../src/engine/sceneLayers.js';
import { validateScenePackage } from '../../src/engine/ScenePackage.js';
import { evaluateTransitionAtTime } from '../../src/engine/sceneTransitions.js';
import { inspectorControl, test, waitForPreviewPaint } from './fixtures.js';

test.use({ actionTimeout: 15000 });
let consumerScript = '';
test.beforeAll(async () => {
  // Bundle a test-only consumer, including Phaser, against public runtime APIs.
  // Route it locally in both dev/prod tests; no diagnostic entry is shipped in the app.
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./cinematicRuntimeHarness.ts', import.meta.url)),
        formats: ['es'],
        fileName: 'cinematic-consumer',
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs)
    if ('output' in output)
      for (const chunk of output.output) if (chunk.type === 'chunk' && chunk.isEntry) consumerScript = chunk.code;
  if (!consumerScript) throw new Error('Missing cinematic consumer bundle.');
});

test('cinematic project: artwork, layers, Actors, keys, cuts/fades, recovery, export and standalone runtime', async ({
  page,
  context,
}, info) => {
  test.setTimeout(240000);
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name').fill('First cinematic scene');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.getByRole('combobox', { name: 'Existing character', exact: true }).selectOption('demo-puppet');
  await page.getByRole('button', { name: 'Add Existing Character', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Existing character registered');
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const newScene = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await newScene.getByLabel('Scene name').fill('Mountain opening');
  await newScene.getByRole('button', { name: 'Create Scene', exact: true }).click();
  const editor = async (): Promise<Frame> => {
    await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
    const frame = await (await page.locator('iframe:visible').elementHandle())?.contentFrame();
    if (!frame) throw new Error('Missing Scene Editor.');
    await expect(frame.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    return frame;
  };
  let frame = await editor();
  await expect(frame.locator('.scene-inspector details[open]')).toHaveCount(0);
  await frame.locator('.scene-artwork > summary').click();
  for (const [name, width, height, color] of [
    ['sky', 1800, 1000, '#174bc7'],
    ['mountains', 600, 200, '#33aa55'],
    ['tree', 80, 300, '#e02020'],
  ] as const) {
    const png = await page.evaluate(
      async ({ width, height, color }) => {
        const surface = new OffscreenCanvas(width, height);
        const drawing = surface.getContext('2d')!;
        drawing.fillStyle = color;
        drawing.fillRect(0, 0, width, height);
        return [...new Uint8Array(await (await surface.convertToBlob()).arrayBuffer())];
      },
      { width, height, color },
    );
    await frame
      .getByLabel('Import scene artwork')
      .setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(png) });
  }
  await frame.getByLabel('Position X', { exact: true }).fill('280');
  await frame.getByRole('button', { name: 'Apply image transform', exact: true }).click();
  await frame.locator('.scene-layers > summary').click();
  for (const [id, name, parallax, image] of [
    ['layer-1', 'Mountains', '0.2', 'image-2'],
    ['layer-2', 'Foreground', '1.2', 'image-3'],
  ]) {
    await frame.getByRole('button', { name: '+ Add Layer', exact: true }).click();
    await frame.getByLabel(`Name for ${id}`, { exact: true }).fill(name!);
    await frame.getByLabel(`Parallax for ${id}`, { exact: true }).fill(parallax!);
    await frame
      .getByLabel(`Name for ${id}`, { exact: true })
      .locator('..')
      .locator('..')
      .getByRole('button', { name: 'Apply layer', exact: true })
      .click();
    await frame.getByLabel(`Layer for ${image}`, { exact: true }).selectOption(id!);
  }
  await frame.getByRole('button', { name: 'Move Mountains backward', exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await (await inspectorControl(frame, '[data-guide-id="scene-add-actor"]')).click();
    await frame
      .getByRole('dialog', { name: 'Add Actor', exact: true })
      .getByRole('button', { name: 'Add actor', exact: true })
      .click();
    const properties = frame.locator('[data-guide-id="scene-actor-properties"]');
    await properties.locator(':scope > summary').click();
    await frame.getByLabel('Initial X', { exact: true }).fill(String(i * 220 - 110));
    await frame.getByRole('button', { name: 'Apply actor properties', exact: true }).click();
  }
  await frame.getByLabel('Playhead (s)', { exact: true }).fill('0');
  for (const kind of ['move', 'animation', 'cue']) {
    await frame.getByRole('combobox', { name: 'Action type', exact: true }).selectOption(kind);
    await frame.getByRole('button', { name: 'Add action', exact: true }).click();
    const properties = frame.locator('[data-guide-id="scene-action-properties"]');
    if (!(await properties.evaluate((element) => (element as HTMLDetailsElement).open)))
      await properties.locator('summary').click();
    if (kind === 'cue') await frame.getByLabel('Cue name', { exact: true }).fill('cinematic-cue');
    else {
      if (kind === 'move') await frame.getByLabel('Destination X', { exact: true }).fill('180');
      else await frame.getByRole('combobox', { name: 'Animation ID', exact: true }).selectOption('walk');
      await frame.getByLabel('Action duration (seconds)', { exact: true }).fill('4');
    }
    await frame.getByRole('button', { name: 'Apply action properties', exact: true }).click();
  }
  const time = () => frame.getByLabel('Playhead (s)', { exact: true });
  await frame.getByRole('button', { name: 'Set Camera Key', exact: true }).click();
  await frame.locator('.scene-camera > summary').click();
  await time().fill('2');
  await frame.getByLabel('Center X', { exact: true }).fill('100');
  await frame.getByLabel('Camera zoom', { exact: true }).fill('1.4');
  await frame.getByRole('button', { name: 'Apply camera key', exact: true }).click();
  await time().fill('3');
  await frame.getByRole('button', { name: 'Set Camera Cut', exact: true }).click();
  await frame.getByLabel('Center X', { exact: true }).fill('-80');
  await frame.getByLabel('Camera zoom', { exact: true }).fill('1.8');
  await frame.getByRole('button', { name: 'Apply camera key', exact: true }).click();
  await time().fill('0');
  await frame.getByRole('button', { name: 'Add effect', exact: true }).click();
  await time().fill('4');
  await frame.getByRole('combobox', { name: 'Effect type', exact: true }).selectOption('fade-out');
  await frame.getByRole('button', { name: 'Add effect', exact: true }).click();
  await frame.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    frame
      .getByLabel('Scene transitions', { exact: true })
      .getByRole('button', { name: 'Fade out at 4 s', exact: true }),
  ).toHaveCount(0);
  await frame.getByRole('button', { name: 'Redo', exact: true }).click();
  await frame
    .locator('.scene-stage-toolbar')
    .getByRole('button', { name: 'Preview Through Camera', exact: true })
    .click();
  const shot = async (seconds: string) => {
    await time().fill(seconds);
    await waitForPreviewPaint(page);
    return frame.locator('#scene-stage-canvas canvas').screenshot();
  };
  const preview = await shot('0.5');
  await shot('4.5');
  expect(Buffer.compare(preview, await shot('0.5'))).toBe(0);
  await page.screenshot({ path: info.outputPath('first-cinematic-scene.png') });
  await frame.getByRole('button', { name: 'Play', exact: true }).click();
  await frame.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(frame.locator('.scene-preview-error')).toHaveCount(0);
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  await page.reload();
  await page
    .getByRole('dialog', { name: 'Recover unsaved work?', exact: true })
    .getByRole('button', { name: 'Recover Draft', exact: true })
    .click();
  frame = await editor();
  await frame
    .locator('.scene-stage-toolbar')
    .getByRole('button', { name: 'Preview Through Camera', exact: true })
    .click();
  expect(Buffer.compare(preview, await shot('0.5'))).toBe(0);
  const waiting = page.waitForEvent('download');
  await frame.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const bytes = await readFile(await (await waiting).path());
  const portable = await validateScenePackage(decodePackageZip(bytes));
  expect(portable.images?.size).toBe(3);
  expect(portable.definition.actors).toHaveLength(2);
  expect(portable.definition.actors.map((actor) => actor.position.x)).toEqual([-110, 110]);
  expect(portable.definition.transitions).toHaveLength(2);
  expect(portable.definition.cameraTracks?.x).toHaveLength(3);
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const projectBytes = await readFile(await (await projectDownload).path());
  const restored = await importProjectPackage(decodePackageZip(projectBytes));
  expect(restored.scenes.workingScene?.cameraTracks).toEqual(portable.definition.cameraTracks);
  expect(restored.scenes.workingScene?.layers).toEqual(portable.definition.layers);
  await page
    .getByLabel('Import Project', { exact: true })
    .setInputFiles({ name: 'cinematic.project.zip', mimeType: 'application/zip', buffer: projectBytes });
  frame = await editor();
  await frame
    .locator('.scene-stage-toolbar')
    .getByRole('button', { name: 'Preview Through Camera', exact: true })
    .click();
  expect(Buffer.compare(preview, await shot('0.5'))).toBe(0);
  // Independent browser/Phaser consumer loads the exact downloaded package with no editor state.
  const consumer = await context.newPage();
  const consumerErrors: string[] = [];
  consumer.on('pageerror', (error) => consumerErrors.push(error.message));
  await consumer.route('**/cinematic-consumer-host', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cinematic runtime consumer</title>' }),
  );
  await consumer.route('**/cinematic-consumer.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: consumerScript }),
  );
  await consumer.goto(new URL('cinematic-consumer-host', info.project.use.baseURL).href);
  const times = [1000, 4500, 2999.999, 3000, 3000.001, 0, 1000];
  const runtime = await consumer.evaluate(
    async ({ bytes, times }) => {
      const path = new URL('cinematic-consumer.js', location.href).href;
      const api = (await import(/* @vite-ignore */ path)) as typeof import('./cinematicRuntimeHarness.js');
      return api.sampleCinematicPackage(bytes, times);
    },
    { bytes: [...bytes], times },
  );
  expect(runtime.samples[0]).toEqual(runtime.samples.at(-1));
  expect(runtime.played).toEqual(runtime.samples[0]);
  expect(runtime.passiveCues).toEqual([]);
  expect(runtime.playbackCues).toEqual(['cinematic-cue']);
  expect(runtime.textures).toBeGreaterThan(runtime.baseline);
  expect(runtime.texturesAfterDispose).toBe(runtime.baseline);
  expect(runtime.remainingObjects).toBe(0);
  for (const [index, sample] of runtime.samples.entries()) {
    const state = evaluateCameraAtTime(portable.definition, times[index]!);
    expect(sample.camera).toEqual(state);
    expect(sample.transition).toEqual(evaluateTransitionAtTime(portable.definition, times[index]!));
    for (const [i, image] of portable.definition.images!.entries()) {
      const factor = portable.definition.layers!.find(
        (layer) => layer.id === (image.layerId ?? 'background'),
      )!.parallax;
      expect(sample.images[i]).toMatchObject({
        ...parallaxPosition(image.position, factor, state),
        depth: sceneImageDepth(portable.definition, image, i),
      });
    }
    expect(sample.actors.map((actor) => actor.depth)).toEqual(
      portable.definition.actors.map((_, i) => sceneActorDepth(portable.definition, i)),
    );
  }
  expect(consumerErrors).toEqual([]);
  await consumer.close();
});
