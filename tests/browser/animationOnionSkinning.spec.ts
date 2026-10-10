import { expect } from '@playwright/test';
import { test } from './fixtures.js';

test('onion skins render through scrubbing, facing, playback and boundaries without blocking editing or dirtying', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('walk');
  await page.locator('#animation-show-bones').uncheck();
  const ruler = page.getByRole('slider', { name: 'Animation time' });
  const canvas = page.locator('#animation-stage canvas');
  const toggle = page.getByRole('checkbox', { name: 'Onion Skinning', exact: true });
  const box = await ruler.boundingBox();
  if (!box) throw new Error('Missing timeline bounds.');
  await page.mouse.click(box.x + box.width * 0.35, box.y + 18);
  const normal = await canvas.screenshot();
  await toggle.check();
  await expect.poll(async () => (await canvas.screenshot()).equals(normal)).toBe(false);
  await canvas.screenshot({ path: test.info().outputPath('onion-right.png') });
  await toggle.uncheck();
  await expect.poll(async () => (await canvas.screenshot()).equals(normal)).toBe(true);
  await toggle.check();
  await page.locator('#animation-facing').selectOption('left');
  await canvas.screenshot({ path: test.info().outputPath('onion-left.png') });
  const mirrored = await canvas.screenshot();
  expect(mirrored.equals(normal)).toBe(false);
  await page.mouse.click(box.x + box.width * 0.7, box.y + 18);
  await expect.poll(async () => (await canvas.screenshot()).equals(mirrored)).toBe(false);
  await page.locator('#animation-show-bones').check();
  await page
    .locator('#animation-bones button')
    .filter({ hasText: /^head$/ })
    .click();
  await expect(page.locator('#animation-bone-title')).toContainText('head');
  await ruler.focus();
  await ruler.press('Home');
  await expect(ruler).toHaveAttribute('aria-valuenow', '0');
  await canvas.screenshot({ path: test.info().outputPath('onion-start.png') });
  await ruler.press('End');
  expect(Number(await ruler.getAttribute('aria-valuenow'))).toBe(Number(await ruler.getAttribute('aria-valuemax')));
  await canvas.screenshot({ path: test.info().outputPath('onion-end.png') });
  await page.locator('#reset-time').click();
  await page.locator('#play-pause').click();
  await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).toBeGreaterThan(0.05);
  await page.locator('#play-pause').click();
  await toggle.uncheck();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-selection').selectOption('idle');
  await toggle.check();
  await toggle.uncheck();
});
