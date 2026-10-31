import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { timelineControl, test } from './fixtures.js';

const lane = (page: Page, bone = 'root', property = 'x') =>
  page.locator(`#timeline-tracks .timeline-track-lane[data-bone-id="${bone}"][data-property="${property}"]`);
const key = (page: Page, time: number, bone = 'root', property = 'x') =>
  lane(page, bone, property).locator(`.timeline-keyframe[data-time="${time}"]`);
const selected = (page: Page) => page.locator('.timeline-keyframe[aria-pressed="true"]');
const time = async (page: Page) => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow'));
async function openEditor(page: Page) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1500,
        playback: { mode: 'smooth' },
        events: [],
        tracks: {
          root: [
            { time: 200, x: 10, y: 3 },
            { time: 500, x: 20 },
            { time: 900, x: 99, y: 8 },
          ],
          torso: [
            { time: 350, rotation: 0.3 },
            { time: 600, rotation: 0.6 },
            { time: 750, rotation: 99, y: 12 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  for (const bone of ['root', 'torso'])
    await page.getByRole('button', { name: `Expand ${bone} properties`, exact: true }).click();
  // Keep every group member in the viewport; unmounted rows are covered by the virtualization scenarios.
  await (await timelineControl(page, '#timeline-filter')).selectOption('keyed');
  await page.locator('#timeline-tracks-tools-tab').click();
  await page.addStyleTag({ content: '.timeline-inset { max-height: 650px; }' });
}
async function marquee(page: Page, start = 0.15, end = 0.65) {
  await lane(page).scrollIntoViewIfNeeded();
  const first = await lane(page).boundingBox();
  const last = await lane(page, 'torso', 'rotation').boundingBox();
  if (!first || !last) throw new Error('Missing group lanes');
  // Start in the empty bone lane above x, clear of the marker button hit areas.
  await page.mouse.move(first.x + (first.width * start) / 1.5, first.y - 5);
  await page.mouse.down();
  await page.mouse.move(first.x + (first.width * end) / 1.5, last.y + last.height - 3, { steps: 8 });
  await page.mouse.up();
}
async function beginDrag(page: Page, from: number, bone = 'root', property = 'x') {
  const marker = key(page, from, bone, property);
  await marker.scrollIntoViewIfNeeded();
  const bounds = await marker.boundingBox();
  if (!bounds) throw new Error('Missing anchor');
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + bounds.width / 2, y);
  await page.mouse.down();
  return y;
}
async function movePointer(page: Page, target: number, y: number) {
  const bounds = await page.locator('#timeline').boundingBox();
  if (!bounds) throw new Error('Missing timeline');
  await page.mouse.move(bounds.x + (bounds.width * target) / 1.5, y, { steps: 6 });
}

test('marquee group previews all markers, follows clicked primary, replaces collisions and commits one reversible move', async ({
  page,
}) => {
  await openEditor(page);
  await marquee(page);
  await expect(selected(page)).toHaveCount(5);
  // Pointer/marker centers use fractional CSS pixels; snap to exercise exact collisions.
  await (await timelineControl(page, '#timeline-snap-enabled')).check();
  for (const mode of ['keyframes', 'events', 'playhead'])
    await (await timelineControl(page, `#timeline-snap-${mode}`)).uncheck();
  const y = await beginDrag(page, 0.5);
  await movePointer(page, 0.9, y);
  await expect.poll(() => time(page)).toBeCloseTo(0.9, 2);
  await expect(page.locator('.timeline-keyframe[data-dragging="true"]')).toHaveCount(5);
  await expect(key(page, 0.5)).toHaveAttribute('data-primary', 'true');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  // Every preview marker receives the same pixel displacement, including off-frame keys.
  const deltas = await selected(page).evaluateAll((elements) =>
    elements.map((element) => {
      const marker = element as HTMLElement;
      const timeline = document.querySelector('#timeline')!;
      return (
        (parseFloat(marker.style.left) / timeline.getBoundingClientRect().width) * 1.5 - Number(marker.dataset.time)
      );
    }),
  );
  for (const delta of deltas) expect(delta).toBeCloseTo(0.4, 2);
  await page.mouse.up();
  await expect(selected(page)).toHaveCount(5);
  await expect(lane(page).locator('[data-primary="true"]')).toHaveAttribute('data-time', /^0\.9/);
  await expect(lane(page).locator('[data-primary="true"]')).toHaveAttribute('title', /value 20/);
  await expect(lane(page, 'root', 'y').locator('[data-time="0.9"]')).toHaveAttribute('title', /value 8/);
  await expect(lane(page, 'torso', 'rotation').locator('.timeline-keyframe')).toHaveCount(2);
  await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveValue('20');
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('group-move.png') });
  await page.locator('#animation-undo').click();
  await expect(key(page, 0.2)).toHaveCount(1);
  await expect(key(page, 0.5)).toHaveCount(1);
  await expect(key(page, 0.9)).toHaveAttribute('title', /value 99/);
  await expect(key(page, 0.75, 'torso', 'rotation')).toHaveAttribute('title', /value 99/);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#animation-redo').click();
  await expect(key(page, 0.5)).toHaveCount(0);
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#play-pause').click();
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  await page.waitForTimeout(100);
  await expect.poll(() => time(page)).toBeGreaterThan(0.9);
  await page.locator('#play-pause').click();
});

