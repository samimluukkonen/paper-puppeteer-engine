import { expect, test } from '@playwright/test';

test('exported character plays, emits events, switches appearance and cleans up in another app', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Ready: demo-puppet / idle');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Walk', exact: true }).click();
  await expect(page.locator('#event')).toContainText('footstep');
  await page.getByRole('button', { name: 'Sword', exact: true }).click();
  await expect(page.locator('#event')).toContainText('weapon-ready');
  await page.getByRole('button', { name: 'IK reach', exact: true }).click();
  await expect(page.locator('#event')).toContainText('reach: reach-marker');
  await page.getByRole('button', { name: 'Baked reach', exact: true }).click();
  await expect(page.locator('#event')).toContainText('baked: reach-marker');
  await page.getByRole('button', { name: 'Switch skin' }).click();
  await expect(page.locator('#skin')).toHaveText('Skin: helmet-only');
  await page.locator('#skin').click();
  await expect(page.locator('#skin')).toHaveText('Skin: alternate');
  await page.locator('#skin').click();
  await expect(page.locator('#skin')).toHaveText('Skin: default');
  await page.getByRole('button', { name: 'Clean up' }).click();
  await expect(page.getByRole('status')).toHaveText('Disposed');
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Walk', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('cleanup cancels a metadata load before a puppet is created', async ({ page }) => {
  await page.route('**/character/character.json', async (route) => {
    // Hold the metadata response until the test has stopped the scene.
    await page.getByRole('status').filter({ hasText: 'Disposed' }).waitFor();
    await route.abort();
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Clean up' }).click();
  await expect(page.getByRole('status')).toHaveText('Disposed');
  await expect(page.locator('canvas')).toHaveCount(0);
});
