import { expect } from '@playwright/test';
import { test } from './fixtures.js';

for (const [path, title] of [
  ['./', 'Project Workspace'],
  ['project/', 'Project Workspace'],
  ['rig-editor/', 'Rig Editor'],
  ['animation-editor/', 'Animation Editor'],
  ['scene-editor/', 'Scene Editor'],
] as const) {
  test(`${path} paints a dark loading screen before scripts arrive`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release!: () => void;
    const scripts = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() === 'script') await scripts;
      await route.continue();
    });
    try {
      await page.goto(path, { waitUntil: 'commit' });
      const loading = page.getByRole('status');
      await expect(loading).toHaveText('Paper Puppeteer EngineLoading workspace…');
      await expect(loading).toBeVisible();
      await expect(loading).toHaveCSS('background-color', 'rgb(13, 17, 23)');
      await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
      await expect(page.locator('.view-loading-spinner')).toHaveCSS('animation-name', 'none');
      expect(await loading.boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
      if (path === 'scene-editor/') await page.screenshot({ path: info.outputPath('view-loading.png') });
    } finally {
      release();
    }
    await expect(page.locator('#view-loading')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: title, exact: title !== 'Rig Editor' })).toBeVisible();
  });
}

test('view navigation shows loading until the destination mounts', async ({ page }) => {
  await page.goto('project/');
  await expect(page.getByRole('heading', { name: 'Project Workspace', exact: true })).toBeVisible();
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script') await scripts;
    await route.continue();
  });
  try {
    await page.getByRole('link', { name: 'Scene Editor', exact: true }).click({ noWaitAfter: true });
    await expect(page.locator('#view-loading')).toBeVisible();
    await expect(page.locator('.view-loading-spinner')).toHaveCSS('animation-name', 'view-loading-spin');
  } finally {
    release();
  }
  await expect(page.locator('#view-loading')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Scene Editor', exact: true })).toBeVisible();
});

test('embedded project editors show the same loading screen', async ({ page }) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'New Project', exact: true });
  await project.getByLabel('Project name', { exact: true }).fill('Loading views');
  await project.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const scene = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await scene.getByLabel('Scene name', { exact: true }).fill('Opening scene');
  await scene.getByRole('button', { name: 'Create Scene', exact: true }).click();
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script') await scripts;
    await route.continue();
  });
  const editor = page.frameLocator('iframe:visible');
  try {
    await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
    await expect(page.locator('iframe:visible')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
    await expect(editor.locator('#view-loading')).toBeVisible();
  } finally {
    release();
  }
  await expect(editor.locator('#view-loading')).toHaveCount(0);
  await expect(editor.getByRole('heading', { name: 'Scene Editor', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: '← Project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project Workspace', exact: true })).toBeVisible();
});
