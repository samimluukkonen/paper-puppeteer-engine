import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { validateScenePackage } from '../../src/engine/ScenePackage.js';

const source = {
  version: 2,
  id: 'scene-transfer',
  name: 'Transfer scene',
  duration: 2000,
  actors: [
    {
      id: 'hero',
      character: { manifest: '../characters/demo-puppet/character.json' },
      position: { x: 0, y: 100 },
      animation: 'idle',
      skin: 'default',
    },
  ],
  actions: [{ id: 'walk', type: 'move', actorId: 'hero', time: 0, duration: 1000, destination: { x: 100, y: 100 } }],
};

test('paste, validate, copy and package exports preserve the scene and reject broken dependencies', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('scene-editor/');
  await page.getByRole('button', { name: 'Paste scene JSON' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import scene JSON' });
  await dialog.getByLabel('Scene JSON', { exact: true }).fill(JSON.stringify(source));
  await dialog.getByRole('button', { name: 'Import scene', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Validate Scene', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Scene and character dependencies are valid.');
  await page.getByRole('button', { name: 'Copy Scene JSON', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Scene JSON copied.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toEqual(source);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('scene-transfer.scene.zip');
  const path = await download.path();
  if (!path) throw new Error('Missing scene package download.');
  const packaged = await validateScenePackage(decodePackageZip(new Uint8Array(await readFile(path))));
  expect(packaged.characters.size).toBe(1);
  expect(packaged.definition.actions).toEqual(source.actions);
  await page.getByRole('button', { name: 'Paste scene JSON' }).click();
  const invalid = structuredClone(source);
  invalid.actors[0]!.skin = 'missing-skin';
  await dialog.getByLabel('Scene JSON', { exact: true }).fill(JSON.stringify(invalid));
  await dialog.getByRole('button', { name: 'Import scene', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Unknown skin');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Copy Scene JSON', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Scene JSON copied.');
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(source);
  expect(errors).toEqual([]);
});
