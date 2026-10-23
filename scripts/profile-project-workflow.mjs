import { chromium } from '@playwright/test';

/** Local-only observations; no speed thresholds or browser installation in CI.
 * @param {string} baseUrl
 * @param {string | undefined} channel
 */
export async function profileProjectWorkflow(baseUrl, channel) {
  const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const opening = performance.now();
    await page.goto(`${baseUrl}/project/`);
    await page.getByRole('button', { name: 'New Project', exact: true }).waitFor();
    const workspaceShellMs = performance.now() - opening;
    const result = await page.evaluate(async () => {
      const path = '/tests/browser/projectProfileHarness.ts';
      const harness = /** @type {typeof import('../tests/browser/projectProfileHarness.js')} */ (await import(path));
      return harness.profileProject();
    });
    if (errors.length) throw new Error(errors.join('\n'));
    return { workspaceShellMs, ...result };
  } finally {
    await browser.close();
  }
}
