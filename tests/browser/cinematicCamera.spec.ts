import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../../src/engine/ScenePackage.js';
import { sceneInspectorGroup, test, waitForPreviewPaint } from './fixtures.js';

test.use({ actionTimeout: 15000 });

test('cinematic framing, independent navigation, clean preview, parallax, Actor framing and portable reload', async ({
  page,
}) => {
  await page.goto('scene-editor/');
  const source = {
    version: 2,
    id: 'camera',
    name: 'Camera scene',
    duration: 3000,
    layers: [
      { id: 'background', name: 'Background', visible: true, parallax: 0.2 },
      { id: 'actors', name: 'Actors', visible: true, parallax: 1 },
      { id: 'foreground', name: 'Foreground', visible: true, parallax: 1.2 },
    ],
    actors: [
      {
        id: 'hero',
        character: { manifest: '../characters/demo-puppet/character.json' },
        position: { x: -200, y: 100 },
      },
    ],
    actions: [],
  };
  await page
    .getByLabel('Open scene JSON')
    .setInputFiles({ name: 'camera.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await sceneInspectorGroup(page, 'Artwork');
  await page.locator('.scene-artwork summary').click();
  const imageFiles: Buffer[] = [];
  for (const [name, color] of [
    ['blue', '#174bc7'],
    ['red', '#e02020'],
  ]) {
    const bytes = await page.evaluate(async (color) => {
      const canvas = document.createElement('canvas');
      canvas.width = 60;
      canvas.height = 60;
      const context = canvas.getContext('2d')!;
      context.fillStyle = color!;
      context.fillRect(0, 0, 60, 60);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, color);
    imageFiles.push(Buffer.from(bytes));
    await page
      .getByLabel('Import scene artwork')
      .setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(bytes) });
    await expect(page.getByRole('list', { name: 'Scene backgrounds', exact: true }).getByRole('listitem')).toHaveCount(
      imageFiles.length,
    );
    await expect(page.getByLabel('Scale X', { exact: true })).toHaveValue('1');
  }
  await page.getByLabel('Position X', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Apply image transform', exact: true }).click();
  await sceneInspectorGroup(page, 'Artwork');
  await page.locator('.scene-layers summary').click();
  await page.getByLabel('Layer for image-2', { exact: true }).selectOption('foreground');
  await sceneInspectorGroup(page, 'Camera');
  await page.locator('.scene-camera > summary').click();
  await page.getByLabel('Center X', { exact: true }).fill('100');
  await page.getByLabel('Camera zoom', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: 'Apply camera', exact: true }).click();
  await page.getByRole('button', { name: 'Select Cinematic Camera', exact: true }).click();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  const canvas = page.locator('#scene-stage-canvas canvas');
  let box = (await canvas.boundingBox())!;
  const center = { x: box.x + box.width * 0.6, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + box.width * 0.04, center.y + (box.height * 20) / 700, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByLabel('Center X', { exact: true }).inputValue()))
    .toBeCloseTo(140, 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Center X', { exact: true })).toHaveValue('100');
  // Actor framing uses real rendered bounds and leaves the Actor untouched.
  await sceneInspectorGroup(page, 'Artwork');
  await page.locator('.scene-layers').getByRole('button', { name: 'hero', exact: true }).click();
  await sceneInspectorGroup(page, 'Camera');
  await expect(page.getByLabel('Actor to frame', { exact: true })).toHaveValue('hero');
  await page.getByRole('button', { name: 'Frame Actor', exact: true }).click();
  expect(Number(await page.getByLabel('Center X', { exact: true }).inputValue())).toBeLessThan(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Select Cinematic Camera', exact: true }).click();
  box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await waitForPreviewPaint(page);
  const navigation = await canvas.screenshot();
  const toolbar = page.locator('.scene-stage-toolbar');
  await toolbar.getByRole('button', { name: 'Preview Through Camera', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Reset view', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Editor overlays', { exact: true })).not.toBeChecked();
  const verifyProjection = async () => {
    await waitForPreviewPaint(page);
    const projection = await page.evaluate(
      async (url) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = surface.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const colors = [
          [23, 75, 199],
          [224, 32, 32],
        ];
        const result = colors.map((color) => {
          let count = 0,
            sumX = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i] === color[0] && data[i + 1] === color[1] && data[i + 2] === color[2]) {
              count++;
              sumX += (i / 4) % bitmap.width;
            }
          return { count, x: (sumX / count + 0.5) / bitmap.width };
        });
        bitmap.close();
        return result;
      },
      `data:image/png;base64,${(await canvas.screenshot()).toString('base64')}`,
    );
    expect(projection[0]!.count).toBeGreaterThan(100);
    expect(projection[1]!.count).toBeGreaterThan(100);
    expect(projection[0]!.x).toBeCloseTo(0.47, 2); // 0 - 0.2*100 at zoom 1.5.
    expect(projection[1]!.x).toBeCloseTo(0.62, 2); // 200 - 1.2*100 at zoom 1.5.
  };
  await verifyProjection();
  await page.setViewportSize({ width: 1400, height: 1000 });
  await verifyProjection();
  await page.setViewportSize({ width: 1600, height: 1400 });
  await toolbar.getByRole('button', { name: 'Exit Camera Preview', exact: true }).click();
  await waitForPreviewPaint(page);
  expect(Buffer.compare(await canvas.screenshot(), navigation)).toBe(0);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const packed = await readFile(await (await waiting).path());
  const restored = await validateScenePackage(decodePackageZip(new Uint8Array(packed)));
  expect(restored.definition.camera).toEqual({ x: 100, y: 0, zoom: 1.5 });
  expect(restored.definition.actors[0]!.position).toEqual(source.actors[0]!.position);
  const json = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
  const data = await readFile(await (await json).path());
  const exported = parseSceneJson(data.toString());
  expect(exported.camera).toEqual(restored.definition.camera);
  // Host the downloaded JSON's image dependencies, as for an extracted scene package.
  await page.route('**/images/*.png', async (route) => {
    const index = exported.images!.findIndex((image) =>
      route.request().url().endsWith(image.image.replace('../', '/')),
    );
    if (index >= 0) await route.fulfill({ contentType: 'image/png', body: imageFiles[index]! });
    else await route.continue();
  });
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByLabel('Open scene JSON')
    .setInputFiles({ name: 'camera.json', mimeType: 'application/json', buffer: data });
  await sceneInspectorGroup(page, 'Camera');
  await page.locator('.scene-camera > summary').click();
  await expect(page.getByLabel('Center X', { exact: true })).toHaveValue('100');
  await expect(page.getByLabel('Camera zoom', { exact: true })).toHaveValue('1.5');
});
