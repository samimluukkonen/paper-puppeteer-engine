import { expect } from '@playwright/test';
import { test } from './fixtures.js';

test('demo loads artwork and responds to playback, facing, skin and IK controls', async ({ page }) => {
  await page.goto('./');
  const status = page.locator('#status-text');
  const canvas = page.locator('#stage canvas');
  await expect(status).toContainText('Current: idle');
  await expect(canvas).toBeVisible();
  await page.locator('[data-action="walk"]').click();
  await expect(status).toContainText('Current: walk');
  await page.locator('[data-action="stepped"]').click();
  await expect(status).toContainText('Playback: stepped 10 FPS');
  await page.locator('[data-action="pause"]').click();
  await expect(status).toContainText('Paused: true');
  const facingRight = await canvas.screenshot();
  await page.locator('[data-action="left"]').click();
  await expect(page.locator('[data-action="left"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await canvas.screenshot()).equals(facingRight)).toBe(false);
  await page.locator('[data-action="armoredSkin"]').click();
  await expect(page.locator('[data-action="armoredSkin"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="sword"]').click();
  await expect(status).toContainText('Current: sword');
  await expect(page.locator('[data-action="handIK"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="ikDebug"]').click();
  await expect(page.locator('[data-action="ikDebug"]')).toHaveAttribute('aria-pressed', 'true');
});

test('demo shortcuts respect form focus and native button activation', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status-text')).toContainText('Current: idle');
  const left = page.locator('[data-action="left"]');
  await page.locator('#character-selection').focus();
  await page.keyboard.press('a');
  await expect(left).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-action="pause"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#status-text')).toContainText('Paused: true');
  await expect(page.locator('#status-text')).not.toContainText('(stopped)');
  await page.locator('[data-action="pause"]').press('Space');
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Alt+a');
  await expect(left).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('a');
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(page.locator('#status-text')).toContainText('(stopped)');
});

test('demo and editor navigation preserves the deployment path and loads fresh scenes', async ({ page, baseURL }) => {
  await page.goto('./');
  await expect(page.locator('#status-text')).toContainText('Current: idle');
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(page).toHaveURL(new URL('rig-editor/', baseURL!).href);
  await page.getByRole('treeitem', { name: 'head', exact: true }).click();
  const x = page.locator('#inspector input[data-field="x"]');
  await x.fill('12');
  await page.locator('#log-json').click();
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('link', { name: 'Engine demo' }).click();
  await expect(page).toHaveURL(baseURL!);
  await expect(page.locator('#status-text')).toContainText('Current: idle');
  await expect(page.locator('#stage canvas')).toBeVisible();
  await page.reload();
  await expect(page.locator('#status-text')).toContainText('Current: idle');
});
