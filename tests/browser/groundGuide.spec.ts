import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';

async function groundLine(page: Page) {
  const canvas = page.locator('#scene-stage-canvas canvas');
  const screenshot = await canvas.screenshot();
  const row = await page.evaluate(
    async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let bestY = -1,
        bestCount = 0;
      for (let y = 0; y < bitmap.height; y++) {
        let count = 0;
        for (let x = 0; x < bitmap.width; x++) {
          const index = (y * bitmap.width + x) * 4;
          if (
            data[index]! > 150 &&
            data[index]! < 235 &&
            data[index + 1]! > 115 &&
            data[index + 1]! < 210 &&
            data[index + 2]! < 170 &&
            data[index]! - data[index + 1]! > 25
          )
            count++;
        }
        if (count > bestCount) {
          bestCount = count;
          bestY = y;
        }
      }
      return bestCount > bitmap.width / 4 ? bestY : -1;
    },
    `data:image/png;base64,${screenshot.toString('base64')}`,
  );
  expect(row).toBeGreaterThanOrEqual(0);
  const bounds = (await canvas.boundingBox())!;
  const width = await canvas.evaluate((element) => (element as HTMLCanvasElement).width);
  const pixel = bounds.width / width;
  return { bounds, pixel, row, x: bounds.x + 25 * pixel, y: bounds.y + row - 12 * pixel };
}

async function exportedScene(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene JSON' }).click();
  const path = await (await waiting).path();
  if (!path) throw new Error('Scene download missing.');
  return parseSceneJson(await readFile(path, 'utf8'));
}

