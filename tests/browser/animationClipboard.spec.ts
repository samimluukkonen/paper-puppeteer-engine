import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationMenuControl, animationControl, test } from './fixtures.js';

async function openEditor(page: Page, stepped = false) {
  await page.route(/\/animations\/(idle|walk)\.json$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 2000,
        playback: stepped ? { mode: 'stepped', fps: 20 } : { mode: 'smooth' },
        events: [],
        tracks: route.request().url().endsWith('walk.json')
          ? {}
          : {
              torso: [
                { time: 500, x: 4, y: 5 },
                { time: 1200, scaleX: 1.25 },
                { time: 1500, x: 99, y: 88 },
              ],
              rightUpperArm: [{ time: 800, rotation: 0.4 }],
              rightForearm: [{ time: 1200, rotation: -0.6 }],
            },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  for (const bone of ['torso', 'rightUpperArm', 'rightForearm'])
    await page.getByRole('button', { name: `Expand ${bone} properties`, exact: true }).click();
}
const marker = (page: Page, time: number, bone = 'torso', property = 'x') =>
  page.locator(
    `#timeline-tracks .timeline-track-lane[data-bone-id="${bone}"][data-property="${property}"] .timeline-keyframe[data-time="${time}"]`,
  );
const selected = (page: Page) => page.locator('.timeline-keyframe[aria-pressed="true"]');
const clock = async (page: Page) => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow'));
async function selectGroup(page: Page) {
  await marker(page, 0.5).click();
  for (const [time, bone, property] of [
    [0.5, 'torso', 'y'],
    [0.8, 'rightUpperArm', 'rotation'],
    [1.2, 'rightForearm', 'rotation'],
    [1.2, 'torso', 'scaleX'],
  ] as const)
    await marker(page, time, bone, property).click({ modifiers: ['Control'] });
  await expect(selected(page)).toHaveCount(5);
}
async function verifyGroup(page: Page, anchor: number) {
  const at = (offset: number) => Number((anchor + offset).toFixed(12));
  await expect(selected(page)).toHaveCount(5);
  const times = await selected(page).evaluateAll((elements) =>
    elements.map((element) => Number(element.getAttribute('data-time'))).sort((a, b) => a - b),
  );
  expect(times).toEqual([anchor, anchor, at(0.3), at(0.7), at(0.7)]);
  await expect(marker(page, anchor)).toHaveAttribute('data-primary', 'true');
  await expect(marker(page, at(0.3), 'rightUpperArm', 'rotation')).toHaveAttribute('aria-pressed', 'true');
  await expect(marker(page, at(0.7), 'rightForearm', 'rotation')).toHaveAttribute('aria-pressed', 'true');
  await expect(marker(page, at(0.7), 'torso', 'scaleX')).toHaveAttribute('aria-pressed', 'true');
}

test('five keys copy/paste across bones and properties, extend duration, refresh preview and Undo/Redo as one edit', async ({
  page,
}) => {
  await openEditor(page);
  await expect(page.locator('#timeline-paste-keys')).toBeDisabled();
  await selectGroup(page);
  await page.locator('#timeline').press('Meta+c');
  await expect(page.locator('#timeline-paste-keys')).toBeEnabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  expect(await clock(page)).toBe(0.5);
  await page.locator('#timeline').press('End');
  await page.locator('#timeline').press('Meta+v');
  await verifyGroup(page, 2);
  expect(await clock(page)).toBe(2);
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuemax', '2.7');
  await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveValue('4');
  await expect(page.locator('#animation-bone-fields input[data-property="y"]')).toHaveValue('5');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('pasted-keyframes.png') });
  await page.locator('#animation-undo').click();
  await expect(marker(page, 2)).toHaveCount(0);
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuemax', '2');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-redo').click();
  await expect(marker(page, 2)).toHaveAttribute('title', /value 4/);
  await expect(marker(page, 2.7, 'rightForearm', 'rotation')).toHaveAttribute('title', /value -0.6/);
  await page.locator('#reset-time').click();
  await page.locator('#play-pause').click();
  await expect.poll(() => clock(page)).toBeGreaterThan(0.1);
  await page.locator('#play-pause').click();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
});

