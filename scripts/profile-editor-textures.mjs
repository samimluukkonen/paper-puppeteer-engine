import { chromium } from '@playwright/test';

/** Local-only comparison of the original one-texture editor and the shared editor defaults.
 * @param {string} baseUrl
 * @param {string | undefined} channel
 */
export async function profileEditorTextures(baseUrl, channel) {
  const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
  try {
    const results = [];
    for (const singleTexture of [true, false]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.route('**/texture-profile-host', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Editor texture profile</title>' }),
      );
      await page.goto(`${baseUrl}/texture-profile-host`);
      results.push(
        await page.evaluate(async (singleTexture) => {
          const path = '/tests/browser/editorTextureProfileHarness.ts';
          const harness = /** @type {typeof import('../tests/browser/editorTextureProfileHarness.js')} */ (
            await import(path)
          );
          return harness.profileEditorTextures(singleTexture);
        }, singleTexture),
      );
      if (errors.length) throw new Error(errors.join('\n'));
      await page.close();
    }
    const [baseline, current] = results;
    if (!baseline || !current || current.maxTextures <= 1) throw new Error('Multi-texture batching was not enabled.');
    for (const [index, before] of baseline.measurements.entries()) {
      const after = current.measurements[index];
      if (!after || before.pixelHash !== after.pixelHash) throw new Error('Batching changed rendered pixels.');
      if (after.drawCalls >= before.drawCalls) throw new Error('Batching did not reduce draw calls.');
    }
    return { browser: browser.version(), results };
  } finally {
    await browser.close();
  }
}
