import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';

async function start(page: Page, title: string) {
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.getByRole('button', { name: `Start Guide: ${title}`, exact: true }).click();
  return page.getByRole('dialog', { name: title, exact: true });
}

test('practice selects a real bone, commits a real key and preserves normal Undo/Redo', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const tour = await start(page, 'Create Your First Keyframe');
  await tour.getByRole('button', { name: 'Try It', exact: true }).click();
  await expect(tour).toHaveAttribute('aria-modal', 'false');
  const root = page.locator('#animation-bones').getByRole('button', { name: 'root', exact: true });
  await root.click();
  await expect(tour.getByRole('status')).toHaveText('A bone is selected.');
  await expect(tour).toContainText('Step 1 of 5');
  // A generic background click cannot trigger New Animation or history actions.
  await page.locator('#animation-new').evaluate((element) => {
    element.addEventListener('click', () => element.setAttribute('data-unrelated-click', 'true'));
  });
  const unrelated = await page.locator('#animation-new').boundingBox();
  if (!unrelated) throw new Error('Missing New Animation');
  await page.mouse.click(unrelated.x + 5, unrelated.y + 5);
  await expect(page.locator('#animation-new')).not.toHaveAttribute('data-unrelated-click', 'true');
  await expect(page.locator('#animation-dirty')).not.toContainText('Unsaved');
  // Delete/Home must not reach global timeline shortcuts from a focused practice control.
  await root.focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => !!document.activeElement?.closest('.guide-spotlight, [data-guide-id="animation-bones"]')),
  ).toBe(true);
  for (let i = 0; i < 3; i++) await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await tour.getByRole('button', { name: 'Try It', exact: true }).click();
  await expect(tour).toContainText('This changes your real animation');
  const key = page.getByRole('button', { name: 'Set X key', exact: true });
  await expect(key).toHaveAttribute('data-keyed', 'false');
  await key.focus();
  await page.keyboard.press('Enter');
  await expect(key).toHaveAttribute('data-keyed', 'true');
  await expect(tour.getByRole('status')).toHaveText('An X key is present at the current playhead.');
  await expect(tour).toContainText('Step 4 of 5');
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
  await page.locator('#animation-undo').click();
  await expect(key).toHaveAttribute('data-keyed', 'false');
  await page.locator('#animation-redo').click();
  await expect(key).toHaveAttribute('data-keyed', 'true');
});

test('onion practice recovers replaced/hidden targets, supports restart/catalog and releases input restrictions', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  let tour = await start(page, 'Onion Skinning');
  for (let cycle = 0; cycle < 3; cycle++) {
    await tour.getByRole('button', { name: 'Try It', exact: true }).click();
    const checkbox = page.locator('#animation-onion-skinning');
    await checkbox.focus();
    if (!(await checkbox.isChecked())) await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await expect(tour.getByRole('status')).toHaveText('Onion Skinning is enabled.');
    if (cycle === 0) {
      // Rerender the anchor while preserving the existing real checkbox and its editor listener.
      await checkbox.locator('..').evaluate((label) => {
        const replacement = label.cloneNode(false);
        replacement.appendChild(label.querySelector('input')!);
        replacement.appendChild(document.createTextNode(' Onion Skinning'));
        label.replaceWith(replacement);
      });
      await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
      await checkbox.uncheck();
      await expect(tour.getByRole('status')).toContainText('Practice is optional');
      await checkbox.check();
      await expect(tour.getByRole('status')).toHaveText('Onion Skinning is enabled.');
    }
    await checkbox.locator('..').evaluate((element) => ((element as HTMLElement).style.display = 'none'));
    await expect(tour).toContainText('currently unavailable');
    await expect(tour.locator('.guide-spotlight-hole')).toHaveCount(0);
    await checkbox.locator('..').evaluate((element) => ((element as HTMLElement).style.display = ''));
    await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
    await page.setViewportSize({ width: 1440 + cycle * 100, height: 1000 });
    await tour.getByRole('button', { name: 'Explain', exact: true }).click();
    await expect(tour).toHaveAttribute('aria-modal', 'true');
    await tour.getByRole('button', { name: 'Next', exact: true }).click();
    await tour.getByRole('button', { name: 'Restart guide', exact: true }).click();
    await expect(tour).toContainText('Step 1 of 4');
    await tour.getByRole('button', { name: 'Choose another guide', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Feature Guide', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start Guide: Onion Skinning', exact: true }).click();
    tour = page.getByRole('dialog', { name: 'Onion Skinning', exact: true });
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#character-workspace [inert]:not([hidden])')).toHaveCount(0);
  await page.locator('#animation-selection').selectOption('walk');
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(page.locator('#editor-app')).toBeVisible();
});

test('catalog offers a prerequisite guide and can launch it after a failed character load', async ({ page }) => {
  await page.goto('rig-editor/?character=unavailable');
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await catalog.getByRole('button', { name: 'Animation Editor', exact: true }).click();
  await catalog
    .getByRole('button', { name: 'Show prerequisite: Creating a New Character', exact: true })
    .first()
    .click();
  await expect(catalog.getByRole('button', { name: 'Rig Editor', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await catalog.getByRole('button', { name: 'Start Guide: Creating a New Character', exact: true }).click();
  const tour = page.getByRole('dialog', { name: 'Creating a New Character', exact: true });
  await expect(tour).toBeVisible();
  await page.keyboard.press('Escape');
});
