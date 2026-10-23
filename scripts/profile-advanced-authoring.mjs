import { chromium } from '@playwright/test';
import { z } from 'zod';

/** Local browser diagnostic; includes layout and scheduling, with no timing thresholds.
 * @param {string} baseUrl
 * @param {{ bones: { id: string, x?: number, y?: number }[] }} rig
 * @param {string | undefined} channel
 */
export async function profileAdvancedAuthoring(baseUrl, rig, channel) {
  const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
  const samples = [];
  try {
    for (let run = 0; run < 3; run++) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
      page.setDefaultTimeout(15000);
      /** @type {string[]} */
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // Leave room for the shipped rig, skins, clips and artwork inside the loader's resource budget.
      const posePaths = Array.from({ length: 200 }, (_, i) => `poses/profile-${i}.json`);
      await page.route('**/demo-puppet/character.json', async (route) => {
        const response = await route.fetch();
        const manifest = z.record(z.string(), z.unknown()).parse(await response.json());
        await route.fulfill({ json: { ...manifest, poses: posePaths } });
      });
      await page.route('**/poses/profile-*.json', (route) =>
        route.fulfill({
          json: {
            version: 1,
            name: route.request().url().split('/').at(-1),
            bones: Object.fromEntries(rig.bones.map(({ id }) => [id, { x: 0 }])),
          },
        }),
      );
      await page.route('**/animations/idle.json', (route) =>
        route.fulfill({
          json: {
            version: 1,
            name: 'idle',
            duration: 12700,
            loop: true,
            playback: { mode: 'smooth' },
            tracks: Object.fromEntries(
              rig.bones.map((bone) => [
                bone.id,
                Array.from({ length: 128 }, (_, i) => ({
                  time: i * 100,
                  x: (bone.x ?? 0) + i / 10,
                  y: bone.y ?? 0,
                })),
              ]),
            ),
          },
        }),
      );
      await page.goto(`${baseUrl}/animation-editor/`);
      try {
        await page.locator('#animation-status').filter({ hasText: 'Validation: OK' }).waitFor();
      } catch (error) {
        throw new Error(`Profile character did not load: ${await page.locator('#animation-status').textContent()}`, {
          cause: error,
        });
      }
      await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
      // Dense timeline markers overlap at this zoom; use the actual button's keyboard activation.
      await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).press('Enter');
      await page.locator('#graph-toggle').click();
      await page.locator('#graph-interpolation').selectOption('bezier');
      const graph = await page.evaluate(() => {
        const canvas = document.querySelector('#graph-canvas');
        const bounds = canvas.getBoundingClientRect();
        const start = performance.now();
        for (let i = 0; i < 20; i++) {
          canvas.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              deltaY: i % 2 ? -100 : 100,
              clientX: bounds.x + bounds.width / 2,
              clientY: bounds.y + bounds.height / 2,
            }),
          );
          canvas.getBoundingClientRect();
        }
        return { wheelZoomMs: (performance.now() - start) / 20 };
      });
      const bounds = await page.locator('#graph-canvas').boundingBox();
      if (!bounds) throw new Error('Missing graph');
      /** @param {() => Promise<unknown>} action */
      const timed = async (action) => {
        const start = await page.evaluate(() => performance.now());
        await action();
        return await page.evaluate((start) => {
          /** @type {Promise<number>} */
          const frame = new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now() - start)));
          return frame;
        }, start);
      };
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down({ button: 'middle' });
      const panMs = await timed(() => page.mouse.move(bounds.x + bounds.width / 2 + 20, bounds.y + bounds.height / 2));
      await page.mouse.up({ button: 'middle' });
      await page.locator('#graph-fit').click();
      const handle = await page.locator('.graph-handle').first().boundingBox();
      if (!handle) throw new Error('Missing tangent');
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      const curveDragMs = await timed(() =>
        page.mouse.move(handle.x + handle.width / 2 + 1, handle.y + handle.height / 2 - 1),
      );
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await page.locator('#animation-authoring-tools > summary').click();
      await page.getByRole('button', { name: 'Pose Library…', exact: true }).click();
      const search = page.getByLabel('Search poses', { exact: true });
      const browseMs = await timed(() => search.fill('profile-12'));
      const matchingPoses = await page.locator('.animation-pose-list li').count();
      await page
        .getByRole('region', { name: 'Pose Library', exact: true })
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      const switchMs = await timed(async () => {
        await page.locator('#animation-selection').selectOption('walk');
        await page.locator('#animation-selection').selectOption('idle');
      });
      await page.locator('#animation-authoring-tools > summary').click();
      await page.getByRole('button', { name: 'Motion Diagnostics…', exact: true }).click();
      const diagnosticsMs = await timed(() =>
        page.getByRole('button', { name: 'Run diagnostics', exact: true }).click(),
      );
      await page.getByRole('button', { name: 'Close Motion Diagnostics', exact: true }).click();
      const renderedKeys = await page.locator('.graph-key').count();
      if (renderedKeys !== 128)
        throw new Error(`Playback profile requires a populated graph; found ${renderedKeys} keys.`);
      const playback = await page.evaluate(async () => {
        const drawing = document.querySelector('#graph-drawing');
        let mutations = 0;
        const observer = new MutationObserver((entries) => {
          mutations += entries.length;
        });
        observer.observe(drawing, { subtree: true, childList: true, attributes: true, characterData: true });
        const play = /** @type {HTMLButtonElement} */ (document.querySelector('#play-pause'));
        play.click();
        const intervals = [];
        let previous = performance.now();
        for (let i = 0; i < 60; i++) {
          /** @type {Promise<number>} */
          const frame = new Promise((resolve) => requestAnimationFrame(resolve));
          const now = await frame;
          intervals.push(now - previous);
          previous = now;
        }
        play.click();
        observer.disconnect();
        intervals.sort((a, b) => a - b);
        return { frameIntervalMedianMs: intervals[30], graphDrawingMutations: mutations };
      });
      if (errors.length) throw new Error(errors.join('\n'));
      samples.push({
        ...graph,
        panMs,
        curveDragMs,
        browseMs,
        matchingPoses,
        twoSwitchesMs: switchMs,
        diagnosticsMs,
        ...playback,
      });
      await page.close();
    }
    return {
      bones: rig.bones.length,
      keysPerTrack: 128,
      propertyKeys: rig.bones.length * 128 * 2,
      poses: 200,
      samples,
    };
  } finally {
    await browser.close();
  }
}
