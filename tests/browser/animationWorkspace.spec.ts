import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

async function openEditor(page: Page): Promise<void> {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
}

test('desktop authoring fits the viewport and event selection leaves the ruler in place', async ({ page }) => {
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await openEditor(page);
    for (const selector of ['#animation-selection', '#animation-undo', '#animation-download', '#timeline-ruler']) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThan(height!);
    }
    const stage = (await page.locator('#animation-stage').boundingBox())!;
    const canvas = (await page.locator('#animation-stage canvas').boundingBox())!;
    expect(canvas.x).toBeGreaterThanOrEqual(stage.x);
    expect(canvas.y).toBeGreaterThanOrEqual(stage.y);
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
    expect((await page.locator('#timeline-ruler').boundingBox())!.width).toBeGreaterThan(900);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    const ruler = (await page.locator('#timeline-ruler').boundingBox())!;
    await page.locator('#timeline-add-event').click();
    await expect(page.locator('#animation-event-inspector')).toBeVisible();
    await expect(page.locator('#animation-bone-inspector')).toBeHidden();
    expect((await page.locator('#timeline-ruler').boundingBox())!.y).toBe(ruler.y);
    await page.locator('#animation-event-name').fill('impact');
    await page.locator('#animation-event-name').press('Enter');
    await expect(page.locator('.timeline-event')).toHaveAttribute('data-event-name', 'impact');
    await page.locator('#animation-undo').click();
    await expect(page.locator('#animation-event-name')).toHaveValue('event');
    await page.locator('#animation-undo').click();
    await expect(page.locator('#animation-event-inspector')).toBeHidden();
  }
});

test('panel dividers support keyboard and pointer resizing and reset without authoring', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const divider = page.locator('#animation-workspace-divider');
  const before = (await page.locator('.animation-preview').boundingBox())!.height;
  await divider.press('ArrowUp');
  await expect(divider).toHaveAttribute('aria-valuenow', '55');
  expect((await page.locator('.animation-preview').boundingBox())!.height).toBeLessThan(before);
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 50, { steps: 5 });
  await page.mouse.up();
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(55);
  const labels = page.locator('#timeline-label-divider');
  await labels.press('ArrowRight');
  await expect(labels).toHaveAttribute('aria-valuenow', '250');
  await page.locator('#timeline-zoom').selectOption('4');
  await page.locator('#timeline-filter').selectOption('keyed');
  await page.locator('#animation-reset-layout').click();
  await expect(divider).toHaveAttribute('aria-valuenow', '58');
  await expect(labels).toHaveAttribute('aria-valuenow', '240');
  await expect(page.locator('#timeline-zoom')).toHaveValue('1');
  await expect(page.locator('#timeline-filter')).toHaveValue('all');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('zoom and horizontal scrolling preserve time projection and key drag coordinates', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        events: [],
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 500, x: 10 },
            { time: 1000, x: 20 },
          ],
        },
      },
    });
  });
  await openEditor(page);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).click();
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0');
  await page.locator('#timeline-zoom').selectOption('2');
  await page.locator('.timeline-inset').evaluate((element) => {
    element.scrollLeft = 400;
  });
  const timeline = (await page.locator('#timeline').boundingBox())!;
  const ruler = (await page.locator('#timeline-ruler').boundingBox())!;
  await page.mouse.click(timeline.x + timeline.width / 2, ruler.y + 18);
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0.5');
  const marker = page.getByRole('button', { name: 'Select root x key at 0.5 s', exact: true });
  const key = (await marker.boundingBox())!;
  await page.mouse.move(key.x + key.width / 2, key.y + key.height / 2);
  await page.mouse.down();
  await page.mouse.move(key.x + key.width / 2 + timeline.width * 0.05, key.y + key.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(
        await page
          .locator(
            '.timeline-property-track[data-bone-id="root"][data-property="x"] .timeline-keyframe[aria-pressed="true"]',
          )
          .getAttribute('data-time'),
      ),
    )
    .toBeCloseTo(0.55, 2);
  await page.locator('#animation-undo').click();
  await expect(marker).toBeVisible();
  await page.getByRole('button', { name: 'Select root x key at 1 s', exact: true }).click();
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '1');
  await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).click();
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0');
});

test('collapsed timing summaries and filters preserve empty-track authoring and undo', async ({ page }) => {
  await openEditor(page);
  expect(await page.locator('.timeline-summary').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Select bone root', exact: true }).click();
  await page.locator('#timeline-filter').selectOption('selected');
  await expect(page.locator('.timeline-track-label.timeline-bone-track:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await page.getByRole('button', { name: 'Select root x track', exact: true }).click();
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  await page.locator('#timeline-filter').selectOption('keyed');
  await expect(page.locator('.timeline-track-label[data-bone-id="root"][data-property="x"]')).toBeVisible();
  await page.locator('#animation-undo').click();
  await expect(page.locator('.timeline-track-label[data-bone-id="root"][data-property="x"]')).toBeHidden();
  await page.locator('#timeline-filter').selectOption('all');
  await expect(page.locator('.timeline-track-label[data-bone-id="root"][data-property="x"]')).toBeVisible();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('narrow screens keep timing visible and open the inspector as a dismissible drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  await expect(page.locator('#animation-inspector')).toBeHidden();
  expect((await page.locator('#timeline-ruler').boundingBox())!.y).toBeLessThan(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('#timeline-add-event').click();
  await expect(page.locator('#animation-event-inspector')).toBeVisible();
  await expect(page.locator('#animation-inspector-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#animation-inspector-close').click();
  await expect(page.locator('#animation-inspector')).toBeHidden();
  await expect(page.locator('#animation-inspector-toggle')).toBeFocused();
  await page.locator('#animation-inspector-toggle').click();
  await page.locator('#animation-inspector-close').press('Escape');
  await expect(page.locator('#animation-inspector')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#animation-inspector')).toBeVisible();
  await expect(page.locator('#animation-event-name')).toHaveValue('event');
});

test('file tools and help dialogs contain focus and suppress playback shortcuts', async ({ page }) => {
  await openEditor(page);
  await page.locator('#animation-help-open').click();
  const help = page.locator('#animation-help-dialog');
  await expect(help).toBeVisible();
  await help.locator('summary').press('Space');
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await help.press('Escape');
  await expect(help).toBeHidden();
  await expect(page.locator('#animation-help-open')).toBeFocused();
  await page.locator('#animation-tools-open').click();
  await expect(page.locator('#animation-tools-dialog')).toBeVisible();
  await page.locator('#animation-import-paste').click();
  await expect(page.locator('#animation-import-text')).toBeFocused();
  await page.locator('#animation-import-cancel').click();
  await page.locator('#animation-tools-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#animation-tools-open')).toBeFocused();
});
