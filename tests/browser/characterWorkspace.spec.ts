import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { packageJson } from '../../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip } from '../../src/devtools/shared/package/packageZip.js';
import { animationHierarchy, test } from './fixtures.js';

test('artist workflow retains one canvas, documents, artwork and history between editor routes', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  const canvas = await page.locator('#editor-stage canvas').elementHandle();
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.getByRole('treeitem', { name: 'leftForearm', exact: true }).click();
  const joint = page.locator('#inspector input[data-scope="bone"][data-field="y"]');
  await joint.fill('77');
  await joint.press('Tab');
  await page.locator('#edit-mode').selectOption('sprite');
  await page.getByRole('treeitem', { name: '◇ leftForearmVisual', exact: true }).click();
  const offset = page.locator('#inspector input[data-scope="attachment"][data-field="x"]');
  await offset.fill('9');
  await offset.press('Tab');
  const artwork = page.locator('#artwork-panel');
  await artwork.locator('summary').click();
  await artwork.getByLabel('Artwork asset', { exact: true }).selectOption('paper-left-forearm');
  const encoded = await page.evaluate(() => {
    const surface = document.createElement('canvas');
    surface.width = 32;
    surface.height = 80;
    const context = surface.getContext('2d')!;
    context.fillStyle = '#ff00ff';
    context.fillRect(0, 0, 32, 80);
    return surface.toDataURL('image/png').split(',')[1]!;
  });
  await artwork
    .getByLabel('Import sprite')
    .setInputFiles({ name: 'forearm.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
  await artwork.getByLabel('Alignment policy').selectOption('normalized');
  await artwork.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
  await artwork.getByRole('button', { name: 'Apply Replacement', exact: true }).click();
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#editor-app')).toBeHidden();
  expect(
    await page.locator('#animation-stage canvas').evaluate((element, original) => element === original, canvas),
  ).toBe(true);
  await expect(page.locator('.package-tools summary')).toContainText('Assets: Modified');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await (await animationHierarchy(page)).getByRole('button', { name: 'root', exact: true }).click();
  await page.locator('#animation-bone-fields input[data-property="x"]').fill('14');
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('.package-tools summary')).toContainText('Animations: Modified');
  await page.locator('#editor-mode').selectOption('rig-tweak');
  await page.getByRole('treeitem', { name: 'leftForearm', exact: true }).click();
  await expect(page.locator('#tweak-inspector input[data-scope="bone"][data-field="y"]')).toHaveValue('77');
  await page.locator('#tweak-undo').click();
  await page.locator('#tweak-redo').click();
  await page.locator('#attachment-panel > summary').click();
  const skin = page.locator('#attachment-panel').getByLabel('Active skin', { exact: true });
  const skins = await skin
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  if (skins[1]) {
    await skin.selectOption(skins[1]);
    await skin.selectOption(skins[0]!);
  }
  await page.locator('#editor-mode').selectOption('animation');
  await page.locator('#animation-selection').selectOption('idle');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await page.locator('#animation-undo').click();
  await page.locator('#animation-redo').click();
  for (let index = 0; index < 4; ++index) {
    await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
    await page.getByRole('treeitem', { name: 'leftForearm', exact: true }).click();
    await expect(joint).toHaveValue('77');
    await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
    await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  }
  expect(await page.locator('canvas').count()).toBe(1);
  expect(
    await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
      return ids.filter((id, index) => ids.indexOf(id) !== index);
    }),
  ).toEqual([]);
  await page.goBack();
  await expect(page.locator('#editor-app')).toBeVisible();
  await page.goForward();
  await expect(page.locator('#animation-editor-app')).toBeVisible();
  expect(dialogs).toEqual([]);
  const packages = page.locator('.package-tools');
  await packages.locator('summary').click();
  const downloading = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  if (!path) throw new Error('Missing package download.');
  const files = decodePackageZip(await readFile(path));
  const rig = packageJson(files, 'rig.json') as {
    bones: { id: string; y?: number }[];
    attachments: { id: string; x?: number }[];
  };
  const forearm = rig.bones.find((bone) => bone.id === 'leftForearm')!;
  expect(forearm.y).toBe(77);
  expect(rig.attachments.find((attachment) => attachment.id === 'leftForearmDefault')!.x).toBe(9);
  await packages.getByRole('button', { name: 'Reload exported package', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Package runtime preview' });
  await expect(preview).toContainText('runtime playback ready', { timeout: 30_000 });
  await preview.getByRole('button', { name: 'Close preview' }).click();
  await packages.getByLabel('Import ZIP for runtime preview').setInputFiles(path);
  await expect(preview).toContainText('runtime playback ready', { timeout: 30_000 });
  await preview.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
});
