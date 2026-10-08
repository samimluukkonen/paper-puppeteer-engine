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
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 500, x: 40 },
            { time: 2000, x: 20 },
          ],
        },
        events: empty
          ? []
          : [
              { time: 2000, name: 'end' },
              { time: 500, name: 'step-left', data: { foot: 'left', count: 1 } },
              { time: 0, name: 'start' },
              { time: 500, name: 'step-right', data: ['right', null] },
            ],
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
}
const event = (page: Page, name: string) => page.locator(`.timeline-event[data-event-name="${name}"]`);
const key = (page: Page) => page.getByRole('button', { name: 'Select root x key at 0.5 s', exact: true });

test('event markers align with ruler endpoints on resize, and same-time events remain independently selectable', async ({
  page,
}) => {
  await openEditor(page);
  await expect(page.locator('.timeline-event')).toHaveCount(4);
  await expect(page.locator('#timeline-tracks > :first-child')).toHaveClass(/timeline-event-track/);
  for (const width of [1600, 620]) {
    await page.setViewportSize({ width, height: 1400 });
    const bounds = await page.locator('#timeline').boundingBox();
    if (!bounds) throw new Error('Missing timeline.');
    for (const [name, time] of [
      ['start', 0],
      ['step-left', 0.5],
      ['step-right', 0.5],
      ['end', 2],
    ] as const) {
      const marker = await event(page, name).boundingBox();
      expect(marker!.x + marker!.width / 2).toBeCloseTo(bounds.x + (time / 2) * bounds.width, 0);
    }
  }
  await page.setViewportSize({ width: 1600, height: 1400 });
  const left = await event(page, 'step-left').boundingBox();
  const right = await event(page, 'step-right').boundingBox();
  expect(right!.y - left!.y).toBe(30);
  await page.locator('#play-pause').click();
  await event(page, 'step-left').click();
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0.5');
  await expect(event(page, 'step-left')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-event-name')).toHaveText('step-left');
  await expect(page.locator('#animation-event-time')).toHaveText('0.500 s');
  await expect(page.locator('#animation-event-data')).toContainText('"foot": "left"');
  const pose = await page.locator('#animation-stage canvas').screenshot();
  await event(page, 'step-right').click();
  await expect(event(page, 'step-left')).toHaveAttribute('aria-pressed', 'false');
  await expect(event(page, 'step-right')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-event-name')).toHaveText('step-right');
  await expect(page.locator('#animation-event-data')).toContainText('"right"');
  await event(page, 'end').click({ position: { x: 4, y: 12 } });
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '2');
  expect((await page.locator('#animation-stage canvas').screenshot()).equals(pose)).toBe(false);
  await expect(page.locator('#animation-event-payload')).toBeHidden();
  await event(page, 'start').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0');
  await expect(event(page, 'start')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('event-track.png') });
});

test('event/key selection stays exclusive; scrubbing, playback, key editing and history preserve authored events', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await key(page).click();
  await expect(key(page)).toHaveAttribute('aria-pressed', 'true');
  await event(page, 'step-left').click();
  await expect(key(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#timeline-delete-key')).toBeDisabled();
  await expect(page.locator('#animation-event-inspector')).toBeVisible();
  const ruler = page.locator('#timeline-ruler');
  await ruler.focus();
  await page.keyboard.press('End');
  await expect(ruler).toHaveAttribute('aria-valuenow', '2');
  await expect(event(page, 'step-left')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-event-time')).toHaveText('0.500 s');
  await key(page).click();
  await expect(event(page, 'step-left')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#animation-event-inspector')).toBeHidden();
  const field = page.locator('#animation-bone-fields input[data-property="x"]');
  await field.fill('44');
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  await event(page, 'step-right').click();
  await page.locator('#animation-undo').click();
  await expect(event(page, 'step-right')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-redo')).toBeEnabled();
  await page.locator('#preview-loop').click();
  await page.locator('#play-pause').click();
  await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).not.toBe(0.5);
  await expect(event(page, 'step-right')).toHaveAttribute('data-time', '0.5');
  await event(page, 'step-right').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.timeline-event')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(page.locator('#animation-event-inspector')).toBeHidden();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('empty event track stays visible without markers or a selected inspector', async ({ page }) => {
  await openEditor(page, true);
  await expect(page.getByRole('button', { name: 'Select events track', exact: true })).toBeVisible();
  await expect(page.locator('.timeline-event')).toHaveCount(0);
  await expect(page.locator('#animation-event-inspector')).toBeHidden();
  await page.getByRole('button', { name: 'Select events track', exact: true }).click();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
