import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationMenuControl, test } from './fixtures.js';

async function openEditor(page: Page): Promise<void> {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
}

test('desktop authoring fits the viewport and event selection leaves the ruler in place', async ({ page }) => {
  test.setTimeout(60000);
  for (const [width, height] of [
    [1000, 768],
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await openEditor(page);
    const mode = page.getByRole('combobox', { name: 'Editor Mode', exact: true });
    const modeBox = (await mode.boundingBox())!;
    const animationBox = (await page.locator('#animation-selection').boundingBox())!;
    expect(modeBox.y).toBe(animationBox.y);
    const commandBar = page.locator('.animation-command-bar');
    const toolbarHeight = (await commandBar.boundingBox())!.height;
    // Compare against the same workspace without the new controls: mode selection must cost no extra row.
    await page.locator('.editor-mode-control').evaluate((element) => {
      (element as HTMLElement).style.display = 'none';
    });
    expect(toolbarHeight).toBe((await commandBar.boundingBox())!.height);
    await page.locator('.editor-mode-control').evaluate((element) => {
      (element as HTMLElement).style.removeProperty('display');
    });
    await mode.selectOption('rig-tweak');
    expect((await commandBar.boundingBox())!.height).toBe(toolbarHeight);
    await expect(page.locator('#animation-inspector-toggle')).not.toHaveAttribute('inert');
    await mode.selectOption('animation');
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
    expect((await page.locator('#timeline-ruler').boundingBox())!.width).toBeGreaterThan(width! - 350);
    const tracks = (await page.locator('.timeline-inset').boundingBox())!;
    const rulerHeight = (await page.locator('#timeline-ruler').boundingBox())!.height;
    expect(tracks.height - rulerHeight).toBeGreaterThanOrEqual(150);
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

test('compact property actions preserve drafts, keyed state and history', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openEditor(page);
  await expect(page.locator('#animation-bone-empty')).toBeVisible();
  await expect(page.locator('#animation-bone-fields')).toBeHidden();
  await page.locator('#animation-bones .tree-entry').first().click();
  const input = page.locator('#animation-bone-fields input[data-property="x"]');
  const diamond = page.getByRole('button', { name: 'Set X key', exact: true });
  await expect(diamond).toHaveText('◇');
  await input.fill('12');
  await expect(input).toHaveAttribute('data-temporary', 'true');
  await diamond.click();
  await expect(diamond).toHaveText('◆');
  await expect(input).toHaveAttribute('data-temporary', 'false');
  await page.getByLabel('X key actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete X key', exact: true }).click();
  await expect(diamond).toHaveText('◇');
  await expect(page.getByLabel('X key actions', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(diamond).toHaveText('◆');
  await expect(input).toHaveValue('12');
});

test('timeline context actions retain selected groups and Escape returns focus without clearing selection', async ({
  page,
}) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 1000, x: 10 },
          ],
        },
      },
    });
  });
  await openEditor(page);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  const first = page.getByRole('button', { name: 'Select root x key at 0 s', exact: true });
  const last = page.getByRole('button', { name: 'Select root x key at 1 s', exact: true });
  await first.click();
  await last.click({ modifiers: ['Control'] });
  await last.click({ button: 'right' });
  await expect(page.locator('#timeline-edit-menu')).toHaveAttribute('open', '');
  await expect(page.locator('#timeline-delete-key')).toHaveText('Delete 2 Selected Keys');
  await page.keyboard.press('Escape');
  await expect(last).toBeFocused();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await first.click({ button: 'right' });
  await page.locator('#timeline-copy-keys').click();
  await expect(first).toBeFocused();
  await page.locator('#timeline-time-input').fill('0.5');
  await page.locator('#timeline-time-input').press('Enter');
  await (await animationMenuControl(page, '#timeline-paste-keys')).click();
  await expect(page.getByRole('button', { name: 'Select root x key at 0.5 s', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select root x key at 1.5 s', exact: true })).toBeVisible();
  await page.locator('#timeline-add-event').click();
  await page.locator('.timeline-event').click({ button: 'right' });
  await expect(page.locator('#timeline-delete-key')).toHaveText('Delete Event');
  await page.locator('#timeline-delete-key').click();
  await expect(page.locator('.timeline-event')).toHaveCount(0);
  await expect(page.locator('#timeline-edit-menu > summary')).toBeFocused();
});

test('panel dividers support keyboard and pointer resizing and reset without authoring', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  const divider = page.locator('#animation-workspace-divider');
  const before = (await page.locator('.animation-preview').boundingBox())!.height;
  await divider.press('ArrowUp');
  await expect(divider).toHaveAttribute('aria-valuenow', '49');
  expect((await page.locator('.animation-preview').boundingBox())!.height).toBeLessThan(before);
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 50, { steps: 5 });
  await page.mouse.up();
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(49);
  const labels = page.locator('#timeline-label-divider');
  await labels.press('ArrowRight');
  await expect(labels).toHaveAttribute('aria-valuenow', '250');
  await page.locator('#timeline-zoom').selectOption('4');
  await page.locator('#timeline-filter').selectOption('keyed');
  await (await animationMenuControl(page, '#animation-reset-layout')).click();
  await expect(divider).toHaveAttribute('aria-valuenow', '52');
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
  await (await animationMenuControl(page, '#animation-help-open')).click();
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
