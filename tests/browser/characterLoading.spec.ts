import { expect } from '@playwright/test';
import { test } from './fixtures.js';

test('stalled character artwork times out cleanly and a reload can load the character', async ({ page }) => {
  await page.clock.install();
  const artwork = '**/characters/demo-puppet/images/*.png';
  // Leave image requests pending until the session deadline cancels them.
  await page.route(artwork, () => {});
  const requested = page.waitForRequest(/\/characters\/demo-puppet\/images\/.*\.png/);
  await page.goto('rig-editor/');
  await requested;
  await page.clock.fastForward(30_001);
  await expect(page.locator('#inspector')).toContainText('Character artwork loading timed out');
  await expect(page.locator('#editor-stage canvas')).toBeVisible();
  await page.unroute(artwork);
  await page.reload();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await expect(page.locator('#session-status')).toContainText('Character: demo-puppet');
});
