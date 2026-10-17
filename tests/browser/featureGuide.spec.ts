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
  await expect(dialog.getByRole('button', { name: /^Start Guide:/ }).last()).toBeFocused();
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
      const start = dialog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true });
      if (['animation-ik-targets', 'animation-ik-baking'].includes(guide.id)) await expect(start).toBeDisabled();
      else await expect(start).toBeEnabled();
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
  await expect(page.getByRole('dialog', { name: 'Timeline Navigation', exact: true })).toBeVisible();
  expect(
    await page.locator('#animation-stage canvas').evaluate((element, original) => element === original, canvas),
  ).toBe(true);
  await page
    .getByRole('dialog', { name: 'Timeline Navigation', exact: true })
    .getByRole('button', { name: 'Exit', exact: true })
    .click();
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await dialog.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start Guide: Editing Joint Positions', exact: true }).click();
  await expect(page).toHaveURL(/rig-editor\/$/);
  await expect(x).toHaveValue('23');
  await expect(page.locator('#dirty-status')).toContainText('Unsaved changes');
  await page
    .getByRole('dialog', { name: 'Editing Joint Positions', exact: true })
    .getByRole('button', { name: 'Exit', exact: true })
    .click();
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
  for (const start of await dialog.getByRole('button', { name: /^Start Guide:/ }).all())
    await expect(start).toBeDisabled();
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
  await expect(
    dialog.getByRole('button', { name: 'Start Guide: Creating a New Character', exact: true }),
  ).toBeEnabled();
  for (const guide of guideRegistry.getGuidesForEditor('rig').filter((guide) => guide.id !== 'rig-new-character'))
    await expect(dialog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Animation Editor', exact: true }).click();
  for (const start of await dialog.getByRole('button', { name: /^Start Guide:/ }).all())
    await expect(start).toBeDisabled();
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
  for (const guide of guideRegistry.getGuidesForEditor('rig')) {
    const start = dialog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true });
    if (['rig-aligning-sprites', 'rig-ik-constraints'].includes(guide.id)) await expect(start).toBeDisabled();
    else await expect(start).toBeEnabled();
  }
  await expect(dialog).toContainText('Create a chain of three connected bones');
  await expect(dialog).toContainText('Add artwork to a bone or create a sprite attachment first.');
  await dialog.getByRole('button', { name: 'Animation Editor', exact: true }).click();
  await expect(dialog).toContainText('Create or select an animation first.');
  for (const guide of guideRegistry.getGuidesForEditor('animation')) {
    const start = dialog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true });
    if (['animation-new', 'animation-rig-tweak'].includes(guide.id)) await expect(start).toBeEnabled();
    else await expect(start).toBeDisabled();
  }
});

