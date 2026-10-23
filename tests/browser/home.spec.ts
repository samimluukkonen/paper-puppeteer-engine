import { expect } from '@playwright/test';
import { test } from './fixtures.js';

test('home opens Project Workspace under the deployment base without a demo entry', async ({ page, baseURL }) => {
  await page.goto('./');
  await expect(page).toHaveURL(new URL('project/', baseURL).href);
  await expect(page.getByRole('heading', { name: 'Project Workspace', exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Views', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(4);
  await expect(navigation.getByRole('link', { name: /Engine Demo/i })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: 'Project Workspace', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

for (const route of ['project/', 'rig-editor/', 'animation-editor/', 'scene-editor/']) {
  test(`logo opens Project Workspace from ${route}`, async ({ page, baseURL }) => {
    await page.goto(`${route}?character=random-paperdoll-sketch`);
    await page.getByRole('link', { name: 'Paper Puppeteer Engine', exact: true }).click();
    await expect(page).toHaveURL(new URL('project/', baseURL).href);
    await expect(page.getByRole('heading', { name: 'Project Workspace', exact: true })).toBeVisible();
  });
}
