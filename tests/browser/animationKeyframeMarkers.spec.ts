import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

async function openEditor(page: Page, empty = false) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 2000,
        playback: { mode: 'smooth' },
        events: [],
        tracks: empty
          ? {}
          : {
              root: [
                { time: 0, x: 0 },
                { time: 500, x: 40, y: 3 },
                { time: 2000, x: 20 },
              ],
            },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
}
const input = (page: Page) => page.locator('#animation-bone-fields input[data-property="x"]');
const lane = (page: Page) =>
  page.locator('#timeline-tracks .timeline-track-lane[data-bone-id="root"][data-property="x"]');
const key = (page: Page, time: number) =>
  page.getByRole('button', { name: `Select root x key at ${time} s`, exact: true });

test('markers align with shared coordinates through resize; clicks pause and coordinate key/bone/property/preview', async ({
  page,
}) => {
  await openEditor(page);
  await expect(lane(page).locator('.timeline-keyframe')).toHaveCount(3);
  for (const width of [1600, 620]) {
    await page.setViewportSize({ width, height: 1400 });
    const bounds = await page.locator('#timeline').boundingBox();
    if (!bounds) throw new Error('Missing timeline bounds.');
    for (const time of [0, 0.5, 2]) {
      const marker = await key(page, time).boundingBox();
      expect(marker!.x + marker!.width / 2).toBeCloseTo(bounds.x + (time / 2) * bounds.width, 0);
    }
  }
  await page.setViewportSize({ width: 1600, height: 1400 });
  await page.locator('#preview-loop').click();
  await page.locator('#play-pause').click();
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  await key(page, 0.5).click();
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await expect(page.locator('#timeline')).toHaveAttribute('aria-valuenow', '0.5');
  await expect(key(page, 0.5)).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page, 0)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: root');
  await expect(page.getByRole('button', { name: 'Select root x track', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(input(page)).toHaveValue('40');
  await expect(page.locator('[data-keyed-property="x"]')).toHaveAttribute('data-keyed', 'true');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  const canvas = page.locator('#animation-stage canvas');
  const selectedPose = await canvas.screenshot();
  await key(page, 2).click({ position: { x: 4, y: 12 } });
  await expect(page.locator('#timeline')).toHaveAttribute('aria-valuenow', '2');
  await expect(input(page)).toHaveValue('20');
  expect((await canvas.screenshot()).equals(selectedPose)).toBe(false);
  await key(page, 0).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#timeline')).toHaveAttribute('aria-valuenow', '0');
  await expect(key(page, 0)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('keyframe-markers.png') });
});

test('scrubbing retains selection, playback leaves markers stationary, empty click clears and adjacent commands seek', async ({
  page,
}) => {
  await openEditor(page);
  await key(page, 0.5).click();
  const timeline = page.locator('#timeline');
  const bounds = await timeline.boundingBox();
  const row = await lane(page).boundingBox();
  if (!bounds || !row) throw new Error('Missing timeline bounds.');
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + 18);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + 18, { steps: 4 });
  await page.mouse.up();
  await expect(key(page, 0.5)).toHaveAttribute('aria-pressed', 'true');
  expect(Number(await timeline.getAttribute('aria-valuenow'))).toBeCloseTo(1.2, 2);
  await expect(page.locator('[data-keyed-property="x"]')).toHaveAttribute('data-keyed', 'false');
  const markerPosition = await key(page, 0.5).evaluate((element) => element.style.left);
  await page.locator('#preview-loop').click();
  await page.locator('#play-pause').click();
  await expect.poll(async () => Number(await timeline.getAttribute('aria-valuenow'))).not.toBeCloseTo(1.2, 2);
  expect(await key(page, 0.5).evaluate((element) => element.style.left)).toBe(markerPosition);
  await expect(key(page, 0.5)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#play-pause').click();
  await page.mouse.click(bounds.x + bounds.width * 0.6, row.y + 15);
  await expect(key(page, 0.5)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#timeline-delete-key')).toBeDisabled();
  await page.locator('#timeline-previous-key').click();
  await expect(key(page, 0.5)).toHaveAttribute('aria-pressed', 'true');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0.5');
  await page.locator('#timeline-next-key').click();
  await expect(timeline).toHaveAttribute('aria-valuenow', '2');
  await expect(page.locator('#timeline-next-key')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('selected deletion uses one history operation after scrubbing and typing/composition/modifiers remain safe', async ({
  page,
}) => {
  await openEditor(page);
  await key(page, 0.5).click();
  await input(page).focus();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await expect(key(page, 0.5)).toHaveCount(1);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  const timeline = page.locator('#timeline');
  await timeline.press('End');
  const time = Number(await timeline.getAttribute('aria-valuenow'));
  expect(time).toBe(2);
  await timeline.press('Control+Delete');
  await timeline.dispatchEvent('keydown', { key: 'Delete', isComposing: true });
  await expect(key(page, 0.5)).toHaveCount(1);
  await timeline.press('Delete');
  await expect(key(page, 0.5)).toHaveCount(0);
  await expect(page.locator('#timeline-delete-key')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await expect(page.locator('[data-keyed-property="y"]')).toHaveAttribute('data-keyed', 'false');
  expect(Number(await input(page).inputValue())).toBeCloseTo(time * 10, 2);
  await page.locator('#animation-undo').click();
  await expect(key(page, 0.5)).toHaveCount(1);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await key(page, 0.5).click();
  await page.locator('#animation-redo').click();
  await expect(key(page, 0.5)).toHaveCount(0);
  await expect(page.locator('[data-keyed-property="y"]')).toHaveAttribute('data-keyed', 'true');
  await page.locator('#animation-undo').click();
  await key(page, 0.5).click();
  await page.keyboard.press('Backspace');
  await expect(key(page, 0.5)).toHaveCount(0);
  await page.locator('#animation-undo').click();
  await key(page, 0.5).click();
  await page.locator('#timeline-delete-key').click();
  await expect(key(page, 0.5)).toHaveCount(0);
});

test('inspector authoring immediately creates, updates and removes markers at start, middle and end', async ({
  page,
}) => {
  await openEditor(page, true);
  await page.getByRole('button', { name: 'Select root x track', exact: true }).click();
  const timeline = page.locator('#timeline');
  for (const [time, value] of [
    [0, '0'],
    [0.5, '40'],
    [2, '20'],
  ] as const) {
    if (time === 2) await timeline.press('End');
    else {
      await timeline.press('Home');
      for (let step = 0; step < time * 10; step++) await timeline.press('Shift+ArrowRight');
    }
    await input(page).fill(value);
    await page.getByRole('button', { name: 'Set X key', exact: true }).click();
    await expect(key(page, time)).toHaveCount(1);
  }
  await expect(lane(page).locator('.timeline-keyframe')).toHaveCount(3);
  await key(page, 0.5).click();
  await input(page).fill('44');
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  await expect(key(page, 0.5)).toHaveAttribute('title', /value 44/);
  await expect(key(page, 0.5)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Delete X key', exact: true }).click();
  await expect(key(page, 0.5)).toHaveCount(0);
  await expect(page.locator('#timeline-delete-key')).toBeDisabled();
  await page.locator('#animation-undo').click();
  await expect(key(page, 0.5)).toHaveCount(1);
});
