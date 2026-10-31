import { expect } from '@playwright/test';
import { animationMenuControl, timelineControl, test } from './fixtures.js';

test('dense expanded tracks virtualize rows and timestamps while selection survives eviction', async ({ page }) => {
  await page.route('**/animations/idle.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        name: 'idle',
        duration: 100_000,
        loop: false,
        tracks: { root: Array.from({ length: 10_001 }, (_, index) => ({ time: index * 10, x: index, y: index })) },
        ikTracks: { rightArmIK: Array.from({ length: 10_001 }, (_, index) => ({ time: index * 10, x: index })) },
      },
    }),
  );
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await (await timelineControl(page, '#timeline-zoom')).selectOption('128');
  await (await animationMenuControl(page, '#timeline-expand-all')).click();
  const inset = page.locator('.timeline-inset');
  const rootX = page.locator('#timeline-tracks [data-bone-id="root"][data-property="x"] .timeline-keyframe');
  await expect.poll(() => rootX.count()).toBeGreaterThan(0);
  expect(await rootX.count()).toBeLessThan(120);
  expect(await page.locator('#timeline-track-labels .timeline-track-label').count()).toBeLessThan(50);
  await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).press('Enter');
  await inset.evaluate((element) => {
    element.scrollLeft = element.scrollWidth - element.clientWidth;
  });
  await expect(page.getByRole('button', { name: 'Select root x key at 100 s', exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Select root x key at 0 s', exact: true })).toHaveCount(0);
  expect(await rootX.count()).toBeLessThan(120);
  await inset.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
  });
  await expect(rootX).toHaveCount(0);
  const ik = page.locator('#timeline-tracks [data-constraint-id="rightArmIK"][data-property="x"] .timeline-keyframe');
  await expect.poll(() => ik.count()).toBeGreaterThan(0);
  expect(await ik.count()).toBeLessThan(120);
  await inset.evaluate((element) => {
    element.scrollTop = 0;
    element.scrollLeft = 0;
  });
  await expect(page.getByRole('button', { name: 'Select root x key at 0 s', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await (await timelineControl(page, '#timeline-search')).fill('no matching tracks');
  await expect(page.locator('#timeline-tracks .timeline-keyframe')).toHaveCount(0);
  await (await timelineControl(page, '#timeline-reveal-selection')).click();
  await expect(page.getByRole('button', { name: 'Select root x key at 0 s', exact: true })).toBeFocused();
  await page.locator('#timeline').press(']');
  await expect(page.getByRole('button', { name: 'Select root x key at 0.01 s', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('a scrolled marquee selects model rows that were unmounted during the gesture', async ({ page }) => {
  await page.route('**/animations/idle.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        name: 'idle',
        duration: 1000,
        loop: false,
        tracks: {
          root: [{ time: 500, x: 1, y: 2 }],
          torso: [{ time: 500, x: 3 }],
          rightForearm: [{ time: 500, x: 4 }],
        },
      },
    }),
  );
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await (await animationMenuControl(page, '#timeline-expand-all')).click();
  const inset = page.locator('.timeline-inset');
  const root = page.locator('#timeline-tracks [data-bone-id="root"][data-property="x"]');
  const lane = (await root.boundingBox())!;
  const viewport = (await inset.boundingBox())!;
  const timeline = (await page.locator('#timeline').boundingBox())!;
  await page.mouse.move(timeline.x + timeline.width * 0.1, lane.y + 2);
  await page.mouse.down();
  await page.mouse.move(timeline.x + timeline.width * 0.9, lane.y + 20);
  await inset.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
  });
  await expect(root).toHaveCount(0);
  await page.mouse.move(timeline.x + timeline.width * 0.9, viewport.y + viewport.height - 20);
  await page.mouse.up();
  await expect(page.locator('#timeline-delete-key')).toHaveText('Delete 4 Selected Keys');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('drag preview and commit survive panning beyond the original key time', async ({ page }) => {
  await page.route('**/animations/idle.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        name: 'idle',
        duration: 100_000,
        loop: false,
        tracks: {
          root: [
            { time: 200, x: 1 },
            { time: 90_000, x: 2 },
          ],
        },
      },
    }),
  );
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await (await timelineControl(page, '#timeline-zoom')).selectOption('128');
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await (await timelineControl(page, '#timeline-snap-enabled')).uncheck();
  const marker = page.getByRole('button', { name: 'Select root x key at 0.2 s', exact: true });
  const box = (await marker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2);
  await page.locator('.timeline-inset').evaluate((element) => {
    element.scrollLeft = document.querySelector<HTMLElement>('#timeline')!.getBoundingClientRect().width / 2;
  });
  await expect(marker).toHaveAttribute('data-dragging', 'true');
  const preview = await marker.evaluate((element) => parseFloat((element as HTMLElement).style.left));
  expect(preview).toBeGreaterThan((await page.locator('#timeline').boundingBox())!.width / 2);
  await page.mouse.up();
  const selected = page.locator('#timeline-tracks [data-bone-id="root"][data-property="x"] [aria-pressed="true"]');
  await expect.poll(async () => Number(await selected.getAttribute('data-time'))).toBeGreaterThan(50);
  await page.locator('#animation-undo').click();
  await page.locator('.timeline-inset').evaluate((element) => {
    element.scrollLeft = 0;
  });
  await expect(marker).toBeVisible();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
