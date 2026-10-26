import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../../src/engine/ScenePackage.js';
import { sceneInspectorGroup, test, waitForPreviewPaint } from './fixtures.js';

test.use({ actionTimeout: 15000 });

test('two-Actor cinematic cuts and fades author, seek, cover foreground, undo and survive portable reload', async ({
  page,
}) => {
  await page.goto('scene-editor/');
  const image = async (width: number, height: number, color: string) =>
    Buffer.from(
      await page.evaluate(
        async ({ width, height, color }) => {
          const surface = new OffscreenCanvas(width, height);
          const context = surface.getContext('2d')!;
          context.fillStyle = color;
          context.fillRect(0, 0, width, height);
          return [...new Uint8Array(await (await surface.convertToBlob()).arrayBuffer())];
        },
        { width, height, color },
      ),
    );
  const blue = await image(1000, 700, '#0000ff');
  const red = await image(100, 100, '#ff0000');
  await page.route('**/images/fade-background.png', (route) => route.fulfill({ contentType: 'image/png', body: blue }));
  await page.route('**/images/fade-foreground.png', (route) => route.fulfill({ contentType: 'image/png', body: red }));
  const source = {
    version: 2,
    id: 'cinematic-fades',
    name: 'Cinematic fades',
    duration: 6000,
    actors: ['a', 'b'].map((id, index) => ({
      id,
      character: { manifest: '../characters/demo-puppet/character.json' },
      position: { x: index * 180 - 90, y: 0 },
    })),
    actions: [],
    layers: [
      { id: 'background', name: 'Background', visible: true, parallax: 1 },
      { id: 'actors', name: 'Actors', visible: true, parallax: 1 },
      { id: 'front', name: 'Foreground', visible: true, parallax: 1 },
    ],
    images: [
      {
        id: 'background',
        image: '../images/fade-background.png',
        layerId: 'background',
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        visible: true,
        order: 0,
      },
      {
        id: 'foreground',
        image: '../images/fade-foreground.png',
        layerId: 'front',
        position: { x: 250, y: 0 },
        scale: { x: 1, y: 1 },
        visible: true,
        order: 0,
      },
    ],
  };
  await page
    .getByLabel('Open scene JSON')
    .setInputFiles({ name: 'fades.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  const time = page.getByLabel('Playhead (s)', { exact: true });
  await time.fill('3');
  await page.getByRole('button', { name: 'Set Camera Cut', exact: true }).click();
  await sceneInspectorGroup(page, 'Camera');
  await page.locator('.scene-camera > summary').click();
  await page.getByLabel('Center X', { exact: true }).fill('180');
  await page.getByLabel('Camera zoom', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Apply camera key', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Camera cut at 3 s', exact: true })).toBeVisible();
  await time.fill('0');
  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  const fadeSummary = page.getByText('Transition properties · Fade in', { exact: true });
  await expect(fadeSummary.locator('..')).not.toHaveAttribute('open');
  await fadeSummary.click();
  await page.getByLabel('Fade duration (seconds)', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Apply transition properties', exact: true }).click();
  await time.fill('5');
  await page.getByRole('combobox', { name: 'Effect type', exact: true }).selectOption('fade-out');
  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  const track = page.getByLabel('Scene transitions', { exact: true });
  await expect(track.getByRole('button', { name: 'Fade out at 5 s', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(track.getByRole('button', { name: 'Fade out at 5 s', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(track.getByRole('button', { name: 'Fade out at 5 s', exact: true })).toHaveCount(1);
  await page
    .locator('.scene-stage-toolbar')
    .getByRole('button', { name: 'Preview Through Camera', exact: true })
    .click();
  const canvas = page.locator('#scene-stage-canvas canvas');
  const frameAt = async (seconds: string) => {
    await time.fill(seconds);
    await waitForPreviewPaint(page);
    return canvas.screenshot();
  };
  const opening = await frameAt('0');
  const half = await frameAt('1');
  const visible = await frameAt('2');
  const pixel = async (png: Buffer, x: number) =>
    page.evaluate(
      async ({ data, x }) => {
        const bitmap = await createImageBitmap(await (await fetch(data)).blob());
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = surface.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const rgba = [...context.getImageData(Math.floor(bitmap.width * x), Math.floor(bitmap.height / 2), 1, 1).data];
        bitmap.close();
        return rgba.slice(0, 3);
      },
      { data: `data:image/png;base64,${png.toString('base64')}`, x },
    );
  expect(await pixel(opening, 0.75)).toEqual([0, 0, 0]);
  expect(await pixel(visible, 0.75)).toEqual([255, 0, 0]);
  const middle = await pixel(half, 0.75);
  expect(middle[0]).toBeGreaterThanOrEqual(126);
  expect(middle[0]).toBeLessThanOrEqual(129);
  expect(middle.slice(1)).toEqual([0, 0]);
  const wide = await frameAt('2.999999');
  const close = await frameAt('3');
  expect(Buffer.compare(wide, close)).not.toBe(0);
  expect(Buffer.compare(close, await frameAt('3.000001'))).toBe(0);
  await frameAt('5.5');
  expect(Buffer.compare(half, await frameAt('1'))).toBe(0);
  expect(await pixel(await frameAt('6'), 0.75)).toEqual([0, 0, 0]);
  await expect(page.getByRole('button', { name: 'Exit Camera Preview', exact: true }).first()).toBeEnabled();
  const download = async (name: string) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    return readFile(await (await pending).path());
  };
  const authored = parseSceneJson((await download('Download scene JSON')).toString());
  expect(authored.transitions).toHaveLength(2);
  const zip = await download('Download scene package');
  const portable = await validateScenePackage(decodePackageZip(new Uint8Array(zip)));
  expect(portable.definition.transitions).toEqual(authored.transitions);
  expect(portable.definition.cameraTracks).toEqual(authored.cameraTracks);
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'fades-reloaded.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...authored, id: 'fades-reloaded' })),
  });
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page
    .locator('.scene-stage-toolbar')
    .getByRole('button', { name: 'Preview Through Camera', exact: true })
    .click();
  expect(Buffer.compare(half, await frameAt('1'))).toBe(0);
  await track.getByRole('button', { name: 'Fade in at 0 s', exact: true }).click();
  await page.getByText('Transition properties · Fade in', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete transition', exact: true }).click();
  await expect(track.getByRole('button', { name: 'Fade in at 0 s', exact: true })).toHaveCount(0);
});
