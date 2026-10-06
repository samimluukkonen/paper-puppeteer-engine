import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

async function openEditor(page: Page) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        playback: { mode: 'smooth' },
        events: [],
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 500, x: 40, y: 3 },
            { time: 1000, x: 20, y: 8 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
}
const lane = (page: Page, property = 'x') =>
  page.locator(`#timeline-tracks .timeline-track-lane[data-bone-id="root"][data-property="${property}"]`);
const key = (page: Page, time: number) => lane(page).locator(`.timeline-keyframe[data-time="${time}"]`);
const time = async (page: Page) => Number(await page.locator('#timeline').getAttribute('aria-valuenow'));
async function beginDrag(page: Page, from: number) {
  await key(page, from).scrollIntoViewIfNeeded();
  const marker = await key(page, from).boundingBox();
  if (!marker) throw new Error('Missing marker');
  await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await page.mouse.down();
  return marker.y + marker.height / 2;
}
async function movePointer(page: Page, to: number, y: number) {
  const bounds = await page.locator('#timeline').boundingBox();
  if (!bounds) throw new Error('Missing timeline');
  await page.mouse.move(bounds.x + to * bounds.width, y, { steps: 5 });
}

test('drag previews without dirty/history churn, pauses playback, commits once and refreshes evaluator/selection', async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('#preview-loop').click();
  await page.locator('#play-pause').click();
  const y = await beginDrag(page, 0.5);
  await movePointer(page, 0.7, y);
  await expect.poll(() => time(page)).toBeCloseTo(0.7, 2);
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(key(page, 0.5)).toHaveAttribute('data-dragging', 'true');
  await expect(key(page, 0.5)).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.up();
  await expect(lane(page).locator('.timeline-keyframe[data-time]')).toHaveCount(3);
  await expect(lane(page).locator('.timeline-keyframe[aria-pressed="true"]')).toHaveAttribute('data-time', /^0\.7/);
  await expect(key(page, 0.5)).toHaveCount(0);
  await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveValue('40');
  await expect(page.locator('[data-keyed-property="x"]')).toHaveAttribute('data-keyed', 'true');
  await expect(lane(page, 'y').locator('[data-time="0.5"]')).toHaveCount(1);
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('moved-key.png') });
  await page.locator('#animation-undo').click();
  await expect(key(page, 0.5)).toHaveCount(1);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-redo').click();
  await expect(key(page, 0.5)).toHaveCount(0);
  await expect(page.locator('#play-pause')).toHaveText('Play');
});

test('out-of-bounds drags clamp, collision replaces one property and exact restoration is undoable', async ({
  page,
}) => {
  await openEditor(page);
  let y = await beginDrag(page, 0.5);
  const bounds = await page.locator('#timeline').boundingBox();
  await page.mouse.move(bounds!.x - 20, y, { steps: 4 });
  await page.mouse.up();
  await expect(key(page, 0)).toHaveAttribute('title', /value 40/);
  await expect(lane(page).locator('.timeline-keyframe')).toHaveCount(2);
  await page.locator('#animation-undo').click();
  await expect(key(page, 0)).toHaveAttribute('title', /value 0/);
  y = await beginDrag(page, 0.5);
  await page.mouse.move(bounds!.x + bounds!.width + 20, y, { steps: 4 });
  await page.mouse.up();
  await expect(key(page, 1)).toHaveAttribute('title', /value 40/);
  await expect(lane(page).locator('.timeline-keyframe')).toHaveCount(2);
  await expect(lane(page, 'y').locator('[data-time="1"]')).toHaveAttribute('title', /value 8/);
  await page.locator('#animation-undo').click();
  await expect(key(page, 1)).toHaveAttribute('title', /value 20/);
  await expect(key(page, 0.5)).toHaveAttribute('title', /value 40/);
  await page.locator('#animation-redo').click();
  await expect(key(page, 1)).toHaveAttribute('title', /value 40/);
});

