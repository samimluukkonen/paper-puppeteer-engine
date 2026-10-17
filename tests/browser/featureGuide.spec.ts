import { expect } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { animationHierarchy, selectRigEntry, test } from './fixtures.js';

test.describe.configure({ timeout: 60_000 });

test('feature selection uses the registry, keyboard categories, modal focus containment and restoration', async ({
  page,
}) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  const open = page.getByRole('button', { name: 'Feature Guide', exact: true });
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: /^Start Guide:/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  for (const editor of ['animation', 'rig'] as const) {
    const category = dialog.getByRole('button', {
      name: editor === 'rig' ? 'Rig Editor' : 'Animation Editor',
      exact: true,
    });
    await category.focus();
    await page.keyboard.press('Space');
    await expect(category).toHaveAttribute('aria-pressed', 'true');
    for (const guide of guideRegistry.getGuidesForEditor(editor)) {
      await expect(dialog.getByRole('heading', { name: guide.title, exact: true })).toBeVisible();
      await expect(dialog.getByText(guide.description, { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true })).toBeEnabled();
    }
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();
  await open.click();
  await close.click();
  await expect(open).toBeFocused();
  await expect(page.locator('#rig-inspector details[open]')).toHaveCount(0);
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await open.click();
    await expect(dialog).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await close.click();
  }
});

test('launch switches editors, retains unsaved work and one canvas, and activates the selected guide', async ({
  page,
}) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await selectRigEntry(page, 'head');
  const x = page.locator('#inspector input[data-field="x"]');
  await x.fill('23');
  await x.press('Tab');
  const canvas = await page.locator('#editor-stage canvas').elementHandle();
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await dialog.getByRole('button', { name: 'Animation Editor', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start Guide: Timeline Navigation', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/animation-editor\/$/);
  await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
  expect(
    await page.locator('#animation-stage canvas').evaluate((element, original) => element === original, canvas),
  ).toBe(true);
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await expect(dialog).toContainText('Current guide: Timeline Navigation');
  await dialog.getByRole('button', { name: 'Exit guide', exact: true }).click();
  await dialog.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start Guide: Editing Joint Positions', exact: true }).click();
  await expect(page).toHaveURL(/rig-editor\/$/);
  await expect(x).toHaveValue('23');
  await expect(page.locator('#dirty-status')).toContainText('Unsaved changes');
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await expect(dialog).toContainText('Current guide: Editing Joint Positions');
  await dialog.getByRole('button', { name: 'Exit guide', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.goBack();
  await expect(page.locator('#animation-editor-app')).toBeVisible();
});

test('pending animation previews disable cross-editor guides without discarding the preview', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toContainText('Validation: OK');
  await (await animationHierarchy(page)).getByRole('button', { name: 'head', exact: true }).click();
  const x = page.locator('#animation-bone-fields input[data-property="x"]');
  await x.fill('27');
  await x.press('Tab');
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await dialog.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  await expect(dialog).toContainText('Commit or revert uncommitted animation previews');
  await expect(dialog.getByRole('button', { name: /^Start Guide:/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(x).toHaveValue('27');
  await expect(x).toHaveAttribute('data-temporary', 'true');
  await expect(page).toHaveURL(/animation-editor\/$/);
});

test('failed character loads leave the modal usable with explicit unavailable reasons', async ({ page }) => {
  await page.goto('rig-editor/?character=unavailable');
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await expect(dialog).toContainText('No character is loaded.');
  await expect(dialog).toContainText('Load or create a character first.');
  await expect(dialog.getByRole('button', { name: /^Start Guide:/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Animation Editor', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^Start Guide:/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
});

test('a new character offers rig guides and explains the missing animation', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create new character', exact: true });
  await create.getByLabel('Character name', { exact: true }).fill('Guide draft');
  await create.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(page).toHaveURL(/rig-editor\/\?character=guide-draft$/);
  await expect(page.locator('#validation')).toHaveText('Validation: OK', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await expect(dialog.getByRole('button', { name: /^Start Guide:/ })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Animation Editor', exact: true }).click();
  await expect(dialog).toContainText('Create or select an animation first.');
  await expect(dialog.getByRole('button', { name: /^Start Guide:/ })).toBeDisabled();
});
