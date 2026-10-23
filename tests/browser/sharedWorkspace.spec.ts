import { expect } from '@playwright/test';
import { animationHierarchy, animationMenuControl, test, selectRigEntry } from './fixtures.js';

for (const view of [
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
    test.setTimeout(90000);
    for (const [width, height] of [
      [1280, 800],
      [1440, 900],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await page.goto(view.route);
      await expect(page.locator(view.ready)).toContainText(view.text);
      if (view.prefix === 'rig') await expect(page.getByLabel('Local save status')).toBeVisible();
      const stage = (await page.locator(view.stage).boundingBox())!;
      const canvas = (await page.locator(`${view.stage} canvas`).boundingBox())!;
      expect(stage.height).toBeGreaterThan(view.prefix === 'animation' ? 200 : 400);
      expect(canvas.x).toBeGreaterThanOrEqual(stage.x);
      expect(canvas.y).toBeGreaterThanOrEqual(stage.y);
      expect(canvas.x + canvas.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
      expect(canvas.y + canvas.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
      if (view.prefix === 'rig') {
        await expect(page.locator('#rig-inspector details[open]')).toHaveCount(0);
        const inspector = (await page.locator('#rig-inspector').boundingBox())!;
        const preview = (await page.locator('#editor-app .workspace-preview').boundingBox())!;
        const header = (await page.locator('#editor-app .view-header').boundingBox())!;
        expect(inspector.x).toBeLessThan(preview.x);
        const content = (await page.locator('#editor-app .view-content').boundingBox())!;
        expect(content.y).toBeGreaterThanOrEqual(header.y + header.height + 8);
        expect(preview.y).toBe(content.y);
        expect(preview.y + preview.height).toBeCloseTo(height! - 12, 0);
        expect(stage.y + stage.height).toBeCloseTo(preview.y + preview.height - 1, 0);
        expect(stage.width / stage.height).toBeCloseTo(210 / 297, 3);
        expect(canvas.width / canvas.height).toBeCloseTo(210 / 297, 3);
        expect(canvas.height).toBeCloseTo(stage.height, 0);
      }
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
    }
    await page.keyboard.press('Escape');
    await expect(help).toBeFocused();
    await toggle.click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(inspector).toBeVisible();
    await expect(inspector).not.toHaveAttribute('inert');
    await page.setViewportSize({ width: 850, height: 768 });
    await expect(inspector).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(850);
    await toggle.click();
    if (view.prefix === 'rig') await expect(page.locator('#inspector input[data-field="x"]')).toHaveValue('12');
    else if (view.prefix === 'animation')
      await expect(page.locator('#animation-bone-fields [data-property="x"]')).toHaveValue('12');
    expect(await canvas.evaluate((element, original) => element === original, originalCanvas)).toBe(true);
  });
}

test('rig preview divider resizes by keyboard and pointer and resets without editing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await expect(page.getByLabel('Local save status')).toBeVisible();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const divider = page.getByRole('separator', { name: 'Rig preview width', exact: true });
  const inspector = page.locator('#rig-inspector');
  const preview = page.locator('#editor-app .workspace-preview');
  const initial = (await preview.boundingBox())!;
  await divider.press('ArrowLeft');
  expect((await preview.boundingBox())!.width).toBeCloseTo(Math.round(initial.width) + 10, 0);
  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 40, handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await preview.boundingBox())!.width).toBeCloseTo(Math.round(initial.width) + 50, 0);
  await divider.press('End');
  expect((await inspector.boundingBox())!.width).toBe(320);
  for (const selector of ['.rig-session-editing', '.rig-session-actions']) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual((await inspector.boundingBox())!.x + 320);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await divider.press('Home');
  expect((await preview.boundingBox())!.width).toBe(280);
  await page.locator('#rig-reset-layout').click();
  await expect(divider).toHaveAttribute('aria-valuenow', String(Math.round(initial.width)));
  expect((await preview.boundingBox())!.width).toBeCloseTo(initial.width, 0);
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
});
