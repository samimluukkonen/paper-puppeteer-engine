import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { timelineControl, animationHierarchy, animationMenuControl, test, inspectorControl } from './fixtures.js';

async function openEditor(page: Page): Promise<void> {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
}

test('desktop authoring fits the viewport and event selection leaves the ruler in place', async ({ page }) => {
  test.setTimeout(120000);
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
    const inspector = (await page.locator('#animation-inspector').boundingBox())!;
    const preview = (await page.locator('.animation-preview').boundingBox())!;
    const timelinePanel = (await page.locator('.timeline-panel').boundingBox())!;
    expect(inspector.x).toBeLessThan(preview.x);
    expect(inspector.width).toBe(timelinePanel.width);
    const header = (await page.locator('#animation-editor-app .view-header').boundingBox())!;
    const localSave = page.locator('#animation-editor-app .local-draft-bar:visible');
    const chromeBottom = (await localSave.count()) ? (await localSave.boundingBox())! : header;
    expect(preview.y).toBe(chromeBottom.y + chromeBottom.height + 8);
    expect(preview.y).toBeLessThan((await commandBar.boundingBox())!.y);
    expect(preview.y + preview.height).toBeCloseTo(timelinePanel.y + timelinePanel.height, 0);
    expect(stage.y + stage.height).toBeCloseTo(preview.y + preview.height - 1, 0);
    expect(stage.width / stage.height).toBeCloseTo(210 / 297, 3);
    expect(canvas.width / canvas.height).toBeCloseTo(210 / 297, 3);
    expect(canvas.height).toBeCloseTo(stage.height, 0);
    expect((await page.locator('#timeline-ruler').boundingBox())!.width).toBeGreaterThan(150);
    expect(timelinePanel.x + timelinePanel.width).toBeLessThan(preview.x);
    const tracks = (await page.locator('.timeline-inset').boundingBox())!;
    const rulerHeight = (await page.locator('#timeline-ruler').boundingBox())!.height;
    expect(tracks.height - rulerHeight).toBeGreaterThanOrEqual(width! < 1280 ? 90 : 150);
    // Short desktop windows retain the editors' minimum panel heights and scroll to their bottom.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
      Math.max(height!, Math.ceil(preview.y + preview.height)),
    );
    const ruler = (await page.locator('#timeline-ruler').boundingBox())!;
    await (await timelineControl(page, '#timeline-add-event')).click();
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
  await expect(page.locator('.animation-selection-details')).toBeHidden();
  await expect(page.locator('#animation-inspector details[open]')).toHaveCount(0);
  await expect(page.locator('#animation-bone-empty')).toBeHidden();
  await expect(page.locator('#animation-bone-fields')).toBeHidden();
  await (await animationHierarchy(page)).locator('.tree-entry').first().click();
  await inspectorControl(page, '#animation-bone-inspector');
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

test('dragging the preview background pans without editing or changing selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await page.getByRole('button', { name: 'Select bone root', exact: true }).click();
  await page.locator('#animation-show-bones').uncheck();
  await (await animationMenuControl(page, '#animation-ik-handles')).uncheck();
  const canvas = page.locator('#animation-stage canvas');
  const box = (await canvas.boundingBox())!;
  const before = await canvas.screenshot();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 6 });
  await page.mouse.up();
  const after = await canvas.screenshot();
  expect(after.equals(before)).toBe(false);
  await page.mouse.move(box.x + 100, box.y + 80);
  expect((await canvas.screenshot()).equals(after)).toBe(true);
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: root');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('expanding onion settings keeps the menu and its controls inside the viewport', async ({ page }) => {
  test.setTimeout(60000);
  for (const [width, height] of [
    [1440, 900],
    [1000, 768],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await openEditor(page);
    await page.getByLabel('Preview options', { exact: true }).click();
    await page.locator('.animation-onion-settings > summary').click();
    const menu = page.locator('#animation-preview-menu > .animation-menu-content');
    await expect(menu).toBeVisible();
    await expect
      .poll(async () => {
        const box = (await menu.boundingBox())!;
        return box.x >= 8 && box.x + box.width <= width! - 8 && box.y >= 8 && box.y + box.height <= height! - 8;
      })
      .toBe(true);
    const panel = (await page.locator('.animation-onion-panel').boundingBox())!;
    expect(panel.x + panel.width).toBeLessThanOrEqual(width! - 8);
    await page.locator('#animation-onion-previous-count').fill('2');
    await expect(page.locator('#animation-onion-previous-count')).toHaveValue('2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});

test('narrow session controls wrap and retained drafts use the Local draft tab', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page);
  await page.getByRole('separator', { name: 'Preview width', exact: true }).press('End');
  // Reproduce the retained-draft notice without depending on a particular character's storage revision.
  await page.locator('#animation-draft-status').evaluate((element) => {
    element.textContent =
      '1 browser draft(s) retained. Download retained drafts to recover their JSON manually, or clear them if no longer needed.';
  });
  await page
    .locator('#animation-download-retained-drafts, #animation-clear-retained-drafts')
    .evaluateAll((elements) => {
      for (const element of elements) (element as HTMLButtonElement).hidden = false;
    });
  const bar = (await page.locator('.animation-command-bar').boundingBox())!;
  for (const selector of ['.animation-session-selection', '.animation-session-actions']) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bar.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bar.x + bar.width);
  }
  const download = (await page.locator('#animation-download').boundingBox())!;
  const fileTools = (await page.locator('#animation-tools-open').boundingBox())!;
  expect(download.y).toBe(fileTools.y);
  await expect(page.locator('.animation-recovery')).toBeHidden();
  await page.getByRole('tab', { name: 'Local draft', exact: true }).click();
  await expect(page.locator('.animation-recovery')).toBeVisible();
  await expect(page.locator('.animation-command-bar')).toBeHidden();
  const recovery = (await page.locator('.animation-recovery').boundingBox())!;
  const tabs = (await page.locator('.editor-tabs:visible').boundingBox())!;
  expect(recovery.x + recovery.width).toBeLessThanOrEqual(tabs.x + tabs.width);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
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
  await (await timelineControl(page, '#timeline-add-event')).click();
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
  const inspector = page.locator('#animation-inspector');
  const preview = page.locator('.animation-preview');
  const before = (await inspector.boundingBox())!.height;
  const previewBefore = (await preview.boundingBox())!;
  const previewWidth = previewBefore.width;
  const initialShare = Number(await divider.getAttribute('aria-valuenow'));
  await divider.press('ArrowUp');
  await expect(divider).toHaveAttribute('aria-valuenow', String(initialShare - 3));
  expect((await inspector.boundingBox())!.height).toBeLessThan(before);
  expect(await preview.boundingBox()).toEqual(previewBefore);
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 50, { steps: 5 });
  await page.mouse.up();
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(initialShare - 3);
  const labels = page.locator('#timeline-label-divider');
  await labels.press('ArrowRight');
  await expect(labels).toHaveAttribute('aria-valuenow', '250');
  const previewDivider = page.getByRole('separator', { name: 'Preview width', exact: true });
  const ruler = (await page.locator('#timeline-ruler').boundingBox())!;
  await previewDivider.press('ArrowLeft');
  await expect(previewDivider).toHaveAttribute('aria-valuenow', String(Math.round(previewWidth) + 10));
  expect((await preview.boundingBox())!.width).toBeCloseTo(Math.round(previewWidth) + 10, 0);
  const previewHandle = (await previewDivider.boundingBox())!;
  await page.mouse.move(previewHandle.x + previewHandle.width / 2, previewHandle.y + previewHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(previewHandle.x + previewHandle.width / 2 - 40, previewHandle.y + previewHandle.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  expect((await preview.boundingBox())!.width).toBeCloseTo(Math.round(previewWidth) + 50, 0);
  expect((await page.locator('#timeline-ruler').boundingBox())!.width).toBeLessThan(ruler.width);
  await previewDivider.press('Home');
  expect((await preview.boundingBox())!.width).toBe(280);
  await previewDivider.press('ArrowRight');
  await expect(previewDivider).toHaveAttribute('aria-valuenow', '280');
  await previewDivider.press('End');
  expect((await inspector.boundingBox())!.width).toBe(320);
  expect((await page.locator('.timeline-panel').boundingBox())!.width).toBe(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect
    .poll(async () => Number(await previewDivider.getAttribute('aria-valuenow')))
    .toBe((await page.locator('.animation-layout').boundingBox())!.width - 332);
  expect((await inspector.boundingBox())!.width).toBeGreaterThanOrEqual(320);
  const stage = (await page.locator('#animation-stage').boundingBox())!;
  expect(stage.width / stage.height).toBeCloseTo(210 / 297, 3);
  await page.setViewportSize({ width: 1440, height: 900 });
  await (await timelineControl(page, '#timeline-zoom')).selectOption('4');
  await (await timelineControl(page, '#timeline-filter')).selectOption('keyed');
  await (await animationMenuControl(page, '#animation-reset-layout')).click();
  await expect(divider).toHaveAttribute('aria-valuenow', String(initialShare));
  await expect(labels).toHaveAttribute('aria-valuenow', '240');
  await expect(previewDivider).toHaveAttribute('aria-valuenow', String(Math.round(previewWidth)));
  expect((await preview.boundingBox())!.width).toBeCloseTo(previewWidth, 0);
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
  await (await timelineControl(page, '#timeline-zoom')).selectOption('2');
  await page.locator('.timeline-inset').evaluate((element) => {
    // Keep the middle key visible even when the portrait preview leaves a narrow timeline.
    element.scrollLeft = element.querySelector('#timeline')!.getBoundingClientRect().width * 0.25;
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
  await (await timelineControl(page, '#timeline-filter')).selectOption('selected');
  await expect(page.locator('.timeline-track-label.timeline-bone-track:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await page.getByRole('button', { name: 'Select root x track', exact: true }).click();
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  await (await timelineControl(page, '#timeline-filter')).selectOption('keyed');
  await expect(page.locator('.timeline-track-label[data-bone-id="root"][data-property="x"]')).toBeVisible();
  await page.locator('#animation-undo').click();
  await expect(page.locator('.timeline-track-label[data-bone-id="root"][data-property="x"]')).toBeHidden();
  await (await timelineControl(page, '#timeline-filter')).selectOption('all');
  await expect(page.locator('.timeline-track-label[data-bone-id="root"][data-property="x"]')).toBeVisible();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('narrow screens keep timing visible and open the inspector as a dismissible drawer', async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 768 });
  await openEditor(page);
  await expect(page.locator('#animation-inspector')).toBeHidden();
  await expect(page.locator('#animation-preview-divider')).toBeHidden();
  expect((await page.locator('#timeline-ruler').boundingBox())!.y).toBeLessThan(768);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(850);
  await (await timelineControl(page, '#timeline-add-event')).click();
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
