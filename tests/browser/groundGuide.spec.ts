import { expect, test } from '@playwright/test';

test('scene ground controls render, follow the camera and persist independently of authored scenes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('scene-editor/');
  const create = async (id: string) => {
    await page.getByRole('button', { name: 'New Scene', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New Scene' });
    await dialog.getByLabel('Scene ID').fill(id);
    await dialog.getByRole('button', { name: 'Create scene', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  };
  await create('ground-first');
  const panel = page.locator('.ground-guide-controls');
  const y = panel.getByRole('spinbutton', { name: 'Ground Y', exact: true });
  const visible = panel.getByRole('checkbox', { name: 'Show ground guide' });
  await expect(panel).not.toHaveAttribute('open');
  await panel.getByText('Ground reference', { exact: true }).click();
  await expect(y).toHaveValue('0');
  await expect(visible).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Grid', exact: true }).uncheck();
  const canvas = page.locator('#scene-stage-canvas canvas');
  const hidden = await canvas.screenshot();
  await visible.check();
  await expect.poll(async () => (await canvas.screenshot()).equals(hidden)).toBe(false);
  await y.fill('50');
  await y.press('Enter');
  const beforeCamera = await canvas.screenshot();
  await canvas.hover();
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await canvas.screenshot()).equals(beforeCamera)).toBe(false);
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + bounds.height / 2 + 60, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await page.setViewportSize({ width: 1800, height: 1200 });
  await expect(y).toHaveValue('50');
  await y.fill('');
  await y.press('Enter');
  await expect(y).toHaveValue('50');
  await panel.getByRole('button', { name: 'Reset Ground Y' }).click();
  await expect(y).toHaveValue('0');
  await y.fill('75.5');
  await y.press('Tab');
  await create('ground-second');
  await expect(panel).not.toHaveAttribute('open');
  await panel.getByText('Ground reference', { exact: true }).click();
  await expect(y).toHaveValue('0');
  await expect(visible).not.toBeChecked();
  await page.getByLabel('Select scene').selectOption('ground-first');
  await panel.getByText('Ground reference', { exact: true }).click();
  await expect(y).toHaveValue('75.5');
  await expect(visible).toBeChecked();
  // Mark both new documents saved so a reload has no unsaved-document confirmation.
  await page.getByRole('button', { name: 'Download scene JSON' }).click();
  await page.getByLabel('Select scene').selectOption('ground-second');
  await page.getByRole('button', { name: 'Download scene JSON' }).click();
  await page.reload();
  await create('ground-first');
  await panel.getByText('Ground reference', { exact: true }).click();
  await expect(y).toHaveValue('75.5');
  await expect(visible).toBeChecked();
  expect(errors).toEqual([]);
});
