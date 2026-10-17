import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { rigDefinitionSchema } from '../../src/engine/schemas.js';
import { test, selectRigEntry } from './fixtures.js';

test('paused elbow tweak, separate history, export/reload and continued animation preserve every key', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('walk');
  await page.locator('#timeline-time-input').fill('0.4');
  await page.locator('#timeline-time-input').press('Enter');
  const downloadAnimation = async () => {
    const waiting = page.waitForEvent('download');
    await page.locator('#animation-download').click();
    const path = await (await waiting).path();
    if (!path) throw new Error('Missing animation download');
    return readFile(path, 'utf8');
  };
  const original = await downloadAnimation();
  await page.locator('#play-pause').click();
  await page.getByRole('combobox', { name: 'Editor Mode', exact: true }).selectOption('rig-tweak');
  const time = await page.locator('#timeline-time-input').inputValue();
  await expect(page.getByText('Editing rig data · Playback paused', { exact: true })).toBeVisible();
  await expect(page.locator('.timeline-panel')).toHaveAttribute('inert', '');
  await page.keyboard.press('Space');
  await expect(page.locator('#timeline-time-input')).toHaveValue(time);
  await selectRigEntry(page, 'leftForearm');
  const y = page.locator('#tweak-inspector input[data-scope="bone"][data-field="y"]');
  await expect(y).toHaveValue('60');
  const canvas = page.locator('#animation-stage canvas');
  const before = await canvas.screenshot();
  await y.fill('80');
  await y.press('Tab');
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
  await expect(page.locator('#tweak-dirty-status')).toHaveText('Rig: Modified');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.getByText('Editing rig data · Playback paused', { exact: true }).click();
  await page.keyboard.press('Delete');
  await page.locator('#tweak-undo').click();
  await expect(y).toHaveValue('60');
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(true);
  await page.locator('#tweak-redo').click();
  await expect(y).toHaveValue('80');
  await page.getByRole('combobox', { name: 'Editor Mode', exact: true }).selectOption('animation');
  expect(await downloadAnimation()).toBe(original);
  await page.locator('#timeline-time-input').fill('0.7');
  await page.locator('#timeline-time-input').press('Enter');
  await page.locator('#play-pause').click();
  await expect.poll(async () => page.locator('#timeline-time-input').inputValue()).not.toBe('0.7');
  await page.getByRole('combobox', { name: 'Editor Mode', exact: true }).selectOption('rig-tweak');
  const waiting = page.waitForEvent('download');
  await page.locator('#tweak-download-json').click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('rig.json');
  const path = await download.path();
  if (!path) throw new Error('Missing rig download');
  const rigText = await readFile(path, 'utf8');
  const rig = rigDefinitionSchema.parse(JSON.parse(rigText));
  expect(rig.bones.find((bone) => bone.id === 'leftForearm')!.y).toBe(80);
  await expect(page.locator('#tweak-dirty-status')).toHaveText('Rig: Clean');
  await page.locator('.rig-tweak-panel').getByText('Rig file tools', { exact: true }).click();
  await page.locator('#tweak-reload-original').click();
  await expect(y).toHaveValue('60');
  await page.locator('#tweak-reload-exported').click();
  await expect(y).toHaveValue('80');
  await page
    .locator('#tweak-load-json')
    .setInputFiles({ name: 'rig.json', mimeType: 'application/json', buffer: Buffer.from(rigText) });
  await expect(page.locator('#tweak-action-feedback')).toContainText('loaded and validated');
  await expect(y).toHaveValue('80');
  await page.getByRole('combobox', { name: 'Editor Mode', exact: true }).selectOption('animation');
  expect(await downloadAnimation()).toBe(original);
});

test('unsaved rig tweaks survive navigation to the Rig Editor and recover into its working copy', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.getByRole('combobox', { name: 'Editor Mode', exact: true }).selectOption('rig-tweak');
  await selectRigEntry(page, 'leftForearm');
  await page.locator('#tweak-inspector input[data-scope="bone"][data-field="y"]').fill('77');
  await page.locator('#tweak-inspector input[data-scope="bone"][data-field="y"]').press('Tab');
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.accept();
  });
  await page.goto('rig-editor/');
  await expect(page.locator('#rig-draft-status')).toContainText('Draft restored');
  await selectRigEntry(page, 'leftForearm');
  await expect(page.locator('#inspector input[data-scope="bone"][data-field="y"]')).toHaveValue('77');
  expect(dialogs).toContain('beforeunload');
});