test('copy/paste buttons retain the clipboard across a compatible animation switch', async ({ page }) => {
  await openEditor(page);
  await selectGroup(page);
  await (await animationMenuControl(page, '#timeline-copy-keys')).click();
  await page.locator('#timeline').press('Escape');
  await expect(page.locator('#timeline-copy-keys')).toBeDisabled();
  await page.locator('#animation-selection').selectOption('walk');
  await expect(selected(page)).toHaveCount(0);
  await expect(page.locator('#timeline-paste-keys')).toBeEnabled();
  await (await animationMenuControl(page, '#timeline-paste-keys')).click();
  await verifyGroup(page, 0);
  expect(await clock(page)).toBe(0);
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-undo').click();
  await expect(page.locator('.timeline-keyframe')).toHaveCount(0);
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('duplicate shortcut uses one authored frame and selects the group; button works for smooth fallback', async ({
  page,
}) => {
  await openEditor(page, true);
  await selectGroup(page);
  await page.locator('#timeline').press('Control+d');
  await verifyGroup(page, 0.55);
  expect(await clock(page)).toBe(0.5);
  await page.locator('#animation-undo').click();
  await expect(marker(page, 0.55)).toHaveCount(0);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await (await animationControl(page, '#animation-mode')).selectOption('smooth');
  await selectGroup(page);
  await (await animationMenuControl(page, '#timeline-duplicate-keys')).click();
  await verifyGroup(page, 0.51);
  expect(await clock(page)).toBe(0.5);
  await page.locator('#animation-undo').click();
  await expect(marker(page, 0.51)).toHaveCount(0);
  await expect(marker(page, 0.5)).toHaveCount(1);
});

test('paste collisions replace only the selected destination property and exact values return with Undo', async ({
  page,
}) => {
  await openEditor(page);
  await marker(page, 0.5).click();
  await page.locator('#timeline').press('Control+c');
  await marker(page, 1.5).click();
  await page.locator('#timeline').press('Control+v');
  expect(await clock(page)).toBe(1.5);
  await expect(marker(page, 1.5)).toHaveAttribute('title', /value 4/);
  await expect(marker(page, 1.5, 'torso', 'y')).toHaveAttribute('title', /value 88/);
  await expect(selected(page)).toHaveCount(1);
  await expect(marker(page, 0.5)).toHaveAttribute('title', /value 4/);
  await page.locator('#animation-undo').click();
  await expect(marker(page, 1.5)).toHaveAttribute('title', /value 99/);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#animation-redo').click();
  await expect(marker(page, 1.5)).toHaveAttribute('title', /value 4/);
});

test('clipboard shortcuts preserve native input behavior and bookmarks outside the timeline, with modifier/IME/repeat guards', async ({
  page,
}) => {
  await openEditor(page);
  await selectGroup(page);
  await (await animationMenuControl(page, '#timeline-copy-keys')).click();
  const input = page.locator('#animation-bone-fields input[data-property="x"]');
  await input.fill('123');
  await input.press('Control+c');
  await input.press('Meta+d');
  await expect(input).toHaveValue('123');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  const results = await page.evaluate(() => {
    const timeline = document.querySelector('#timeline')!;
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.innerHTML = '<span>typing</span>';
    timeline.append(editable);
    const textarea = document.createElement('textarea');
    timeline.append(textarea);
    const targets = [
      document.querySelector('#animation-bone-title')!,
      document.querySelector('#playback-speed')!,
      document.querySelector('#animation-bone-fields input')!,
      textarea,
      editable.firstElementChild!,
    ];
    const native = targets.flatMap((target) =>
      ['c', 'v', 'd'].map((key) =>
        target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key })),
      ),
    );
    const guarded = [{ isComposing: true }, { repeat: true }, { altKey: true }, { shiftKey: true }].map((guard) =>
      timeline.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, metaKey: true, key: 'd', ...guard }),
      ),
    );
    editable.remove();
    textarea.remove();
    return { native, guarded };
  });
  expect(results.native.every(Boolean)).toBe(true);
  // Repeat is prevented to avoid browser bookmarks but does not execute another edit.
  expect(results.guarded).toEqual([true, false, true, true]);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#timeline').press('End');
  await page.locator('#timeline').press('Control+v');
  await verifyGroup(page, 2);
  await expect(marker(page, 2)).toHaveAttribute('title', /value 4/, { timeout: 1000 });
});
