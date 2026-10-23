import { expect } from '@playwright/test';
import { test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

test('all desktop pages use the common header, version and navigation, with recovery below it', async ({ page }) => {
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  for (const [path, title] of [
    ['project/', 'Project Workspace'],
    ['animation-editor/', 'Animation Editor'],
    ['rig-editor/', 'Rig Editor'],
    ['scene-editor/', 'Scene Editor'],
    ['', 'Engine Demo'],
  ] as const) {
    await page.goto(path || './');
    const header = page.getByRole('banner');
    await expect(header).toHaveCount(1);
    await expect(header.getByRole('heading', { name: title, exact: title !== 'Rig Editor' })).toBeVisible();
    await expect(header.locator('.view-version')).toHaveText('v1.0.5');
    await expect(header.getByRole('link', { name: 'Project Workspace', exact: true })).toBeVisible();
    await expect(header.locator('[aria-current=page]')).toHaveCount(1);
    const bar = page.locator('.local-draft-bar:visible');
    if (await bar.count()) {
      expect((await bar.boundingBox())!.y).toBeGreaterThanOrEqual(
        (await header.boundingBox())!.y + (await header.boundingBox())!.height,
      );
    }
  }
});

test('recovery has no empty button/bar, updates after save/discard and uses the compact shared dialog', async ({
  page,
}, info) => {
  await page.goto('project/');
  await expect(page.getByRole('heading', { name: 'No project open', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recovery drafts', exact: true })).toHaveCount(0);
  await expect(page.locator('.local-draft-bar')).toBeHidden();
  await page.screenshot({ path: info.outputPath('empty-project.png') });
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name', { exact: true }).fill('Artist Film');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  const draftButton = await page.getByRole('button', { name: 'Recovery drafts', exact: true }).boundingBox();
  const retryButton = await page.locator('.local-draft-menu > summary').boundingBox();
  expect(
    Math.abs(draftButton!.y + draftButton!.height / 2 - retryButton!.y - retryButton!.height / 2),
  ).toBeLessThanOrEqual(1);
  expect((await page.locator('.local-draft-bar').boundingBox())!.height).toBeLessThanOrEqual(42);
  await expect(
    page.getByLabel('Local save status').getByRole('button', { name: 'Discard local draft', exact: true }),
  ).toBeHidden();
  await page.screenshot({ path: info.outputPath('saved-draft-bar.png') });
  await page.getByRole('button', { name: 'Recovery drafts', exact: true }).click();
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await expect(recovery).toBeVisible();
  expect((await recovery.boundingBox())!.width).toBe(480);
  await expect(recovery.getByRole('heading')).toHaveCSS('font-size', '16px');
  await expect(recovery.locator('time')).toHaveCount(1);
  const cancel = await recovery.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
  const restore = await recovery.getByRole('button', { name: 'Recover Draft', exact: true }).boundingBox();
  expect(restore!.x - cancel!.x - cancel!.width).toBeGreaterThanOrEqual(8);
  await page.screenshot({ path: info.outputPath('recovery-dialog.png') });
  await recovery.getByRole('button', { name: 'Close recovery', exact: true }).click();
  await page.locator('.local-draft-menu > summary').click();
  await page.getByLabel('Local save status').getByRole('button', { name: 'Discard local draft', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toContainText('Local draft discarded');
  await expect(page.getByRole('button', { name: 'Recovery drafts', exact: true })).toHaveCount(0);
});

test('project asset library is grouped and previewable, with spaced settings and semantic action colors', async ({
  page,
}, info) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name', { exact: true }).fill('Asset Library');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.getByRole('combobox', { name: 'Existing character', exact: true }).selectOption('random-paperdoll-sketch');
  await page.getByRole('button', { name: 'Add Existing Character', exact: true }).click();
  await expect(page.locator('.project-assets > li')).toHaveCount(1);
  await page.mouse.move(0, 0);
  for (const name of ['+ New Character', '+ New Scene', 'Add Existing Character'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCSS('background-color', 'rgb(35, 134, 54)');
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCSS('color', 'rgb(248, 81, 73)');
  const library = page.locator('.project-asset-library');
  await library.locator(':scope > summary').click();
  await expect(library.locator('.project-asset-group')).toHaveCount(4);
  await expect(library.locator('.project-asset-group[open]')).toHaveCount(0);
  for (const category of ['Images', 'Animations', 'Skins', 'Attachments'])
    await library
      .locator('.project-asset-group > summary')
      .filter({ hasText: new RegExp(`^${category}`) })
      .click();
  await expect(library.locator('.project-image-preview img').first()).toBeVisible();
  await expect
    .poll(() =>
      library
        .locator('.project-image-preview img')
        .first()
        .evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  const contained = await library.locator('.project-image-preview img').evaluateAll((images) =>
    images.every((image) => {
      const box = image.parentElement!.getBoundingClientRect();
      const bounds = image.getBoundingClientRect();
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.left >= box.left &&
        bounds.top >= box.top &&
        bounds.right <= box.right &&
        bounds.bottom <= box.bottom
      );
    }),
  );
  expect(contained, 'all tall and wide thumbnails stay inside their preview boxes').toBe(true);
  await expect(library.locator('.project-asset-list').first().getByText('idle', { exact: true })).toBeVisible();
  await page
    .getByRole('heading', { name: 'Assets', exact: true })
    .locator('..')
    .screenshot({ path: info.outputPath('asset-library.png') });
  await library
    .locator('.project-asset-group > summary')
    .filter({ hasText: /^Images/ })
    .click();
  await expect(library.locator('.project-image-preview img')).toHaveCount(0);
  const settings = page.locator('.project-settings');
  await settings.locator(':scope > summary').click();
  const summary = (await settings.locator(':scope > summary').boundingBox())!;
  const form = (await settings.locator('form').boundingBox())!;
  expect(form.y - summary.y - summary.height).toBeGreaterThanOrEqual(16);
  const input = (await settings.getByLabel('Project name', { exact: true }).boundingBox())!;
  const apply = (await settings.getByRole('button', { name: 'Apply name', exact: true }).boundingBox())!;
  expect(apply.x - input.x - input.width).toBeGreaterThanOrEqual(8);
  expect(Math.abs(input.y + input.height - apply.y - apply.height)).toBeLessThanOrEqual(1);
  await settings.screenshot({ path: info.outputPath('project-settings.png') });
});
