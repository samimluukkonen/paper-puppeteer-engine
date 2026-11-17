import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { test } from './fixtures.js';

async function activeFrame(page: Page) {
  const iframe = page.locator('iframe:visible');
  await expect(iframe).toHaveCount(1);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error('Missing editor frame.');
  return frame;
}

test('character variants expose shared ownership, independent templates and portable identities', async ({ page }) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
  await dialog.getByLabel('Project name').fill('Variant Film');
  await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'New Character', exact: true });
  await dialog.getByLabel('Character name').fill('Samurai');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = (name: string) =>
    page.locator('.project-assets li').filter({ has: page.getByText(name, { exact: true }) });
  await row('Samurai').getByRole('button', { name: 'Rig Editor', exact: true }).click();
  let frame = await activeFrame(page);
  await expect(frame.locator('#validation')).toHaveText('Validation: OK');
  // The bridge owns the real documents; prepare an alternate skin without unrelated rigging gestures.
  const token = new URL(frame.url()).searchParams.get('projectSession')!;
  await page.evaluate((token) => {
    const context = window.paperProjectEditor?.(token);
    if (context?.kind !== 'character') throw new Error('Character context is unavailable.');
    context.characterDocuments.rig.createSkin('blue-armor');
    context.changed();
  }, token);
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await row('Samurai').getByRole('button', { name: 'Create Character Variant', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Create Character Variant', exact: true });
  await dialog.getByLabel('New character name').fill('Blue Armor Samurai');
  await expect(dialog.getByLabel('Rig ownership')).toHaveValue('shared');
  await dialog.getByLabel('Appearance skin').selectOption('blue-armor');
  await dialog.getByRole('button', { name: 'Create Variant', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row('Blue Armor Samurai')).toContainText('Shared rig and animations: samurai');
  await page.getByLabel('Appearance for Blue Armor Samurai').selectOption('default');
  await page.getByRole('button', { name: 'Undo Project', exact: true }).click();
  await expect(page.getByLabel('Appearance for Blue Armor Samurai')).toHaveValue('blue-armor');
  await row('Samurai').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('shared-rig variants');
  await row('Blue Armor Samurai').getByRole('button', { name: 'Edit Shared Rig', exact: true }).click();
  frame = await activeFrame(page);
  await expect(frame.locator('.view-header:visible')).toContainText(
    'Shared rig and animations: edits here affect Samurai, Blue Armor Samurai',
  );
  await expect(frame.locator('#rig-inspector details[open]')).toHaveCount(0);
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  const download = page.waitForEvent('download');
  await row('Blue Armor Samurai').getByRole('button', { name: 'Download Character ZIP', exact: true }).click();
  const downloaded = await download;
  const files = decodePackageZip(new Uint8Array(await readFile(await downloaded.path())));
  const manifest = JSON.parse(new TextDecoder().decode(files.get('character.json'))) as {
    id: string;
    defaultSkin: string;
  };
  expect(manifest.id).toBe('blue-armor-samurai');
  expect(manifest.defaultSkin).toBe('blue-armor');
  await row('Samurai').getByLabel('Reusable template').check();
  await page.getByRole('button', { name: 'New from Template', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'New Character from Template', exact: true });
  await dialog.getByLabel('New character name').fill('Independent Soldier');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  frame = await activeFrame(page);
  await expect(frame.locator('.view-header:visible')).toContainText('Independent Soldier');
  await expect(frame.locator('.view-header:visible')).not.toContainText('Shared rig and animations');
  await expect(frame.locator('#validation')).toHaveText('Validation: OK');
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await expect(row('Independent Soldier')).toContainText('Independent rig: independent-soldier');
  await page.getByRole('button', { name: 'Validate Project', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Project validation', exact: true })).toContainText('0 Errors');
});
