import { expect } from '@playwright/test';
import { rigFileAction, test } from './fixtures.js';

test('crossfade updates reuse controls and leave unchanged DOM untouched', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status-text')).toContainText('Current: idle');
  const work = await page.evaluate(async () => {
    const app = document.querySelector<HTMLElement>('#app')!;
    const status = app.querySelector<HTMLElement>('#status-text')!;
    const statusDot = app.querySelector<HTMLElement>('.status-dot')!;
    const fade = app.querySelector<HTMLButtonElement>('[data-action="fadeWalk"]')!;
    const pause = app.querySelector<HTMLButtonElement>('[data-action="pause"]')!;
    const slower = app.querySelector<HTMLButtonElement>('[data-action="slower"]')!;
    // Leave enough transition time to observe several frames on slower renderers.
    for (let count = 0; count < 3; count += 1) slower.click();
    const buttons = app.querySelectorAll('[data-action]');
    const queryDocument = document.querySelector.bind(document);
    const queryApp = app.querySelector.bind(app);
    let queries = 0;
    let controlWrites = 0;
    let statusWrites = 0;
    document.querySelector = <E extends Element>(selector: string): E | null => {
      queries += 1;
      return queryDocument<E>(selector);
    };
    app.querySelector = <E extends Element>(selector: string): E | null => {
      queries += 1;
      return queryApp<E>(selector);
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.target === status || status.contains(mutation.target)) statusWrites += 1;
        else controlWrites += 1;
      }
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    observer.observe(statusDot, { attributes: true, attributeFilter: ['class'] });
    for (const button of buttons) observer.observe(button, { attributes: true, attributeFilter: ['aria-pressed'] });
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      fade.click();
      // Freeze an active fade so every frame reports the same visible state.
      pause.click();
      await frame();
      await frame();
      const pausedStatus = status.textContent;
      queries = controlWrites = statusWrites = 0;
      for (let count = 0; count < 10; count += 1) await frame();
      const paused = { queries, controlWrites, statusWrites };
      pause.click();
      await frame();
      await frame();
      queries = controlWrites = statusWrites = 0;
      for (let count = 0; count < 5; count += 1) await frame();
      return { paused, pausedStatus, active: { queries, controlWrites, statusWrites } };
    } finally {
      document.querySelector = queryDocument;
      app.querySelector = queryApp;
      observer.disconnect();
    }
  });
  expect(work.pausedStatus).toContain('Paused: true');
  expect(work.pausedStatus).toMatch(/Transition: idle → walk \d+%/);
  expect(work.paused).toEqual({ queries: 0, controlWrites: 0, statusWrites: 0 });
  expect(work.active.queries).toBe(0);
  expect(work.active.controlWrites).toBe(0);
  expect(work.active.statusWrites).toBeGreaterThan(0);
  await expect(page.locator('#status-text')).toContainText('Transition: none');
  await expect(page.locator('[data-action="walk"]')).toHaveAttribute('aria-pressed', 'true');
});

test('demo loads artwork and responds to playback, facing, skin and IK controls', async ({ page }) => {
  await page.goto('./');
  const status = page.locator('#status-text');
  const canvas = page.locator('#stage canvas');
  await expect(status).toContainText('Current: idle');
  await expect(canvas).toBeVisible();
  await page.locator('[data-action="walk"]').click();
  await expect(status).toContainText('Current: walk');
  await page.locator('[data-action="stepped"]').click();
  await expect(status).toContainText('Playback: stepped 10 FPS');
  await page.locator('[data-action="pause"]').click();
  await expect(status).toContainText('Paused: true');
  const facingRight = await canvas.screenshot();
  await page.locator('[data-action="left"]').click();
  await expect(page.locator('[data-action="left"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await canvas.screenshot()).equals(facingRight)).toBe(false);
  await page.locator('[data-action="armoredSkin"]').click();
  await expect(page.locator('[data-action="armoredSkin"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="sword"]').click();
  await expect(status).toContainText('Current: sword');
  await expect(page.locator('[data-action="handIK"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="ikDebug"]').click();
  await expect(page.locator('[data-action="ikDebug"]')).toHaveAttribute('aria-pressed', 'true');
});

test('demo shortcuts respect form focus and native button activation', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#status-text')).toContainText('Current: idle');
  const left = page.locator('[data-action="left"]');
  await page.locator('#character-selection').focus();
  await page.keyboard.press('a');
  await expect(left).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-action="pause"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#status-text')).toContainText('Paused: true');
  await expect(page.locator('#status-text')).not.toContainText('(stopped)');
  await page.locator('[data-action="pause"]').press('Space');
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Alt+a');
  await expect(left).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('a');
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(page.locator('#status-text')).toContainText('(stopped)');
});

test('demo and editor navigation preserves the deployment path and loads fresh scenes', async ({ page, baseURL }) => {
  await page.goto('./');
  await expect(page.locator('#status-text')).toContainText('Current: idle');
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(page).toHaveURL(new URL('rig-editor/', baseURL).href);
  await page.getByRole('treeitem', { name: 'head', exact: true }).click();
  const x = page.locator('#inspector input[data-field="x"]');
  await x.fill('12');
  await rigFileAction(page, '#log-json', (control) => control.click());
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('link', { name: 'Engine demo' }).click();
  await expect(page).toHaveURL(baseURL!);
  await expect(page.locator('#status-text')).toContainText('Current: idle');
  await expect(page.locator('#stage canvas')).toBeVisible();
  await page.reload();
  await expect(page.locator('#status-text')).toContainText('Current: idle');
});