test('group boundaries, frame snapping and Escape retain spacing, original primary and clean history', async ({
  page,
}) => {
  await openEditor(page);
  await marquee(page);
  await (await timelineControl(page, '#timeline-snap-enabled')).check();
  for (const mode of ['keyframes', 'events', 'playhead'])
    await (await timelineControl(page, `#timeline-snap-${mode}`)).uncheck();
  let y = await beginDrag(page, 0.35, 'torso', 'rotation');
  await movePointer(page, 0.697, y);
  await expect.poll(() => time(page)).toBe(0.7);
  await expect(page.locator('.timeline-keyframe[data-dragging="true"]')).toHaveCount(5);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(selected(page)).toHaveCount(5);
  await expect(key(page, 0.2)).toHaveAttribute('data-primary', 'true');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  y = await beginDrag(page, 0.5);
  await movePointer(page, -1, y);
  await expect.poll(() => time(page)).toBeCloseTo(0.3, 3);
  await page.mouse.up();
  await expect(key(page, 0)).toHaveAttribute('aria-pressed', 'true');
  await expect(selected(page)).toHaveCount(5);
  await page.locator('#animation-undo').click();
  await marquee(page);
  y = await beginDrag(page, 0.5);
  await movePointer(page, 2, y);
  await expect.poll(() => time(page)).toBeCloseTo(1.4, 3);
  await page.mouse.up();
  await expect(key(page, 1.5, 'torso', 'rotation')).toHaveAttribute('aria-pressed', 'true');
  await expect(selected(page)).toHaveCount(5);
});

test('moved group nudge, copy, paste, duplicate, delete and new-position marquee remain coherent', async ({ page }) => {
  await openEditor(page);
  await marquee(page);
  const timeline = page.locator('#timeline');
  await timeline.press('ArrowRight');
  await expect(key(page, 0.21)).toHaveAttribute('data-primary', 'true');
  await expect(selected(page)).toHaveCount(5);
  await timeline.press('Escape');
  await marquee(page, 0.205, 0.22);
  await expect(selected(page)).toHaveCount(2); // Moved root x/y markers, using their new coordinates.
  await timeline.press('Control+Z');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await marquee(page);
  await timeline.press('ArrowRight');
  await timeline.press('Control+C');
  await timeline.press('Escape');
  await timeline.press('End');
  await timeline.press('Control+V');
  await expect(selected(page)).toHaveCount(5);
  await expect(key(page, 1.5)).toHaveAttribute('data-primary', 'true');
  await expect(key(page, 1.8)).toHaveAttribute('aria-pressed', 'true');
  await timeline.press('Control+D');
  await expect(selected(page)).toHaveCount(5);
  await expect(key(page, 1.51)).toHaveAttribute('data-primary', 'true');
  await timeline.press('Delete');
  await expect(selected(page)).toHaveCount(0);
  await expect(key(page, 1.51)).toHaveCount(0);
  await timeline.press('Control+Z');
  await expect(key(page, 1.51)).toHaveCount(1);
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
});

test('group drag follows resize/scroll, pointer cancellation and native keyboard editing', async ({ page }) => {
  await openEditor(page);
  await marquee(page);
  await page.setViewportSize({ width: 800, height: 1900 });
  await page.addStyleTag({ content: '.timeline-inset { overflow-x: auto; grid-template-columns: 160px 520px; }' });
  await page.locator('.timeline-inset').evaluate((element) => {
    element.scrollLeft = 70;
  });
  // Let responsive layout and the timeline's ResizeObserver finish before picking a marker.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const y = await beginDrag(page, 0.5);
  await movePointer(page, 0.7, y);
  await page.setViewportSize({ width: 1100, height: 1900 });
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await movePointer(page, 0.8, y);
  await expect.poll(() => time(page)).toBeCloseTo(0.8, 2);
  await expect(page.locator('.timeline-keyframe[data-dragging="true"]')).toHaveCount(5);
  await timelineCancel(page);
  await expect(selected(page)).toHaveCount(5);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  const native = await page.locator('.timeline-panel').evaluate((panel) => {
    const controls = document.createElement('div');
    controls.innerHTML =
      '<input type="text"><input type="number"><textarea></textarea><select><option>one</option></select><div contenteditable="true"><span>text</span></div>';
    panel.append(controls);
    const results = [];
    for (const target of controls.querySelectorAll('input,textarea,select,span')) {
      for (const key of ['ArrowRight', 'Delete', 'Backspace', 'Escape', 'Home', ' ', 'c', 'v', 'd', 'z']) {
        const event = new KeyboardEvent('keydown', {
          key,
          code: key === ' ' ? 'Space' : '',
          ctrlKey: ['c', 'v', 'd', 'z'].includes(key),
          bubbles: true,
          cancelable: true,
        });
        results.push(target.dispatchEvent(event));
      }
    }
    controls.remove();
    return results;
  });
  expect(native.every(Boolean)).toBe(true);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(selected(page)).toHaveCount(5);
});
async function timelineCancel(page: Page) {
  await page.locator('#timeline').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
}
