import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

async function editRoot(page: Page, value: string): Promise<void> {
  await page.locator('#animation-bones').getByRole('button', { name: 'root', exact: true }).click();
  await page.locator('#animation-bone-fields input[data-property="x"]').fill(value);
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
}

test('download saves authored JSON and allows switching; discard restores the downloaded baseline', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-discard')).toBeDisabled();
  await editRoot(page, '17');
  // A field draft is preview-only and must not appear in the downloaded file.
  await page.locator('#animation-bone-fields input[data-property="x"]').fill('99');
  const waiting = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('idle.json');
  const path = await download.path();
  if (!path) throw new Error('Animation download has no local file.');
  const animation = animationFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  expect(animation.version).toBe(1);
  expect(animation.name).toBe('idle');
  expect(animation.tracks.root?.find((key) => key.time === 0)?.x).toBe(17);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-selection').selectOption('walk');
  await page.locator('#animation-selection').selectOption('idle');
  const x = page.locator('#animation-bone-fields input[data-property="x"]');
  await expect(x).toHaveValue('17');
  await editRoot(page, '23');
  await Promise.all([
    page.waitForEvent('dialog').then((dialog) => dialog.dismiss()),
    page.locator('#animation-discard').click(),
  ]);
  await expect(x).toHaveValue('23');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await Promise.all([
    page.waitForEvent('dialog').then((dialog) => dialog.accept()),
    page.locator('#animation-discard').click(),
  ]);
  await expect(x).toHaveValue('17');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('a failed download retains unsaved changes and reports an actionable error', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await editRoot(page, '17');
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error('Download unavailable');
    };
  });
  await page.locator('#animation-download').click();
  await expect(page.locator('#animation-export-feedback')).toContainText('Download unavailable');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-status')).toContainText('Unsaved animation changes');
});
