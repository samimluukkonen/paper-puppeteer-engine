import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

const key = (page: Page, time: number) =>
  page.locator(`.timeline-track-lane[data-bone-id="root"][data-property="x"] .timeline-keyframe[data-time="${time}"]`);
const guide = (page: Page) => page.locator('#timeline-snap-guide');

async function openEditor(page: Page) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 2000,
        loop: false,
        playback: { mode: 'smooth' },
        tracks: {
          root: [
            { time: 200, x: 10 },
            { time: 350, x: 20 },
            { time: 500, x: 30 },
          ],
        },
        events: [
          { time: 750, name: 'cue' },
          { time: 1100, name: 'second' },
        ],
        ikTracks: {
          rightArmIK: [
            { time: 100, x: 10 },
            { time: 950, y: 20 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await page.locator('#timeline-snap-enabled').check();
}
async function only(page: Page, mode: string) {
  for (const setting of ['frames', 'keyframes', 'events', 'playhead'])
    await page.locator(`#timeline-snap-${setting}`).setChecked(setting === mode);
}
async function start(page: Page, time = 0.2) {
  const marker = key(page, time);
  await marker.scrollIntoViewIfNeeded();
  const box = (await marker.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  return y;
}
async function move(page: Page, target: number, y: number, offsetPx = 5) {
  // Native pan keeps the proposed time visible even at high zoom, while capture retains the gesture.
  await page.locator('.timeline-inset').evaluate((element, time) => {
    const timeline = document.querySelector<HTMLElement>('#timeline')!;
    const inset = element.getBoundingClientRect();
    const bounds = timeline.getBoundingClientRect();
    const x = bounds.left + (bounds.width * time) / 2;
    if (x < inset.left + 180 || x > inset.right - 30) element.scrollLeft += x - (inset.left + inset.width * 0.6);
  }, target);
  const bounds = (await page.locator('#timeline').boundingBox())!;
  await page.mouse.move(bounds.x + (bounds.width * target) / 2 + offsetPx, y, { steps: 4 });
}

for (const zoom of ['1', '2', '4']) {
  test(`all modes show aligned guides at ${zoom}x zoom; Shift, cancellation and toggles stay clean`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await openEditor(page);
    await page.locator('#timeline-zoom').selectOption(zoom);
    for (const [mode, type, time] of [
      ['frames', 'frame', 0.4],
      ['keyframes', 'keyframe', 0.5],
      ['events', 'event', 0.75],
      ['playhead', 'playhead', 0.66],
    ] as const) {
      await only(page, mode);
      await page.locator('#timeline-time-input').fill('0.66');
      await page.locator('#timeline-time-input').press('Enter');
      const y = await start(page);
      await move(page, time, y);
      await expect(guide(page)).toBeVisible();
      await expect(guide(page)).toHaveAttribute('data-type', type);
      await expect(guide(page)).toHaveAttribute('data-time', String(time));
      await expect(guide(page).locator('span')).toContainText(`${time.toFixed(3)} s`);
      const error = await guide(page).evaluate((element, time) => {
        const timeline = document.querySelector<HTMLElement>('#timeline')!;
        return Math.abs(
          parseFloat((element as HTMLElement).style.left) - (timeline.getBoundingClientRect().width * time) / 2,
        );
      }, time);
      expect(error).toBeLessThan(0.1);
      await expect(page.locator('#animation-undo')).toBeDisabled();
      await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
      // Modifier alone refreshes the guide even with a stationary pointer.
      await page.keyboard.down('Shift');
      await expect(guide(page)).toBeHidden();
      await page.keyboard.up('Shift');
      await expect(guide(page)).toBeVisible();
      if (mode === 'frames') {
        const bounds = (await page.locator('#timeline').boundingBox())!;
        const framePixels = bounds.width / 20; // Two seconds, ten authored frames per second.
        if (framePixels > 20) {
          await move(page, time, y, framePixels / 2);
          await expect(guide(page)).toBeHidden();
        } else {
          // Dense frame ranges overlap; moving one frame should select the adjacent candidate.
          await move(page, time, y, framePixels);
          await expect(guide(page)).toHaveAttribute('data-time', String(time + 0.1));
        }
      } else {
        await move(page, time, y, 12);
        await expect(guide(page)).toBeHidden();
      }
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(key(page, 0.2)).toHaveCount(1);
      await expect(guide(page)).toBeHidden();
    }
    await page.locator('#timeline-snap-enabled').uncheck();
    const y = await start(page);
    await move(page, 0.66, y);
    await expect(guide(page)).toBeHidden();
    await page.locator('#timeline').dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
    await expect(page.locator('#animation-undo')).toBeDisabled();
  });
}

test('group event snapping preserves spacing and commits one Undo/Redo; event snaps keep same-time events', async ({
  page,
}) => {
  test.setTimeout(60000);
  await openEditor(page);
  await only(page, 'events');
  await key(page, 0.2).click();
  await key(page, 0.35).click({ modifiers: ['Control'] });
  const y = await start(page);
  await move(page, 0.75, y);
  await expect(guide(page)).toHaveAttribute('data-type', 'event');
  const delta = await page.locator('.timeline-keyframe[data-dragging="true"]').evaluateAll((elements) =>
    elements.map((element) => {
      const timeline = document.querySelector<HTMLElement>('#timeline')!;
      return (
        (parseFloat((element as HTMLElement).style.left) / timeline.getBoundingClientRect().width) * 2 -
        Number((element as HTMLElement).dataset.time)
      );
    }),
  );
  expect(delta).toHaveLength(2);
  for (const value of delta) expect(value).toBeCloseTo(0.55, 8);
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('snapped-group-guide.png') });
  await page.mouse.up();
  await expect(guide(page)).toBeHidden();
  await expect(key(page, 0.75)).toHaveCount(1);
  await expect(key(page, 0.9)).toHaveCount(1);
  await page.locator('#animation-undo').click();
  await expect(key(page, 0.2)).toHaveCount(1);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#animation-redo').click();
  await expect(key(page, 0.9)).toHaveCount(1);
  const event = page.locator('.timeline-event[data-event-name="cue"]');
  const box = (await event.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await move(page, 1.1, box.y + box.height / 2);
  await expect(guide(page)).toHaveAttribute('data-type', 'event');
  await page.mouse.up();
  await expect(page.locator('.timeline-event[data-time="1.1"]')).toHaveCount(2);
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
});
