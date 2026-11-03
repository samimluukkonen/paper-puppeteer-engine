import { expect } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { test } from './fixtures.js';

for (const id of ['project-story-sequence', 'project-story-export']) {
  test(`${id} reveals real controls before scenes exist and preserves project history`, async ({ page }) => {
    const guide = guideRegistry.getGuideById(id)!;
    await page.goto('project/');
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'New Project', exact: true });
    await create.getByLabel('Project name').fill('Story guide');
    await create.getByRole('button', { name: 'Create Project', exact: true }).click();
    const undo = page.getByRole('button', { name: 'Undo Project', exact: true });
    const redo = page.getByRole('button', { name: 'Redo Project', exact: true });
    const history = [await undo.isEnabled(), await redo.isEnabled()];
    await page.getByRole('tab', { name: 'Local draft', exact: true }).click();
    await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
    const catalog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
    await catalog.getByRole('button', { name: 'Project Workspace', exact: true }).click();
    await catalog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
    const tour = page.getByRole('dialog', { name: guide.title, exact: true });
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
      const target = page.locator(`[data-guide-id="${step.targetId}"]`);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
      await expect(tour).not.toContainText('Target unavailable');
      if (index + 1 < guide.steps.length) await tour.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await tour.getByRole('button', { name: 'Exit', exact: true }).click();
    expect([await undo.isEnabled(), await redo.isEnabled()]).toEqual(history);
    await expect(page.getByLabel('Select story')).toContainText('No stories yet');
    await expect(page.locator('.story-preview-canvas canvas')).toHaveCount(0);
  });
}
