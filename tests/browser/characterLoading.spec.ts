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

test('oversized PNG dimensions fail before decoding and a reload can load normal artwork', async ({ page }) => {
  const artwork = '**/characters/demo-puppet/images/paper-torso.png';
  const header = Buffer.alloc(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  header.writeUInt32BE(9000, 16);
  header.writeUInt32BE(9000, 20);
  await page.route(artwork, (route) => route.fulfill({ body: header, contentType: 'image/png' }));
  await page.goto('rig-editor/');
  await expect(page.locator('#inspector')).toContainText('8192-pixel dimension limit');
  await expect(page.locator('#editor-stage canvas')).toBeVisible();
  await page.unroute(artwork);
  await page.reload();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
});

test('oversized image responses fail at the byte limit and retain a usable page', async ({ page }) => {
  const artwork = '**/characters/demo-puppet/images/paper-torso.png';
  await page.route(artwork, (route) =>
    route.fulfill({ body: Buffer.alloc(10 * 1024 * 1024 + 1), contentType: 'image/png' }),
  );
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toContainText('10485760-byte limit');
  await expect(page.locator('#animation-stage canvas')).toBeVisible();
  await page.unroute(artwork);
  await page.reload();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
});