test('scene ground controls render, follow the camera and persist independently of authored scenes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('scene-editor/');
  const create = async (id: string) => {
    await page.getByRole('button', { name: 'New Scene', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New Scene' });
    await dialog.getByLabel('Scene ID').fill(id);
    await dialog.getByRole('button', { name: 'Create scene', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  };
  await create('ground-first');
  const panel = page.locator('.ground-guide-controls');
  const y = panel.getByRole('spinbutton', { name: 'Ground Y', exact: true });
  const visible = panel.getByRole('checkbox', { name: 'Show ground guide' });
  await expect(panel).not.toHaveAttribute('open');
  await panel.getByText('Scene ground', { exact: true }).click();
  await expect(y).toHaveValue('0');
  await expect(visible).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Grid', exact: true }).uncheck();
  const canvas = page.locator('#scene-stage-canvas canvas');
  const hidden = await canvas.screenshot();
  await visible.check();
  await expect.poll(async () => (await canvas.screenshot()).equals(hidden)).toBe(false);
  await y.fill('50');
  await y.press('Enter');
  const beforeCamera = await canvas.screenshot();
  await canvas.hover();
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await canvas.screenshot()).equals(beforeCamera)).toBe(false);
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + bounds.height / 2 + 60, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await page.setViewportSize({ width: 1800, height: 1200 });
  await expect(y).toHaveValue('50');
  await y.fill('');
  await y.press('Enter');
  await expect(y).toHaveValue('50');
  await panel.getByRole('button', { name: 'Reset Ground Y' }).click();
  await expect(y).toHaveValue('0');
  await y.fill('75.5');
  await y.press('Tab');
  await create('ground-second');
  await expect(panel).not.toHaveAttribute('open');
  await panel.getByText('Scene ground', { exact: true }).click();
  await expect(y).toHaveValue('0');
  await expect(visible).not.toBeChecked();
  await page.getByLabel('Select scene').selectOption('ground-first');
  await panel.getByText('Scene ground', { exact: true }).click();
  await expect(y).toHaveValue('75.5');
  await expect(visible).toBeChecked();
  // Mark both new documents saved so a reload has no unsaved-document confirmation.
  await page.getByRole('button', { name: 'Download scene JSON' }).click();
  await page.getByLabel('Select scene').selectOption('ground-second');
  await page.getByRole('button', { name: 'Download scene JSON' }).click();
  await page.reload();
  // JSON checkpoints retain complete local drafts; inspect guide preferences without restoring the document.
  await page.getByRole('button', { name: 'Close recovery', exact: true }).click();
  await create('ground-first');
  await panel.getByText('Scene ground', { exact: true }).click();
  await expect(y).toHaveValue('75.5');
  await expect(visible).toBeChecked();
  expect(errors).toEqual([]);
});

test('scene guide dragging and two-character feet alignment preserve choreography, history and reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const source = parseSceneJson(
    JSON.stringify({
      version: 2,
      id: 'ground-alignment',
      name: 'Ground alignment',
      duration: 10000,
      actors: [
        { id: 'a', character: { manifest: '../characters/demo-puppet/character.json' }, position: { x: -180, y: 10 } },
        {
          id: 'b',
          character: { manifest: '../characters/random-paperdoll-sketch/character.json' },
          position: { x: 180, y: -40 },
          facing: 'left',
        },
      ],
      actions: [
        { id: 'walk', actorId: 'a', type: 'move', time: 0, duration: 1000, destination: { x: 80, y: -80 } },
        {
          id: 'clip',
          actorId: 'a',
          type: 'animation',
          time: 0,
          duration: 1000,
          animation: 'walk',
          loop: true,
          speed: 1,
        },
      ],
    }),
  );
  const upload = async (json: string) => {
    await page
      .getByLabel('Open scene JSON')
      .setInputFiles({ name: 'ground.scene.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  };
  await page.goto('scene-editor/');
  await upload(JSON.stringify(source));
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  const panel = page.locator('.ground-guide-controls');
  await panel.locator('summary').click();
  const y = panel.getByRole('spinbutton', { name: 'Ground Y', exact: true });
  const align = panel.getByRole('button', { name: 'Align Feet to Ground', exact: true });
  await expect(align).toBeDisabled();
  await panel.getByRole('checkbox', { name: 'Show ground guide' }).check();
  await y.fill('100');
  await y.press('Enter');
  let line = await groundLine(page);
  await page.mouse.move(line.x, line.y);
  await page.mouse.down();
  await page.mouse.move(line.x, line.y + 20, { steps: 3 });
  await expect.poll(async () => Number(await y.inputValue())).toBeGreaterThan(100);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(y).toHaveValue('100');
  line = await groundLine(page);
  await page.mouse.move(line.x, line.y);
  await page.mouse.down();
  await page.mouse.move(line.x, line.y + 20, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => Number(await y.inputValue())).toBeGreaterThan(100);
  await panel.getByRole('button', { name: 'Undo ground change', exact: true }).click();
  await expect(y).toHaveValue('100');
  expect(await exportedScene(page)).toEqual(source);
  const tracks = page.getByLabel('Action tracks', { exact: true });
  await tracks.getByRole('button', { name: 'a', exact: true }).click();
  await align.click();
  await page.getByText('Actor properties', { exact: true }).click();
  const initialY = page.getByRole('spinbutton', { name: 'Initial Y', exact: true });
  // The demo's bent bind-pose knees shorten its vertical leg reach.
  const demoGroundY = 100 - (12 + 132 * Math.cos(0.04) + 24 - 26 * 0.3);
  const sketchGroundY = 100 - (-35 + 1.5 + 91.5 + 78 + 72 * (1 - 20 / 72) * 0.3);
  await expect.poll(async () => Number(await initialY.inputValue())).toBeCloseTo(demoGroundY, 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(initialY).toHaveValue('10');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => Number(await initialY.inputValue())).toBeCloseTo(demoGroundY, 3);
  await tracks.getByRole('button', { name: 'b', exact: true }).click();
  await align.click();
  // Actor properties remount collapsed on Actor changes.
  await page.getByText('Actor properties', { exact: true }).click();
  await expect.poll(async () => Number(await initialY.inputValue())).toBeCloseTo(sketchGroundY, 3);
  await panel.getByRole('checkbox', { name: 'Snap to Ground', exact: true }).check();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  line = await groundLine(page);
  const origin = {
    x: line.bounds.x + line.bounds.width / 2 + 180 * line.pixel,
    y: line.bounds.y + line.row + (sketchGroundY - 100) * line.pixel,
  };
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 20 * line.pixel, origin.y - 30 * line.pixel, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => Number(await initialY.inputValue())).toBeCloseTo(sketchGroundY, 3);
  await page.keyboard.down('Shift');
  await page.mouse.move(origin.x + 20 * line.pixel, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 40 * line.pixel, origin.y - 30 * line.pixel, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => Number(await initialY.inputValue())).toBeLessThan(sketchGroundY);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => Number(await initialY.inputValue())).toBeCloseTo(sketchGroundY, 3);
  const aligned = await exportedScene(page);
  expect(aligned.actions).toEqual(source.actions);
  expect(aligned.actors[0]!.position.y).toBeCloseTo(demoGroundY, 3);
  expect(aligned.actors[1]!.position.y).toBeCloseTo(sketchGroundY, 3);
  // Moving the guide never changes these placements or resets the runtime context.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(align).toBeDisabled();
  await y.fill('125');
  await y.press('Enter');
  await expect(page.getByLabel('Scene playback status', { exact: true })).toContainText('playing');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const playhead = page.getByRole('spinbutton', { name: 'Playhead (s)', exact: true });
  const stationary = await groundLine(page);
  for (const time of ['0.25', '0.8', '0.25']) {
    await playhead.fill(time);
    expect(Math.abs((await groundLine(page)).row - stationary.row)).toBeLessThan(2);
    await expect(y).toHaveValue('125');
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(await exportedScene(page)).toEqual(aligned);
  await page.reload();
  await upload(JSON.stringify(aligned));
  await panel.locator('summary').click();
  await expect(y).toHaveValue('125');
  await expect(panel.getByRole('checkbox', { name: 'Snap to Ground', exact: true })).toBeChecked();
  expect(await exportedScene(page)).toEqual(aligned);
  await page.screenshot({ path: test.info().outputPath('scene-ground-alignment.png') });
  await page.getByRole('link', { name: 'Project Workspace', exact: true }).click();
  expect(errors).toEqual([]);
});
