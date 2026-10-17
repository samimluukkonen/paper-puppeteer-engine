import { expect } from '@playwright/test';
import { animationHierarchy, animationMenuControl, test, selectRigEntry } from './fixtures.js';

for (const view of [
  { route: './', prefix: 'demo', stage: '#stage', ready: '#status-text', text: 'Current: idle' },
  { route: 'rig-editor/', prefix: 'rig', stage: '#editor-stage', ready: '#validation', text: 'Validation: OK' },
  {
    route: 'animation-editor/',
    prefix: 'animation',
    stage: '#animation-stage',
    ready: '#animation-status',
    text: 'Validation: OK',
  },
]) {
  test(`${view.prefix} workspace fits desktop viewports and contains its canvas`, async ({ page }) => {
    for (const [width, height] of [
      [1280, 800],
      [1440, 900],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await page.goto(view.route);
      await expect(page.locator(view.ready)).toContainText(view.text);
      const stage = (await page.locator(view.stage).boundingBox())!;
      const canvas = (await page.locator(`${view.stage} canvas`).boundingBox())!;
      expect(stage.height).toBeGreaterThan(view.prefix === 'animation' ? 200 : 400);
      expect(canvas.x).toBeGreaterThanOrEqual(stage.x);
      expect(canvas.y).toBeGreaterThanOrEqual(stage.y);
      expect(canvas.x + canvas.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
      expect(canvas.y + canvas.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  });

  test(`${view.prefix} narrow inspector, Escape, help focus, and breakpoint changes`, async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.goto(view.route);
    await expect(page.locator(view.ready)).toContainText(view.text);
    const toggle = page.locator(`#${view.prefix}-inspector-toggle`);
    const inspector = page.locator(`#${view.prefix}-inspector`);
    await expect(inspector).not.toBeVisible();
    await expect(inspector).toHaveAttribute('inert', '');
    const canvas = page.locator(`${view.stage} canvas`);
    const originalCanvas = await canvas.elementHandle();
    await toggle.click();
    await expect(inspector).toBeVisible();
    await expect(inspector).not.toHaveAttribute('inert');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    if (view.prefix === 'rig') {
      await selectRigEntry(page, 'head');
      const x = page.locator('#inspector input[data-field="x"]');
      await x.fill('12');
      await x.press('Tab');
      await expect(page.locator('#dirty-status')).toContainText('Unsaved changes');
    } else if (view.prefix === 'animation') {
      await (await animationHierarchy(page)).getByRole('button', { name: 'head', exact: true }).click();
      await page.locator('#animation-bone-fields [data-property="x"]').fill('12');
      await page.getByRole('button', { name: 'Set X key', exact: true }).click();
      await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
    } else {
      await page.locator('[data-action="walk"]').click();
      await expect(page.locator('#status-text')).toContainText('Current: walk');
    }
    await page.locator(`#${view.prefix}-inspector-close`).click();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(inspector).not.toBeVisible();
    await expect(toggle).toBeFocused();
    const help = page.locator(`#${view.prefix}-help-open`);
    if (view.prefix === 'animation') await (await animationMenuControl(page, '#animation-help-open')).click();
    else await help.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    if (view.prefix === 'rig') {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Control+z');
      await expect(page.locator('#inspector input[data-field="x"]')).toHaveValue('12');
    } else if (view.prefix === 'demo') {
      await page.keyboard.press('1');
      await expect(page.locator('#status-text')).toContainText('Current: walk');
    }
    await page.keyboard.press('Escape');
    await expect(help).toBeFocused();
    await toggle.click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(inspector).toBeVisible();
    await expect(inspector).not.toHaveAttribute('inert');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(inspector).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await toggle.click();
    if (view.prefix === 'rig') await expect(page.locator('#inspector input[data-field="x"]')).toHaveValue('12');
    else if (view.prefix === 'animation')
      await expect(page.locator('#animation-bone-fields [data-property="x"]')).toHaveValue('12');
    else await expect(page.locator('[data-action="walk"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(true);
  });
}
