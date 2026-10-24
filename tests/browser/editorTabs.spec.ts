import { expect } from '@playwright/test';
import { test } from './fixtures.js';

for (const editor of ['rig', 'animation', 'scene'] as const) {
  test(`${editor} tabs preserve controls, support keys and reclaim desktop height`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${editor}-editor/`);
    if (editor !== 'scene')
      await expect(page.locator(editor === 'rig' ? '#validation' : '#animation-status')).toHaveText('Validation: OK');
    const tabs = page.getByRole('tablist', {
      name: `${editor === 'rig' ? 'Rig' : editor === 'animation' ? 'Animation' : 'Scene'} editor controls`,
    });
    const edit = tabs.getByRole('tab', { name: 'Edit', exact: true });
    const draft = tabs.getByRole('tab', { name: 'Local draft', exact: true });
    const panel = page.locator(`#${editor}-edit-panel`);
    await expect(edit).toHaveAttribute('aria-selected', 'true');
    const control =
      editor === 'rig'
        ? page.locator('#grid-snap')
        : editor === 'animation'
          ? page.locator('#animation-selection')
          : page.getByLabel('Select scene');
    const original = await control.elementHandle();
    if (editor === 'rig') await control.selectOption('5');
    if (editor === 'animation') await control.selectOption('walk');
    const chrome = page.locator('.editor-tabs:visible');
    const expandedHeight = (await chrome.boundingBox())!.height;
    await page.getByRole('button', { name: 'Collapse editor controls', exact: true }).click();
    await expect(panel).toBeHidden();
    expect((await chrome.boundingBox())!.height).toBeLessThan(expandedHeight - 20);
    await edit.focus();
    await edit.press('End');
    await expect(draft).toBeFocused();
    await expect(draft).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Local save status')).toBeVisible();
    await expect(panel).toBeHidden();
    await draft.press('Home');
    await expect(edit).toBeFocused();
    await expect(panel).toBeVisible();
    expect(await control.evaluate((element, initial) => element === initial, original)).toBe(true);
    if (editor === 'rig') await expect(control).toHaveValue('5');
    if (editor === 'animation') await expect(control).toHaveValue('walk');
    await edit.press('ArrowLeft');
    await expect(draft).toBeFocused();
    await draft.press('ArrowRight');
    await expect(edit).toBeFocused();
    if (editor !== 'scene') {
      await tabs.getByRole('tab', { name: 'Character package', exact: true }).click();
      await expect(page.locator('.package-tools')).toBeVisible();
      await expect(panel).toBeHidden();
      await edit.click();
    }
    await expect(
      page.locator(editor === 'scene' ? '.scene-inspector details[open]' : `#${editor}-inspector details[open]`),
    ).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
    expect(errors).toEqual([]);
  });
}

test('tab reveal opens a hidden panel while controls are collapsed', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Collapse editor controls', exact: true }).click();
  await page.locator('#rig-package-panel').evaluate((panel) => {
    panel.dispatchEvent(new CustomEvent('workspace:reveal-tab', { bubbles: true, detail: 'rig-package' }));
  });
  await expect(page.getByRole('tab', { name: 'Character package', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.package-tools')).toBeVisible();
});

test('Project Workspace shares tabs and keeps local save controls behind Local draft', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('project/');
  const tabs = page.getByRole('tablist', { name: 'Project workspace controls' });
  await expect(tabs.getByRole('tab', { name: 'Project', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
  await dialog.getByLabel('Project name').fill('Tab workspace');
  await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tab workspace', exact: true })).toBeVisible();
  await expect(page.getByLabel('Local save status')).toBeHidden();
  await tabs.getByRole('tab', { name: 'Local draft', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Project', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Collapse editor controls', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toBeHidden();
  await tabs.getByRole('tab', { name: 'Project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export Project', exact: true })).toBeVisible();
  await expect(page.locator('.project-settings')).not.toHaveAttribute('open');
  await page.screenshot({ path: info.outputPath('project-tabs.png') });
});

test('startup recovery stays visible when the Local draft tab is inactive', async ({ page }) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name').fill('Recovered tabs');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: 'Close recovery', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Project', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Project', exact: true })).toBeVisible();
});

test('Feature Guide reveals the Character package tab without changing editor data', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Collapse editor controls', exact: true }).click();
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.getByRole('button', { name: 'Start Guide: Creating a New Character', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'Creating a New Character', exact: true });
  await guide.getByRole('button', { name: 'Next', exact: true }).click();
  await guide.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Character package', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.package-tools')).toBeVisible();
  await expect(guide.locator('.guide-spotlight-hole')).toBeVisible();
  await guide.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
});
