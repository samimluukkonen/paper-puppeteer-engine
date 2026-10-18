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
