import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { loadPackageDefinition } from '../../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip } from '../../src/devtools/shared/package/packageZip.js';
import { test } from './fixtures.js';

test('build an arbitrary skeleton, import artwork, align its default skin and export a usable character', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('rig-editor/');
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new character', exact: true });
  await dialog.getByLabel('Character name', { exact: true }).fill('Branch Creature');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  const skeleton = page.getByRole('region', { name: 'Build skeleton', exact: true });
  await page.getByRole('treeitem', { name: 'root', exact: true }).click();
  await skeleton.getByLabel('Bone ID / name', { exact: true }).fill('base');
  await skeleton.getByRole('button', { name: 'Rename bone', exact: true }).click();
  for (const id of ['trunk', 'branch']) {
    await skeleton.getByLabel('New bone ID', { exact: true }).fill(id);
    await skeleton.getByRole('button', { name: '+ Add Bone', exact: true }).click();
    await expect(page.getByRole('treeitem', { name: id, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  const x = page.locator('#inspector [data-scope=bone][data-field=x]');
  await x.fill('35');
  await x.blur();
  page.once('dialog', (confirmation) => {
    void confirmation.dismiss();
  });
  await skeleton.getByLabel('Parent bone', { exact: true }).selectOption('base');
  await expect(skeleton.getByLabel('Parent bone', { exact: true })).toHaveValue('trunk');
  page.once('dialog', (confirmation) => {
    void confirmation.accept();
  });
  await skeleton.getByLabel('Parent bone', { exact: true }).selectOption('base');
  await expect(skeleton.getByLabel('Parent bone', { exact: true })).toHaveValue('base');
  await page.locator('#undo').click();
  await expect(skeleton.getByLabel('Parent bone', { exact: true })).toHaveValue('trunk');
  await page.locator('#redo').click();
  await expect(skeleton.getByLabel('Parent bone', { exact: true })).toHaveValue('base');
  await expect(x).toHaveValue('35');

  // Recover topology before importing images, which intentionally live only in this session.
  const accept = (confirmation: import('@playwright/test').Dialog) => {
    void confirmation.accept();
  };
  page.on('dialog', accept);
  await page.reload();
  await expect(page.locator('#hierarchy [role=treeitem]')).toHaveText(['base', 'trunk', 'branch']);
  page.off('dialog', accept);
  await page.getByRole('treeitem', { name: 'branch', exact: true }).click();
  await expect(x).toHaveValue('35');
  await skeleton.getByLabel('New slot ID', { exact: true }).fill('branch-visual');
  await skeleton.getByRole('button', { name: '+ Add Slot', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: '◇ branch-visual', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const artwork = page.locator('#editor-app #artwork-panel');
  await artwork.locator(':scope > summary').click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 48;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ac2345';
    context.fillRect(8, 4, 16, 40);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await artwork.getByLabel('Import new artwork', { exact: true }).setInputFiles({
    name: 'my-leaf.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(artwork).toContainText('Artwork added to the library.');
  const attachments = page.locator('#editor-app #attachment-panel');
  await attachments.getByLabel('Attachment ID', { exact: true }).fill('leaf-appearance');
  await attachments.getByRole('button', { name: 'Create attachment', exact: true }).click();
  await attachments.getByLabel('Assigned attachment', { exact: true }).selectOption('leaf-appearance');
  await expect(page.locator('#inspector [data-scope=attachment][data-field=originX]').first()).toBeVisible();
  for (const [field, value] of [
    ['originX', '0.25'],
    ['originY', '0.1'],
    ['x', '-8'],
    ['y', '3'],
  ] as const) {
    const input = page.locator(`#inspector [data-scope=attachment][data-field=${field}]`).first();
    await input.fill(value);
    await input.blur();
  }
  await page.locator('#inspector [data-scope=slot][data-field=depth]').fill('12');
  await page.locator('#inspector [data-scope=slot][data-field=depth]').blur();
  await page.locator('#rig-facing').selectOption('left');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('treeitem', { name: 'branch', exact: true }).click();
  await skeleton.getByRole('button', { name: 'Remove bone', exact: true }).click();
  await expect(skeleton).toContainText('slot "branch-visual"');
  await expect(page.getByRole('treeitem', { name: 'branch', exact: true })).toBeVisible();
  await skeleton.getByLabel('New bone ID', { exact: true }).fill('bud');
  await skeleton.getByRole('button', { name: '+ Add Bone', exact: true }).click();
  await page.locator('#undo').click();
  await expect(page.getByRole('treeitem', { name: 'bud', exact: true })).toHaveCount(0);
  await page.locator('#redo').click();
  await expect(page.getByRole('treeitem', { name: 'bud', exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: '◇ branch-visual', exact: true }).click();
  await expect(attachments.getByLabel('Assigned attachment', { exact: true })).toHaveValue('leaf-appearance');
  await expect(page.locator('#inspector [data-scope=attachment][data-field=originX]').first()).toHaveValue('0.25');
  await expect(artwork.getByLabel('Artwork asset', { exact: true })).toHaveValue('my-leaf');

  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#animation-selection')).toContainText('No animation');
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(page.locator('#hierarchy [role=treeitem]')).toHaveText([
    'base',
    'trunk',
    'branch',
    '◇ branch-visual',
    'bud',
  ]);
  const packages = page.locator('#editor-app .package-tools');
  await packages.locator(':scope > summary').click();
  const downloading = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const download = await downloading;
  const files = decodePackageZip(new Uint8Array(await readFile(await download.path())));
  const definition = await loadPackageDefinition(files);
  expect(definition.rig.root).toBe('base');
  expect(definition.rig.getBone('branch').parent).toBe('base');
  expect(definition.rig.getBone('branch').x).toBe(35);
  expect(definition.rig.getBone('bud').parent).toBe('branch');
  expect(definition.rig.getSlot('branch-visual').depth).toBe(12);
  expect(definition.rig.getAttachment('leaf-appearance')).toMatchObject({
    texture: 'my-leaf',
    originX: 0.25,
    originY: 0.1,
    x: -8,
    y: 3,
  });
  expect(definition.rig.skins[0]!.slots['branch-visual']).toBe('leaf-appearance');
  expect(Buffer.from(files.get('images/my-leaf.png')!)).toEqual(Buffer.from(png, 'base64'));
});
