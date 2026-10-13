import { chromium } from '@playwright/test';
import { z } from 'zod';

/** Local-only dense workload. Browser timings include synchronous handlers/layout or observed rAF intervals.
 * @param {string} baseUrl
 * @param {unknown} sourceRig
 * @param {string | undefined} channel
 */
export async function profileEditorWorkflow(baseUrl, sourceRig, channel) {
  const source = z
    .object({
      root: z.string(),
      bones: z.array(
        z
          .object({
            id: z.string(),
            x: z.number().optional(),
            y: z.number().optional(),
            rotation: z.number().optional(),
          })
          .passthrough(),
      ),
      ik: z.array(z.object({ name: z.string() }).passthrough()),
    })
    .passthrough()
    .parse(sourceRig);
  const rig = {
    ...source,
    bones: [
      ...source.bones,
      ...Array.from({ length: 16 }, (_, i) => ({ id: `extra${i}`, parent: source.root, x: i, y: 0, rotation: 0 })),
    ],
  };
  const keysPerTrack = 128;
  const duration = 12700;
  const animation = {
    version: 1,
    name: 'idle',
    loop: false,
    duration,
    playback: { mode: 'smooth' },
    tracks: Object.fromEntries(
      rig.bones.map((bone) => [
        bone.id,
        Array.from({ length: keysPerTrack }, (_, i) => ({
          time: i * 100,
          x: (bone.x ?? 0) + Math.sin(i / 10),
          y: bone.y ?? 0,
          rotation: (bone.rotation ?? 0) + Math.sin(i / 10) / 10,
        })),
      ]),
    ),
    ikTracks: Object.fromEntries(
      rig.ik.map((entry) => [
        entry.name,
        Array.from({ length: keysPerTrack }, (_, i) => ({
          time: i * 100,
          x: 30 + Math.sin(i / 10) * 5,
          y: 70,
          mix: 0.5,
        })),
      ]),
    ),
    events: Array.from({ length: 128 }, (_, i) => ({ time: i * 100, name: `cue${i}`, data: { i } })),
  };
  const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
  const samples = [];
  try {
    for (let run = 0; run < 3; ++run) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      /** @type {string[]} */
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/demo-puppet/rig.json', (route) => route.fulfill({ json: rig }));
      await page.route('**/animations/idle.json', (route) => route.fulfill({ json: animation }));
      await page.goto(`${baseUrl}/animation-editor/`);
      await page.locator('#animation-status').filter({ hasText: 'Validation: OK' }).waitFor();
      await page.locator('.timeline-summary').first().waitFor();
      const interactions = await page.evaluate(() => {
        const host = document.querySelector('#timeline');
        /** @param {string} label */
        const button = (label) => /** @type {HTMLButtonElement} */ (document.querySelector(`[aria-label="${label}"]`));
        /** @param {() => void} action */
        const measure = (action) => {
          const start = performance.now();
          action();
          host.getBoundingClientRect();
          return performance.now() - start;
        };
        const expandMs = measure(() => button('Expand root properties').click());
        const lane = document.querySelector('.timeline-track-lane[data-bone-id="root"][data-property="x"]');
        const markers = /** @type {NodeListOf<HTMLButtonElement>} */ (
          lane.querySelectorAll('button.timeline-keyframe')
        );
        const selectionMs = measure(() => {
          markers[0].click();
          for (let i = 1; i < 64; ++i)
            markers[i].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
        });
        const search = /** @type {HTMLInputElement} */ (document.querySelector('#timeline-search'));
        const filterMs = measure(() => {
          search.value = 'rotation';
          search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        measure(() => {
          search.value = '';
          search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const zoomMs = measure(() =>
          /** @type {HTMLButtonElement} */ (document.querySelector('#timeline-zoom-in')).click(),
        );
        /** @type {HTMLButtonElement} */ (document.querySelector('#timeline-fit-animation')).click();
        const ruler = document.querySelector('#timeline-ruler');
        const scrubMs = Array.from({ length: 30 }, () =>
          measure(() => {
            ruler.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
          }),
        );
        return {
          expandMs,
          selectionMs,
          filterMs,
          zoomMs,
          scrubMs,
          selected: document.querySelectorAll('.timeline-keyframe[aria-pressed="true"]').length,
          markers: document.querySelectorAll('.timeline-keyframe').length,
        };
      });
      const marker = page
        .locator('.timeline-track-lane[data-bone-id="root"][data-property="x"] .timeline-keyframe')
        .first();
      await marker.scrollIntoViewIfNeeded();
      const bounds = await marker.boundingBox();
      if (!bounds) throw new Error('Missing key marker.');
      // Real pointer input exercises capture, group preview and cancellation; samples include the initial hover.
      await page.evaluate(() => {
        const browserWindow = /** @type {Window & { editorDragSamples: number[] }} */ (window);
        browserWindow.editorDragSamples = [];
        document.addEventListener(
          'pointermove',
          () => {
            const start = performance.now();
            requestAnimationFrame(() => browserWindow.editorDragSamples.push(performance.now() - start));
          },
          { capture: true },
        );
      });
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 80, bounds.y + bounds.height / 2, { steps: 10 });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      const dragToFrameMs = await page.evaluate(
        () => /** @type {Window & { editorDragSamples: number[] }} */ (window).editorDragSamples,
      );
      const playback = await page.evaluate(async () => {
        const tracks = document.querySelector('#timeline-tracks');
        const measure = async () => {
          let trackMutations = 0;
          const observer = new MutationObserver((records) => {
            trackMutations += records.length;
          });
          observer.observe(tracks, { subtree: true, attributes: true, childList: true });
          const intervals = [];
          let previous = performance.now();
          /** @type {HTMLButtonElement} */ (document.querySelector('#play-pause')).click();
          for (let i = 0; i < 30; ++i) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const now = performance.now();
            intervals.push(now - previous);
            previous = now;
          }
          /** @type {HTMLButtonElement} */ (document.querySelector('#play-pause')).click();
          observer.disconnect();
          return { intervals, trackMutations };
        };
        const normal = await measure();
        /** @type {HTMLInputElement} */ (document.querySelector('#animation-onion-skinning')).click();
        const onion = await measure();
        return { normal, onion };
      });
      samples.push({ ...interactions, dragToFrameMs, playback });
      if (errors.length) throw new Error(errors.join('\n'));
      await page.close();
    }
    return {
      bones: rig.bones.length,
      propertiesPerBone: 3,
      keysPerTrack,
      bonePropertyKeys: rig.bones.length * keysPerTrack * 3,
      ikTracks: rig.ik.length,
      ikPropertyKeys: rig.ik.length * keysPerTrack * 3,
      events: animation.events.length,
      samples,
    };
  } finally {
    await browser.close();
  }
}