test('spotlight reveals collapsed panels, contains focus, blocks editor input, navigates and finishes safely', async ({
  page,
}) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await expect(page.locator('#rig-inspector details[open]')).toHaveCount(0);
  const open = page.getByRole('button', { name: 'Feature Guide', exact: true });
  await open.click();
  await page.getByRole('button', { name: 'Start Guide: Editing Joint Positions', exact: true }).click();
  const tour = page.getByRole('dialog', { name: 'Editing Joint Positions', exact: true });
  await expect(tour).toBeVisible();
  await expect(tour.getByRole('heading', { name: 'Editing Joint Positions', exact: true })).toBeFocused();
  await expect(tour).toContainText('Step 1 of 6');
  await expect(tour).toContainText('Read-only tour');
  await expect(page.locator('.workspace-hierarchy')).toHaveAttribute('open', '');
  await expect(tour.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  await page.keyboard.press('Shift+Tab');
  await expect(tour.getByRole('button', { name: 'Exit', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tour.getByRole('button', { name: 'Next', exact: true })).toBeFocused();
  // The visual hole must not forward a click or keyboard editing shortcut to the editor.
  await page.locator('#hierarchy').evaluate((element) => {
    element.setAttribute('data-guide-clicks', '0');
    element.addEventListener('click', () => element.setAttribute('data-guide-clicks', '1'), { once: true });
  });
  const hierarchy = (await page.locator('#hierarchy').boundingBox())!;
  await page.mouse.click(hierarchy.x + 40, hierarchy.y + 15);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#hierarchy')).toHaveAttribute('data-guide-clicks', '0');
  await expect(page.locator('#dirty-status')).not.toContainText('Unsaved changes');
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(tour).toContainText('Step 2 of 6');
  await expect(tour).toContainText('Choose Joint Editing');
  await tour.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(tour).toContainText('Step 1 of 6');
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(tour).toContainText('Step 4 of 6');
  const canvas = (await page.locator('#editor-stage canvas').boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.rig-selection-details')).toHaveAttribute('open', '');
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await tour.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(tour).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(page.locator('#dirty-status')).not.toContainText('Unsaved changes');
  await open.click();
  await page.getByRole('button', { name: 'Start Guide: Editing Joint Positions', exact: true }).click();
  await expect(tour).toContainText('Step 1 of 6');
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('spotlight follows desktop resize, scrolling and zoom, places its card in bounds, and honors reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.getByRole('button', { name: 'Start Guide: Editing Joint Positions', exact: true }).click();
  const tour = page.getByRole('dialog', { name: 'Editing Joint Positions', exact: true });
  const hole = tour.locator('.guide-spotlight-hole');
  const target = page.locator('.workspace-hierarchy');
  const aligned = async () => {
    await expect
      .poll(async () => {
        const spotlight = await hole.boundingBox();
        const bounds = await target.boundingBox();
        if (!spotlight || !bounds) return false;
        return (
          Math.abs(spotlight.x - Math.max(0, bounds.x - 4)) < 2 && Math.abs(spotlight.y - Math.max(0, bounds.y - 4)) < 2
        );
      })
      .toBe(true);
  };
  for (const width of [1280, 1920, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await aligned();
    const card = (await tour.locator('.guide-step-card').boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(15);
    expect(card.y).toBeGreaterThanOrEqual(15);
    expect(card.x + card.width).toBeLessThanOrEqual(width - 15);
    expect(card.y + card.height).toBeLessThanOrEqual(885);
    const spot = (await hole.boundingBox())!;
    expect(
      card.x >= spot.x + spot.width ||
        card.x + card.width <= spot.x ||
        card.y >= spot.y + spot.height ||
        card.y + card.height <= spot.y,
    ).toBe(true);
  }
  await page.locator('#rig-inspector').evaluate((element) => element.scrollBy(0, 20));
  await aligned();
  // CSS layout zoom exercises changed CSS-pixel bounds without relying on browser chrome shortcuts.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#character-workspace')!.style.zoom = '0.9';
  });
  await aligned();
  await expect(hole).toHaveCSS('transition-duration', '0s');
  await expect(tour.locator('.guide-step-card')).toHaveCSS('transition-duration', '0s');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#character-workspace')!.style.zoom = '';
  });
});

test('disappearing targets show Skip/Exit, recover after reveal, and never leave a stale hole', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.getByRole('button', { name: 'Start Guide: Editing Joint Positions', exact: true }).click();
  const tour = page.getByRole('dialog', { name: 'Editing Joint Positions', exact: true });
  const target = page.locator('.workspace-hierarchy');
  await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
  await target.evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await expect(tour.getByRole('status')).toContainText('currently unavailable');
  await expect(tour.locator('.guide-spotlight-hole')).toHaveCount(0);
  await expect(tour.getByRole('button', { name: 'Skip', exact: true })).toBeEnabled();
  await target.evaluate((element) => {
    (element as HTMLElement).style.display = '';
  });
  await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
  await expect(tour.getByRole('status')).toHaveCount(0);
  await target.evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await tour.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(tour).toContainText('Step 2 of 6');
  await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await page.locator('#editor-stage').evaluate((element) => {
    element.setAttribute('hidden', '');
  });
  await tour.getByRole('button', { name: 'Skip', exact: true }).click();
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await tour.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(tour).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
});
