import { readFile } from 'node:fs/promises';
import { expect, type Frame, type Page } from '@playwright/test';
import { importProjectPackage } from '../../src/devtools/project/projectPackage.js';
import { decodePackageZip, encodePackageZip } from '../../src/engine/packageZip.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../../src/engine/ScenePackage.js';
import { test, waitForPreviewPaint } from './fixtures.js';

test.use({ actionTimeout: 15_000 });
async function imageBytes(page: Page, width: number, height: number, color: string, format = 'image/png') {
  return Buffer.from(
    await page.evaluate(
      async ({ width, height, color, format }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.fillStyle = color;
        context.fillRect(0, 0, width, height);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), format));
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      },
      { width, height, color, format },
    ),
  );
}
async function downloadJson(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
  return parseSceneJson(await readFile(await (await waiting).path(), 'utf8'));
}
async function activeEditor(page: Page): Promise<Frame> {
  const element = await page.locator('iframe:visible').elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error('Missing scene frame.');
  return frame;
}

async function colorCounts(page: Page, png: Buffer) {
  return page.evaluate(
    async (data) => {
      const bitmap = await createImageBitmap(await (await fetch(data)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let blue = 0,
        red = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! < 70 && pixels[i + 1]! < 130 && pixels[i + 2]! > 150) blue++;
        if (pixels[i]! > 150 && pixels[i + 1]! < 100 && pixels[i + 2]! < 100) red++;
      }
      bitmap.close();
      return { blue, red };
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
}

test('background PNG placement, scale handle, zoom/pan, cancellation, playback, history and portable scene export', async ({
  page,
}) => {
  await page.goto('scene-editor/');
  const source = {
    version: 2,
    id: 'forest',
    name: 'Forest',
    duration: 2000,
    actors: [
      {
        id: 'hero',
        character: { manifest: '../characters/demo-puppet/character.json' },
        position: { x: -200, y: 100 },
        animation: 'idle',
      },
    ],
    actions: [{ id: 'walk', type: 'move', actorId: 'hero', time: 0, duration: 1000, destination: { x: 100, y: 100 } }],
  };
  await page
    .getByLabel('Open scene JSON')
    .setInputFiles({ name: 'forest.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page.locator('.scene-artwork summary').click();
  await page
    .getByLabel('Import scene artwork')
    .setInputFiles({ name: 'forest.png', mimeType: 'image/png', buffer: await imageBytes(page, 400, 300, '#174bc7') });
  await expect(page.getByLabel('Scale X', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  const canvas = page.locator('#scene-stage-canvas canvas');
  await waitForPreviewPaint(page);
  const initial = await canvas.screenshot();
  const initialColors = await colorCounts(page, initial);
  expect(initialColors.blue).toBeGreaterThan(1000);
  const box = (await canvas.boundingBox())!;
  const sx = box.width / 1000;
  const sy = box.height / 700;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The bottom-right corner is the artwork scale handle, separate from Actor controls.
  await page.mouse.move(center.x + 200 * sx, center.y + 150 * sy);
  await page.mouse.down();
  await page.mouse.move(center.x + 250 * sx, center.y + 180 * sy, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel('Scale X', { exact: true })).toHaveValue('1.25');
  await expect(page.getByLabel('Scale Y', { exact: true })).toHaveValue('1.2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Scale X', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  // Cancel a placement gesture without consuming its history.
  await page.mouse.move(center.x + 70 * sx, center.y - 40 * sy);
  await page.mouse.down();
  await page.mouse.move(center.x + 120 * sx, center.y - 10 * sy, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByLabel('Position X', { exact: true })).toHaveValue('0');
  // Pointer-anchored zoom and pan still permit image placement in world coordinates.
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -200);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(center.x + 30, center.y + 20);
  await page.mouse.up({ button: 'middle' });
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.mouse.move(center.x + 70 * sx, center.y - 40 * sy);
  await page.mouse.down();
  await page.mouse.move(center.x + 130 * sx, center.y - 10 * sy, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByLabel('Position X', { exact: true }).inputValue()))
    .toBeCloseTo(60, 3);
  await page.getByLabel('Position X', { exact: true }).fill('60');
  await page.getByLabel('Position Y', { exact: true }).fill('25');
  await page.getByRole('button', { name: 'Apply image transform', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Playhead (s)', exact: true }).fill('0.75');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('Scene playback status', { exact: true })).toContainText('playing');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('.scene-preview-error')).toHaveCount(0);
  await page.getByLabel('Visible', { exact: true }).uncheck();
  await waitForPreviewPaint(page);
  expect((await colorCounts(page, await canvas.screenshot())).blue).toBeLessThan(initialColors.blue / 10);
  await page.getByLabel('Visible', { exact: true }).check();
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  const scene = await downloadJson(page);
  expect(scene.actors).toEqual(source.actors);
  expect(scene.actions).toEqual(source.actions);
  expect(scene.images?.[0]).toMatchObject({ position: { x: 60, y: 25 }, scale: { x: 1.25, y: 1.2 }, visible: true });
  expect(JSON.stringify(scene)).not.toContain('blob:');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const packaged = await validateScenePackage(
    decodePackageZip(new Uint8Array(await readFile(await (await waiting).path()))),
  );
  expect(packaged.images?.size).toBe(1);
  expect(packaged.definition.images?.[0]?.image).toBe('images/image-1.png');
  await page.screenshot({ path: test.info().outputPath('scene-artwork.png') });
  await page.reload();
  await page.getByRole('button', { name: 'Recover Draft', exact: true }).click();
  await expect(page).toHaveURL(/project\/.*recover=/);
  await expect(page.getByRole('heading', { name: 'Forest', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const recovered = await activeEditor(page);
  await expect(recovered.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await recovered.locator('.scene-artwork summary').click();
  await recovered.getByRole('button', { name: /forest.png · image-1/ }).click();
  await expect(recovered.getByLabel('Position X', { exact: true })).toHaveValue('60');
  await expect(recovered.locator('.scene-preview-error')).toHaveCount(0);
});

test('existing project images and WebP background survive project export, reopen and playback', async ({ page }) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name').fill('Artwork film');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  const paper = await imageBytes(page, 16, 16, '#ec3939');
  const json = (input: unknown) => new TextEncoder().encode(JSON.stringify(input));
  const files = new Map([
    [
      'character.json',
      json({
        version: 1,
        id: 'hero',
        rig: 'rig.json',
        skins: { default: 'skin.json' },
        defaultSkin: 'default',
        animations: [],
        textures: { paper: 'paper.png' },
      }),
    ],
    ['rig.json', json({ version: 1, root: 'root', bones: [{ id: 'root', sprite: { texture: 'paper' } }] })],
    ['skin.json', json({ version: 1, name: 'default', slots: {} })],
    ['paper.png', new Uint8Array(paper)],
  ]);
  await page
    .getByLabel('Import Character ZIP', { exact: true })
    .setInputFiles({ name: 'hero.zip', mimeType: 'application/zip', buffer: Buffer.from(encodePackageZip(files)) });
  await expect(page.getByRole('status')).toContainText('Character registered.');
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await dialog.getByLabel('Scene name').fill('Forest');
  await dialog.getByRole('button', { name: 'Create Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const frame = await activeEditor(page);
  await frame.getByRole('button', { name: '+ Add Actor', exact: true }).click();
  await frame
    .getByRole('dialog', { name: 'Add Actor', exact: true })
    .getByRole('button', { name: 'Add actor', exact: true })
    .click();
  await frame.locator('.scene-artwork summary').click();
  await frame.getByRole('button', { name: '+ Add Image From Project', exact: true }).click();
  await expect(frame.getByLabel('Project image', { exact: true })).toBeEnabled();
  await frame.getByLabel('Project image', { exact: true }).selectOption({ label: 'hero: paper.png (16 × 16)' });
  await frame.getByLabel('Import scene artwork').setInputFiles({
    name: 'forest.webp',
    mimeType: 'image/webp',
    buffer: await imageBytes(page, 400, 300, '#174bc7', 'image/webp'),
  });
  await frame.getByLabel('Position X', { exact: true }).fill('10');
  await frame.getByRole('button', { name: 'Apply image transform', exact: true }).click();
  await frame.locator('.scene-layers summary').click();
  await frame.getByRole('button', { name: '+ Add Layer', exact: true }).click();
  await frame.getByLabel('Name for layer-1', { exact: true }).fill('Far forest');
  await frame.getByLabel('Parallax for layer-1', { exact: true }).fill('0.5');
  await frame
    .getByLabel('Name for layer-1', { exact: true })
    .locator('..')
    .locator('..')
    .getByRole('button', { name: 'Apply layer' })
    .click();
  await frame.getByLabel('Layer for image-2', { exact: true }).selectOption('layer-1');
  await frame.getByRole('button', { name: 'Move Far forest backward', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  await expect(frame.locator('.scene-preview-error')).toHaveCount(0);
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const buffer = await readFile(await (await waiting).path());
  const archive = decodePackageZip(new Uint8Array(buffer));
  // Character paper and its scene reuse share one binary; the background is separate.
  expect([...archive.keys()].filter((path) => /\.(png|webp)$/.test(path))).toHaveLength(2);
  const workspace = await importProjectPackage(archive);
  expect(workspace.scenes.workingScene?.images).toHaveLength(2);
  expect(workspace.scenes.workingScene?.actors).toHaveLength(1);
  expect(workspace.scenes.workingScene?.layers?.map((layer) => layer.id)).toEqual(['background', 'layer-1', 'actors']);
  expect(workspace.scenes.workingScene?.layers?.[1]).toMatchObject({ name: 'Far forest', parallax: 0.5 });
  expect(workspace.scenes.workingScene?.images?.[1]?.layerId).toBe('layer-1');
  await page.reload();
  await page
    .getByRole('dialog', { name: 'Recover unsaved work?' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await page
    .getByLabel('Import Project', { exact: true })
    .setInputFiles({ name: 'artwork.project.zip', mimeType: 'application/zip', buffer });
  await expect(page.getByText('Project metadata: Exported', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const restored = await activeEditor(page);
  await expect(restored.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(restored.locator('.scene-inspector details[open]')).toHaveCount(0);
  await restored.locator('.scene-artwork summary').click();
  await restored.getByRole('button', { name: /forest.webp · image-2/ }).click();
  await expect(restored.getByLabel('Position X', { exact: true })).toHaveValue('10');
  await restored.locator('.scene-layers summary').click();
  await expect(restored.getByLabel('Parallax for layer-1', { exact: true })).toHaveValue('0.5');
  await restored.getByRole('button', { name: 'Play', exact: true }).click();
  await restored.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(restored.locator('.scene-preview-error')).toHaveCount(0);
  await waitForPreviewPaint(page);
  const colors = await colorCounts(page, await restored.locator('#scene-stage-canvas canvas').screenshot());
  expect(colors.blue).toBeGreaterThan(1000);
  expect(colors.red).toBeGreaterThan(10);
  await page.screenshot({ path: test.info().outputPath('scene-artwork-project-reopened.png') });
});

test('layers compose foreground over Actors with parallax picking, locks, history and scene reload', async ({
  page,
}) => {
  await page.goto('scene-editor/');
  const source = {
    version: 2,
    id: 'layers',
    name: 'Layered forest',
    duration: 2000,
    actors: [
      {
        id: 'hero',
        character: { manifest: '../characters/demo-puppet/character.json' },
        position: { x: 0, y: 100 },
        animation: 'idle',
      },
    ],
    actions: [{ id: 'walk', type: 'move', actorId: 'hero', time: 0, duration: 1000, destination: { x: 100, y: 100 } }],
  };
  await page
    .getByLabel('Open scene JSON')
    .setInputFiles({ name: 'layers.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page.locator('.scene-artwork summary').click();
  await page
    .getByLabel('Import scene artwork')
    .setInputFiles({ name: 'forest.png', mimeType: 'image/png', buffer: await imageBytes(page, 600, 400, '#174bc7') });
  await page
    .getByLabel('Import scene artwork')
    .setInputFiles({ name: 'tree.png', mimeType: 'image/png', buffer: await imageBytes(page, 80, 250, '#e02020') });
  await page.getByLabel('Position X', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Apply image transform', exact: true }).click();
  await page.locator('.scene-layers summary').click();
  await page.getByRole('button', { name: '+ Add Layer', exact: true }).click();
  await page.getByLabel('Name for layer-1', { exact: true }).fill('Foreground trees');
  await page.getByLabel('Parallax for layer-1', { exact: true }).fill('1.2');
  const settings = page.getByLabel('Name for layer-1', { exact: true }).locator('..').locator('..');
  await settings.getByRole('button', { name: 'Apply layer' }).click();
  await page.getByLabel('Layer for image-2', { exact: true }).selectOption('layer-1');
  await page.getByLabel('Grid', { exact: true }).uncheck();
  const canvas = page.locator('#scene-stage-canvas canvas');
  const tree = async () => {
    await waitForPreviewPaint(page);
    return page.evaluate(
      async (url) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const pixels = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = pixels.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        let count = 0,
          sumX = 0,
          sumY = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] === 224 && data[i + 1] === 32 && data[i + 2] === 32) {
            count++;
            sumX += (i / 4) % bitmap.width;
            sumY += Math.floor(i / 4 / bitmap.width);
          }
        }
        bitmap.close();
        return { count, x: sumX / count, y: sumY / count };
      },
      `data:image/png;base64,${(await canvas.screenshot()).toString('base64')}`,
    );
  };
  const before = await tree();
  expect(before.count).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Move Foreground trees backward', exact: true }).click();
  await page.getByRole('button', { name: 'Move Foreground trees backward', exact: true }).click();
  expect((await tree()).count).toBe(0); // Opaque forest now covers the tree.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await tree()).count).toBeGreaterThan(1000);
  await page.getByLabel('Preview camera X', { exact: true }).fill('100');
  const box = (await canvas.boundingBox())!;
  const sx = box.width / 1000,
    sy = box.height / 700;
  const shifted = await tree();
  expect(shifted.x - before.x).toBeCloseTo(-120 * sx, 0);
  const cameraOnly = await downloadJson(page);
  expect(cameraOnly.images?.[1]?.position).toEqual({ x: 100, y: 0 });
  expect(cameraOnly.actors).toEqual(source.actors);
  // Select the Actor through an overlapping foreground, then select the frontmost image on canvas.
  await page.locator('.scene-layers').getByRole('button', { name: 'hero', exact: true }).click();
  const center = { x: box.x + box.width / 2 - 20 * sx, y: box.y + box.height / 2 - 60 * sy };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 30 * sx, center.y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByLabel('Position X', { exact: true }).inputValue()))
    .toBeCloseTo(130, 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Position X', { exact: true })).toHaveValue('100');
  // Lock blocks authored edits while retaining hierarchy selection and normal camera navigation.
  await page.getByLabel('Lock Foreground trees', { exact: true }).check();
  await page.locator('.scene-layers').getByRole('button', { name: 'image-2', exact: true }).click();
  await expect(page.getByLabel('Position X', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Layer for image-2', { exact: true })).toBeDisabled();
  await page.getByLabel('Lock Foreground trees', { exact: true }).uncheck();
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -200);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(center.x + 30, center.y + 20);
  await page.mouse.up({ button: 'middle' });
  await waitForPreviewPaint(page);
  const zoomedTree = await tree();
  await page.mouse.move(box.x + zoomedTree.x, box.y + zoomedTree.y - 40 * sy);
  await page.mouse.down();
  await page.mouse.move(box.x + zoomedTree.x + 20 * sx, box.y + zoomedTree.y - 40 * sy, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByLabel('Position X', { exact: true }).inputValue()))
    .toBeCloseTo(100 + 20 / Math.exp(0.2), 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const navigationOnly = await downloadJson(page);
  expect(navigationOnly.images).toEqual(cameraOnly.images);
  expect(navigationOnly.actors).toEqual(source.actors);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.getByLabel('Preview camera X', { exact: true })).toHaveValue('0');
  await page.getByLabel('Show Foreground trees', { exact: true }).uncheck();
  expect((await tree()).count).toBe(0);
  await page.getByLabel('Show Foreground trees', { exact: true }).check();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const playhead = await page.getByLabel('Playhead (s)', { exact: true }).inputValue();
  await page.getByLabel('Show Foreground trees', { exact: true }).uncheck();
  await expect(page.getByLabel('Playhead (s)', { exact: true })).toHaveValue(playhead);
  await page.getByLabel('Show Foreground trees', { exact: true }).check();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const buffer = await readFile(await (await waiting).path());
  const restored = await validateScenePackage(decodePackageZip(new Uint8Array(buffer)));
  expect(restored.definition.layers).toEqual(cameraOnly.layers);
  expect(restored.definition.images?.[1]?.layerId).toBe('layer-1');
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'layers.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(cameraOnly)),
  });
  await expect(page.getByRole('status')).toContainText('Scene imported.');
  await expect(page.locator('.scene-preview-error')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('scene-layers.png') });
});
