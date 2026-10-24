import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';

test('scene catalog gates empty selections and all tours resolve real controls without authoring', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('scene-editor/');
  const open = page.getByRole('button', { name: 'Feature Guide', exact: true });
  const catalog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await open.click();
  await expect(catalog.getByRole('button', { name: 'Start Guide: Creating a Scene', exact: true })).toBeEnabled();
  await expect(catalog.getByRole('button', { name: 'Start Guide: Adding an Actor', exact: true })).toBeDisabled();
  await expect(catalog.getByRole('button', { name: 'Start Guide: Cinematic Camera', exact: true })).toBeDisabled();
  await expect(
    catalog.getByRole('button', { name: 'Start Guide: Backgrounds, Layers and Parallax', exact: true }),
  ).toBeDisabled();
  await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  const data = {
    version: 2,
    id: 'guided-scene',
    name: 'Guided scene',
    duration: 10000,
    actors: [
      {
        id: 'actor',
        character: { manifest: '../characters/demo-puppet/character.json' },
        position: { x: 0, y: 0 },
        animation: 'idle',
      },
    ],
    actions: [{ id: 'move', actorId: 'actor', type: 'move', time: 0, duration: 1000, destination: { x: 100, y: 0 } }],
  };
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'guide.scene.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByRole('button', { name: 'actor: move move', exact: true }).click();
  const groundMetadata = () =>
    page.evaluate(() =>
      Object.entries(localStorage).filter(([key]) => key.startsWith('paper-puppeteer:ground-guide:')),
    );
  const metadataBefore = await groundMetadata();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  for (const guide of guideRegistry.getGuidesForEditor('scene')) {
    await open.click();
    await catalog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
    const tour = page.getByRole('dialog', { name: guide.title, exact: true });
    for (let index = 0; index < guide.steps.length; index++) {
      await expect(tour).toContainText(`Step ${index + 1} of ${guide.steps.length}`);
      await expect(tour.getByRole('heading', { name: guide.steps[index]!.title, exact: true })).toBeVisible();
      await expect(page.locator('.guide-spotlight-hole')).toBeVisible();
      const target = page.locator(`[data-guide-id="${guide.steps[index]!.targetId}"]`);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
      await expect(tour).not.toContainText('Target unavailable');
      if (guide.id === 'scene-ground-reference')
        await page.screenshot({ path: test.info().outputPath(`${guide.id}-${guide.steps[index]!.id}.png`) });
      if (index + 1 < guide.steps.length) await tour.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await tour.getByRole('button', { name: 'Exit', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Scene playback status')).toContainText('stopped');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
  const download = await waiting;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual(data);
  expect(await groundMetadata()).toEqual(metadataBefore);
  expect(errors).toEqual([]);
});

test('background guide reveals selected locked artwork without changing the scene, selection or preview', async ({
  page,
}) => {
  const source = {
    version: 2,
    id: 'background-guide',
    name: 'Background guide',
    duration: 1000,
    actors: [],
    actions: [],
    layers: [
      { id: 'background', name: 'Forest', visible: true, parallax: 0.5 },
      { id: 'actors', name: 'Actors', visible: true, parallax: 1 },
      { id: 'trees', name: 'Foreground', visible: true, parallax: 1.2 },
    ],
    images: [
      {
        id: 'forest',
        image: '../characters/demo-puppet/images/paper-head.png',
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        visible: true,
        order: 0,
      },
    ],
  };
  await page.goto('scene-editor/');
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'background.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByRole('status')).toContainText('Scene imported.');
  await page.locator('.scene-artwork summary').click();
  const image = page.locator('.scene-artwork .scene-artwork-list button');
  await image.click();
  await page.locator('.scene-layers summary').click();
  await page.getByLabel('Lock Forest', { exact: true }).check();
  const downloadScene = async (): Promise<unknown> => {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
    return JSON.parse(await readFile(await (await waiting).path(), 'utf8'));
  };
  // Import registers artwork under its content-based path before any tour runs.
  const beforeTour = await downloadScene();
  const guide = guideRegistry.getGuideById('scene-backgrounds-layers')!;
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
  const tour = page.getByRole('dialog', { name: guide.title, exact: true });
  for (const [index, step] of guide.steps.entries()) {
    await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
    const target = page.locator(`[data-guide-id="${step.targetId}"]`);
    await expect(target).toHaveCount(1);
    await expect(target).toBeVisible();
    await expect(page.locator('.guide-spotlight-hole')).toBeVisible();
    await expect(tour).not.toContainText('Target unavailable');
    if (step.id === 'parallax')
      await page.screenshot({ path: test.info().outputPath('background-parallax-guide.png') });
    if (index + 1 < guide.steps.length) await tour.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await tour.getByRole('button', { name: 'Exit', exact: true }).click();
  await expect(image).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Lock Forest', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Position X', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Preview camera X', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Preview camera Y', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Scene playback status')).toContainText('stopped');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  expect(await downloadScene()).toEqual(beforeTour);
});

for (const populated of [false, true]) {
  test(`camera guide reveals every target without changing ${populated ? 'authored preview' : 'empty scene'} state`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('scene-editor/');
    const source = {
      version: 2,
      id: 'camera-guide',
      name: 'Camera guide',
      duration: 2000,
      ...(populated ? { camera: { x: 120, y: -40, zoom: 1.5 } } : {}),
      actors: populated
        ? [
            {
              id: 'hero',
              character: { manifest: '../characters/demo-puppet/character.json' },
              position: { x: 0, y: 100 },
            },
          ]
        : [],
      actions: [],
    };
    await page.getByLabel('Open scene JSON').setInputFiles({
      name: 'camera.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(source)),
    });
    await expect(page.getByRole('region', { name: 'Editor context', exact: true }).getByRole('status')).toContainText(
      'Scene imported.',
    );
    await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
    const toolbar = page.locator('.scene-stage-toolbar');
    if (populated) {
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
      await page.locator('.scene-layers summary').click();
      await page.locator('.scene-layers').getByRole('button', { name: 'hero', exact: true }).click();
      await page.locator('.scene-camera summary').click();
      await page.getByRole('button', { name: 'Select Cinematic Camera', exact: true }).click();
      await toolbar.getByRole('button', { name: 'Preview Through Camera', exact: true }).click();
      await page.getByLabel('Editor overlays', { exact: true }).check();
      await page.getByLabel('Playhead (s)', { exact: true }).fill('0.5');
      await page.getByLabel('Playhead (s)', { exact: true }).press('Enter');
      await page.getByLabel('Center X', { exact: true }).fill('150');
      await page.getByRole('button', { name: 'Apply camera', exact: true }).click();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
    }
    // Start from the other tab to verify that the saving step reveals the real Edit controls.
    await page.getByRole('tab', { name: 'Local draft', exact: true }).click();
    const guide = guideRegistry.getGuideById('scene-cinematic-camera')!;
    await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
    await page.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
    const tour = page.getByRole('dialog', { name: guide.title, exact: true });
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
      const target = page.locator(`[data-guide-id="${step.targetId}"]`);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
      await expect(page.locator('.guide-spotlight-hole')).toBeVisible();
      await expect(tour).not.toContainText('Target unavailable');
      if (step.id === 'actor' && !populated) {
        await expect(target).toBeDisabled();
        await expect(tour).toContainText('With no Actor selected');
      }
      if (index + 1 < guide.steps.length) await tour.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await tour.getByRole('button', { name: 'Exit', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Edit', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    if (populated) {
      await expect(page.getByRole('button', { name: 'Select Cinematic Camera', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(toolbar.getByRole('button', { name: 'Exit Camera Preview', exact: true })).toBeVisible();
      await expect(page.getByLabel('Editor overlays', { exact: true })).toBeChecked();
      await expect(page.getByLabel('Playhead (s)', { exact: true })).toHaveValue('0.5');
      await expect(page.getByLabel('Scene playback status')).toContainText('paused');
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
      await expect(page.locator('.scene-layers').getByRole('button', { name: 'hero', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    } else {
      await expect(page.getByRole('button', { name: 'Select Cinematic Camera', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await expect(toolbar.getByRole('button', { name: 'Preview Through Camera', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
    }
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
    expect(JSON.parse(await readFile(await (await waiting).path(), 'utf8'))).toEqual(source);
    expect(errors).toEqual([]);
  });
}
