import { chromium } from '@playwright/test';

/** Reuse profile:timeline's local Vite lifecycle; never part of CI or release timing gates.
 * @param {string} baseUrl
 * @param {string | undefined} channel
 */
export async function profileSceneWorkflow(baseUrl, channel) {
  const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.text().startsWith('scene-profile:')) process.stderr.write(`${message.text()}\n`);
    });
    await page.goto(`${baseUrl}/scene-editor/`);
    // Authorize Web Audio through an actual browser interaction before the diagnostic loads media.
    await page.mouse.click(8, 8);
    const measurements = await page.evaluate(async () => {
      const path = '/tests/browser/sceneProfileHarness.tsx';
      const harness = /** @type {typeof import('../tests/browser/sceneProfileHarness.js')} */ (await import(path));
      return harness.profileScene();
    });
    if (errors.length) throw new Error(errors.join('\n'));
    return { measurements };
  } finally {
    await browser.close();
  }
}
