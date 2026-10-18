import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';

async function createScene(page: Page, id: string) {
  await page.getByRole('button', { name: 'New Scene', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Scene' });
  await dialog.getByLabel('Scene ID').fill(id);
  await dialog.getByRole('button', { name: 'Create scene', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function downloadScene(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene JSON' }).click();
  const download = await waiting;
  const path = await download.path();
  if (!path) throw new Error('Scene download missing.');
  return parseSceneJson(await readFile(path, 'utf8'));
}

test('empty creation, multiple documents, properties, history, downloads and unsaved navigation', async ({ page }) => {
  const errors: string[] = [];
  const characterRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/characters/')) characterRequests.push(request.url());
  });
  await page.goto('scene-editor/');
  await expect(page.getByRole('heading', { name: 'Scene Editor', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scene stage' })).toBeVisible();
  await createScene(page, 'first');
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page.getByText('Scene properties', { exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Scene inspector' })
    .getByLabel('Name', { exact: true })
    .fill('Opening scene');
  await page
    .getByRole('complementary', { name: 'Scene inspector' })
    .getByLabel('Duration (seconds)', { exact: true })
    .fill('4.5');
  await page.getByRole('button', { name: 'Apply properties' }).click();
  await expect(page.getByRole('status')).toContainText('Opening scene · first · 4.5 s · New / Unsaved');
  await createScene(page, 'second');
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page.getByLabel('Select scene').selectOption('first');
  await page.getByText('Scene properties', { exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Scene inspector' }).getByLabel('Name', { exact: true }),
  ).toHaveValue('Opening scene');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Scene inspector' }).getByLabel('Name', { exact: true }),
  ).toHaveValue('Untitled Scene');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const scene = await downloadScene(page);
  expect(scene).toMatchObject({ id: 'first', name: 'Opening scene', duration: 4500, actors: [], actions: [] });
  await expect(page.getByRole('status')).toContainText('Saved');
  const waiting = page.waitForEvent('dialog');
  const clicking = page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  const guard = await waiting;
  expect(guard.type()).toBe('beforeunload');
  await guard.dismiss();
  await clicking;
  await expect(page).toHaveURL(/scene-editor\//);
  await page.getByLabel('Select scene').selectOption('second');
  await downloadScene(page);
  expect(characterRequests).toEqual([]);
  await page.getByRole('link', { name: 'Engine Demo', exact: true }).click();
  await expect(page).not.toHaveURL(/scene-editor\//);
  await page.getByRole('link', { name: 'Scene Editor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No scene open', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('imports retain authored actors/actions and guard dirty replacement and source revert', async ({ page }) => {
  await page.goto('scene-editor/');
  const input = {
    version: 1,
    id: 'imported',
    name: 'Imported scene',
    duration: 10000,
    actors: [
      {
        id: 'hero',
        character: { manifest: '../characters/demo-puppet/character.json' },
        position: { x: 42, y: 17 },
        skin: 'default',
        facing: 'right',
      },
    ],
    actions: [{ type: 'face', actorId: 'hero', time: 2000, facing: 'left' }],
  };
  const upload = async (value: unknown) => {
    await page.getByLabel('Open scene JSON').setInputFiles({
      name: 'test.scene.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    });
  };
  await upload(input);
  await expect(page.getByRole('status')).toContainText('Imported scene');
  await page.getByText('Scene properties', { exact: true }).click();
  await page.getByRole('complementary', { name: 'Scene inspector' }).getByLabel('Name', { exact: true }).fill('Edited');
  await page.getByRole('button', { name: 'Apply properties' }).click();
  page.once('dialog', (dialog) => {
    void dialog.dismiss();
  });
  await upload(input);
  await expect(page.getByRole('status')).toContainText('Edited');
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Revert', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Imported scene');
  expect(await downloadScene(page)).toEqual(input);
  await upload({ ...input, actors: [input.actors[0], input.actors[0]] });
  await expect(page.getByRole('alert')).toContainText('Duplicate actor ID');
  await expect(page.getByRole('status')).toContainText('Imported scene');
});

test('scene workspace fits desktop viewports with a collapsed inspector', async ({ page }) => {
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('scene-editor/');
    await expect(page.getByRole('region', { name: 'Scene stage' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
  }
});

test('visual actor placement, appearance, duplication, cancellation and document cleanup', async ({ page }) => {
  const errors: string[] = [];
  const assetRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/characters/')) assetRequests.push(request.url());
  });
  await page.goto('scene-editor/');
  await createScene(page, 'placement');
  const add = async () => {
    await page.getByRole('button', { name: '+ Add Actor', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Add Actor', exact: true })
      .getByRole('button', { name: 'Add actor', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'Add Actor', exact: true })).not.toBeVisible();
  };
  await add();
  await add();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  const canvas = page.locator('#scene-stage-canvas canvas');
  await expect(canvas).toBeVisible();
  await page.getByText('Actor properties', { exact: true }).click();
  await page.getByLabel('Initial X', { exact: true }).fill('200');
  await page.getByLabel('Initial Y', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Apply actor properties' }).click();
  await page.getByRole('combobox', { name: 'Facing', exact: true }).selectOption('left');
  await page.getByRole('combobox', { name: 'Initial animation', exact: true }).selectOption('idle');
  await page.getByRole('combobox', { name: 'Initial skin', exact: true }).selectOption('alternate');
  const snapshot = await downloadScene(page);
  expect(snapshot.actors).toHaveLength(2);
  expect(snapshot.actors[1]).toMatchObject({
    id: 'actor-2',
    position: { x: 200, y: 100 },
    facing: 'left',
    animation: 'idle',
    skin: 'alternate',
  });
  await page.getByText('Scene actors (2)', { exact: true }).click();
  await page.getByRole('button', { name: 'actor-1 → demo-puppet', exact: true }).click();
  await page.getByText('Actor properties', { exact: true }).click();
  await page.getByLabel('Initial X', { exact: true }).fill('-200');
  await page.getByLabel('Initial Y', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Apply actor properties' }).click();
  // Default view is centered on world (0,0); FIT scaling determines DOM positions.
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width * 0.3, y: box.y + box.height * (450 / 700) };
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + box.width * 0.05, origin.y - box.height * (25 / 700), { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByLabel('Initial X', { exact: true }).inputValue()))
    .toBeCloseTo(-150, 3);
  await expect
    .poll(async () => Number(await page.getByLabel('Initial Y', { exact: true }).inputValue()))
    .toBeCloseTo(75, 3);
  const movedX = await page.getByLabel('Initial X', { exact: true }).inputValue();
  const movedY = await page.getByLabel('Initial Y', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Initial X', { exact: true })).toHaveValue('-200');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Initial X', { exact: true })).toHaveValue(movedX);
  await page.mouse.move(origin.x + box.width * 0.05, origin.y - box.height * (25 / 700));
  await page.mouse.down();
  await page.mouse.move(origin.x + box.width * 0.1, origin.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByLabel('Initial X', { exact: true })).toHaveValue(movedX);
  await expect(page.getByLabel('Initial Y', { exact: true })).toHaveValue(movedY);
  await page.getByRole('button', { name: 'Duplicate Actor', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Actor', exact: true }).click();
  expect((await downloadScene(page)).actors).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await downloadScene(page)).actors).toHaveLength(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await downloadScene(page)).actors).toHaveLength(2);
  const requestCount = assetRequests.length;
  await createScene(page, 'empty');
  await page.getByLabel('Select scene').selectOption('placement');
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  expect((await downloadScene(page)).actors).toHaveLength(2);
  expect(assetRequests.length).toBe(requestCount);
  expect(errors).toEqual([]);
});