test('frame snap uses authored FPS/fallback, Shift bypasses, Escape/pointer cancellation preserve data and redo', async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('#timeline-snap').selectOption('frame');
  let y = await beginDrag(page, 0.5);
  await movePointer(page, 0.143, y);
  await expect.poll(() => time(page)).toBe(0.1);
  await page.mouse.up();
  await expect(key(page, 0.1)).toHaveCount(1);
  await page.locator('#animation-undo').click();
  y = await beginDrag(page, 0.5);
  await page.keyboard.down('Shift');
  await movePointer(page, 0.143, y);
  await expect.poll(() => time(page)).toBeCloseTo(0.143, 3);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(key(page, 0.5)).toHaveCount(1);
  await expect.poll(() => time(page)).toBe(0.5);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-redo')).toBeEnabled();
  y = await beginDrag(page, 0.5);
  await movePointer(page, 0.8, y);
  await page.locator('#timeline').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await expect(key(page, 0.5)).toHaveCount(1);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-mode').selectOption('stepped');
  await page.locator('#animation-fps').fill('20');
  await page.locator('#animation-fps').press('Tab');
  y = await beginDrag(page, 0.5);
  await movePointer(page, 0.143, y);
  await expect.poll(() => time(page)).toBe(0.15);
  await page.mouse.up();
  await expect(key(page, 0.15)).toHaveCount(1);
});

test('keyboard nudges selected keys in one operation, preserves typing shortcuts, scrubs when unselected', async ({
  page,
}) => {
  await openEditor(page);
  await key(page, 0.5).click();
  const timeline = page.locator('#timeline');
  await timeline.press('ArrowRight');
  await expect(key(page, 0.51)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => time(page)).toBe(0.51);
  await timeline.press('Control+Z');
  await expect(key(page, 0.5)).toHaveCount(1);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await key(page, 0.5).click();
  await page.locator('#timeline-snap').selectOption('frame');
  await timeline.press('ArrowRight');
  await expect(key(page, 0.6)).toHaveCount(1);
  await timeline.press('Shift+ArrowLeft');
  await expect(key(page, 0)).toHaveAttribute('aria-pressed', 'true');
  const field = page.locator('#animation-bone-fields input[data-property="x"]');
  await field.press('ArrowRight');
  await expect(key(page, 0)).toHaveCount(1);
  await timeline.press('Control+ArrowRight');
  await timeline.dispatchEvent('keydown', { key: 'ArrowRight', isComposing: true });
  await expect(key(page, 0)).toHaveCount(1);
  await page.getByRole('button', { name: 'Select root x track', exact: true }).click();
  await timeline.press('ArrowRight');
  await expect.poll(() => time(page)).toBe(0.01);
  await expect(key(page, 0)).toHaveCount(1);
});

test('drag coordinates follow horizontal scrolling, resize and the original property lane', async ({ page }) => {
  await openEditor(page);
  await page.setViewportSize({ width: 620, height: 1400 });
  // The responsive layout normally fits its width; force overflow to exercise scrolled coordinates.
  await page.addStyleTag({ content: '.timeline-inset { overflow-x: auto; grid-template-columns: 160px 520px; }' });
  await page.locator('.timeline-inset').evaluate((element) => {
    element.scrollLeft = 100;
  });
  expect(await page.locator('.timeline-inset').evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const y = await beginDrag(page, 0.5);
  await movePointer(page, 0.7, y);
  await expect.poll(() => time(page)).toBeCloseTo(0.7, 2);
  await page.setViewportSize({ width: 800, height: 1400 });
  await page.locator('#timeline').scrollIntoViewIfNeeded();
  const row = await lane(page, 'y').boundingBox();
  await movePointer(page, 0.8, row!.y + row!.height / 2);
  await expect.poll(() => time(page)).toBeCloseTo(0.8, 2);
  await page.mouse.up();
  await expect(lane(page).locator('[aria-pressed="true"]')).toHaveAttribute('data-time', /^0\.8/);
  await expect(lane(page, 'y').locator('[data-time="0.5"]')).toHaveCount(1);
  await expect(lane(page, 'y').locator('.timeline-keyframe')).toHaveCount(2);
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('scrolled-key.png') });
});
