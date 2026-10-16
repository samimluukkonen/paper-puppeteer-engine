import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { packageJson } from '../../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip } from '../../src/devtools/shared/package/packageZip.js';
import { characterManifestSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

test('create from a failed load, author an independent draft and switch editor views', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('rig-editor/?character=unavailable');
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new character', exact: true });
  await dialog.getByLabel('Character name', { exact: true }).fill('Forest Guardian');
  await expect(dialog.getByLabel('Character ID', { exact: true })).toHaveValue('forest-guardian');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(page).toHaveURL(/rig-editor\/\?character=forest-guardian$/);
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await expect(page.getByLabel('Character draft', { exact: true })).toContainText(
    'Forest Guardian · forest-guardian · New / Unsaved',
  );
  await expect(page.locator('#hierarchy [role=treeitem]')).toHaveText(['root']);
  await expect(page.locator('#editor-stage canvas')).toBeVisible();
  const artwork = page.locator('#editor-app #artwork-panel');
  await artwork.locator(':scope > summary').click();
  await expect(artwork.getByLabel('Import new artwork', { exact: true })).toBeEnabled();
  await expect(artwork).toContainText('No artwork yet.');
  await page.getByRole('treeitem', { name: 'root', exact: true }).click();
  const x = page.locator('#inspector [data-field=x]');
  await x.fill('25');
  await x.blur();
  await expect(page.locator('#dirty-status')).toHaveText('Unsaved changes *');
  await page.locator('#undo').click();
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
  await page.locator('#redo').click();
  await expect(page.locator('#dirty-status')).toHaveText('Unsaved changes *');
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#animation-stage canvas')).toBeVisible();
  await expect(page.locator('#animation-selection')).toContainText('No animation');
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(x).toHaveValue('25');
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  await dialog.getByLabel('Character name', { exact: true }).fill('Other');
  await dialog.getByLabel('Character ID', { exact: true }).fill('forest-guardian');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already exists');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(x).toHaveValue('25');
  await Promise.all([
    page.waitForEvent('dialog').then(async (confirmation) => {
      expect(confirmation.type()).toBe('beforeunload');
      await confirmation.dismiss();
    }),
    page.locator('#character-selection').selectOption('demo-puppet'),
  ]);
  await expect(page).toHaveURL(/character=forest-guardian/);
  await expect(x).toHaveValue('25');
  expect(errors).toEqual([]);
});

test('create while an example is loaded without inheriting its rig or animations', async ({ page }) => {
  await page.goto('animation-editor/?character=random-paperdoll-sketch');
  await expect(page.locator('#animation-selection')).toContainText('idle');
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new character', exact: true });
  await dialog.getByLabel('Character name', { exact: true }).fill('Blank Puppet');
  await dialog.getByLabel('Character ID', { exact: true }).fill('demo-puppet');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already exists');
  await dialog.getByLabel('Character ID', { exact: true }).fill('blank-puppet');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await expect(page.locator('#hierarchy [role=treeitem]')).toHaveText(['root']);
  await expect(page.locator('#editor-app #artwork-panel')).toContainText('No artwork yet.');
  page.once('dialog', (confirmation) => {
    void confirmation.accept();
  });
  await page.locator('#character-selection').selectOption('demo-puppet');
  await expect(page.locator('#session-status')).toContainText('Character: demo-puppet');
  await expect(page.locator('#hierarchy [role=treeitem]')).not.toHaveCount(1);
  await page.locator('#character-selection').selectOption('blank-puppet');
  await expect(page.locator('#hierarchy [role=treeitem]')).toHaveText(['root']);
  await expect(page.getByLabel('Character draft', { exact: true })).toContainText('Blank Puppet');
});

test('first artwork imports into an empty draft and exports as a real image without dummy rig references', async ({
  page,
}) => {
  await page.goto('rig-editor/');
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new character', exact: true });
  await dialog.getByLabel('Character name', { exact: true }).fill('First Artwork');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  const artwork = page.locator('#editor-app #artwork-panel');
  await artwork.locator(':scope > summary').click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ac2345';
    context.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await artwork
    .getByLabel('Import new artwork', { exact: true })
    .setInputFiles({ name: 'guardian.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(artwork.getByLabel('Artwork asset', { exact: true })).toHaveValue('guardian');
  await expect(artwork).toContainText('Artwork added to the library.');
  const packages = page.locator('#editor-app .package-tools');
  await packages.locator(':scope > summary').click();
  const downloading = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const download = await downloading;
  const files = decodePackageZip(new Uint8Array(await readFile(await download.path())));
  const manifest = characterManifestSchema.parse(packageJson(files, 'character.json'));
  expect(manifest.id).toBe('first-artwork');
  expect(manifest.animations).toEqual([]);
  expect(manifest.textures).toEqual({ guardian: 'images/guardian.png' });
  expect(Buffer.from(files.get('images/guardian.png')!)).toEqual(Buffer.from(png, 'base64'));
  expect(packageJson(files, manifest.rig)).toEqual({
    version: 1,
    name: 'First Artwork',
    root: 'root',
    bones: [{ id: 'root' }],
    slots: [],
    attachments: [],
  });
  await expect(page.getByLabel('Character draft', { exact: true })).toContainText('Package downloaded');
});
