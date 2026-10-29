import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { animationFileAction, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

async function readProject(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  return decodePackageZip(new Uint8Array(await readFile(await (await pending).path())));
}

for (const editor of ['project', 'animation'] as const) {
  test(`${editor} Animation Library tour reveals controls without changing assets or starting preview`, async ({
    page,
  }) => {
    const guide = guideRegistry.getGuideById(editor === 'project' ? 'project-animation-library' : 'animation-library')!;
    await page.goto(`${editor === 'project' ? 'project' : 'animation-editor'}/`);
    const openCatalog = async () => {
      await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
      const catalog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
      if (editor === 'project') await catalog.getByRole('button', { name: 'Project Workspace', exact: true }).click();
      await catalog.getByRole('searchbox', { name: 'Search guides', exact: true }).fill(guide.title);
      return catalog;
    };
    if (editor === 'project') {
      const catalog = await openCatalog();
      await expect(catalog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true })).toBeDisabled();
      await catalog.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'New Project', exact: true }).click();
      const create = page.getByRole('dialog', { name: 'New Project', exact: true });
      await create.getByLabel('Project name').fill('Animation Library guide');
      await create.getByRole('button', { name: 'Create Project', exact: true }).click();
    } else await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    const readAnimation = async () => {
      const pending = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
      await animationFileAction(page, '#animation-log-json', (button) => button.click());
      return (await pending).text();
    };
    const before = editor === 'project' ? await readProject(page) : await readAnimation();
    const history = async () =>
      editor === 'project'
        ? [
            await page.getByRole('button', { name: 'Undo Project', exact: true }).isEnabled(),
            await page.getByRole('button', { name: 'Redo Project', exact: true }).isEnabled(),
          ]
        : [
            await page.locator('#animation-undo').isEnabled(),
            await page.locator('#animation-redo').isEnabled(),
            await page.locator('#animation-selection').inputValue(),
            await page.locator('#current-time').textContent(),
          ];
    const historyBefore = await history();
    const catalog = await openCatalog();
    await expect(catalog.locator('.feature-guide-entry h4')).toHaveText([guide.title]);
    await catalog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
    const tour = page.getByRole('dialog', { name: guide.title, exact: true });
    let downloads = 0;
    const onDownload = () => downloads++;
    page.on('download', onDownload);
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
      const target = page.locator(`[data-guide-id="${step.targetId}"]`);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
      await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
      await expect(tour).not.toContainText('Target unavailable');
      await expect(tour.getByRole('button', { name: 'Try It', exact: true })).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: 'Animation Library', exact: true })).not.toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Animation runtime preview', exact: true })).not.toBeVisible();
      if (index === 1) {
        await tour.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(tour).toContainText(`Step 1 of ${guide.steps.length}`);
        await tour.getByRole('button', { name: 'Next', exact: true }).click();
      }
      await tour
        .getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true })
        .click();
    }
    page.off('download', onDownload);
    expect(downloads).toBe(0);
    expect(await history()).toEqual(historyBefore);
    await expect(page.locator('iframe.project-editor-host')).toHaveCount(0);
    if (editor === 'project') {
      const after = await readProject(page);
      expect([...after.entries()]).toEqual([...(before as Awaited<ReturnType<typeof readProject>>).entries()]);
    } else {
      expect(await readAnimation()).toBe(before);
      await expect(page.locator('#play-pause')).toHaveAttribute('aria-label', 'Play');
    }
  });
}
