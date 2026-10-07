import { readFile } from 'node:fs/promises';
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
        interpolation: undefined,
        events: [],
        tracks: {
          root: [
            { time: 0, x: 0, rotation: 0 },
            { time: 1000, x: 100, rotation: 1 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
}
const key = (page: Page, time = 0, property = 'x') =>
  page.getByRole('button', { name: `Select root ${property} key at ${time} s`, exact: true });
const rotation = (page: Page) => page.locator('#animation-bone-fields input[data-property="rotation"]');

test('selection inspector and authored marker titles distinguish outgoing and terminal keys', async ({ page }) => {
  await openEditor(page);
  const control = page.locator('#timeline-interpolation');
  await expect(control).toBeDisabled();
  await expect(control).toHaveValue('');
  await expect(control.locator('option')).toHaveText(['—', 'Linear']);
  await expect(key(page)).toHaveAttribute('data-interpolation', 'linear');
  await expect(key(page)).toHaveAttribute(
    'title',
    /root\.x\nTime: 0\.000 s.*\nInterpolation: Linear \(inherited from clip\)/,
  );
  await expect(key(page, 1)).toHaveAttribute('data-interpolation', 'unavailable');
  await expect(key(page, 1)).toHaveAttribute('title', /no outgoing segment/);
  await key(page).click();
  await expect(control).toHaveValue('linear');
  await expect(control).toBeDisabled();
  await expect(page.locator('#timeline-interpolation-help')).toContainText('inherited from the clip');
  await key(page, 0, 'rotation').click({ modifiers: ['ControlOrMeta'] });
  await expect(control).toHaveValue('linear');
  await expect(key(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page, 0, 'rotation')).toHaveAttribute('aria-pressed', 'true');
  await key(page, 1).click({ modifiers: ['ControlOrMeta'] });
  await expect(control).toHaveValue('');
  await expect(page.locator('#timeline-interpolation-help')).toContainText('no outgoing segment');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('interpolation-markers.png') });
});

test('clip declaration UI preserves multi-selection, marker buttons and time through Undo/Redo', async ({ page }) => {
  await openEditor(page);
  await key(page).click();
  await key(page, 0, 'rotation').click({ modifiers: ['ControlOrMeta'] });
  const ruler = page.locator('#timeline-ruler');
  for (let i = 0; i < 5; i++) await ruler.press('Shift+ArrowRight');
  const heldTime = await ruler.getAttribute('aria-valuenow');
  const heldRotation = await rotation(page).inputValue();
  await key(page).evaluate((element) => {
    element.dataset.identityProbe = 'surviving';
  });
  await page.locator('#animation-interpolation').selectOption('linear');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await expect(ruler).toHaveAttribute('aria-valuenow', heldTime!);
  await expect(rotation(page)).toHaveValue(heldRotation);
  for (const property of ['x', 'rotation'])
    await expect(key(page, 0, property)).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page)).toHaveAttribute('data-primary', 'true');
  await expect(key(page)).toHaveAttribute('data-identity-probe', 'surviving');
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-interpolation')).toHaveValue('');
  await expect(page.locator('#timeline-interpolation')).toHaveValue('linear');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#animation-redo').click();
  await expect(page.locator('#animation-interpolation')).toHaveValue('linear');
  await expect(key(page)).toHaveAttribute('data-interpolation', 'linear');
  await expect(key(page)).toHaveAttribute('data-identity-probe', 'surviving');
  await expect(ruler).toHaveAttribute('aria-valuenow', heldTime!);
  for (const property of ['x', 'rotation'])
    await expect(key(page, 0, property)).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page)).toHaveAttribute('data-primary', 'true');
  await expect(rotation(page)).toHaveValue(heldRotation);
  await page.locator('#animation-interpolation').selectOption('');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('smooth/stepped sample timing uses the existing evaluator and does not change authored interpolation', async ({
  page,
}) => {
  await openEditor(page);
  await key(page, 0, 'rotation').click();
  const ruler = page.locator('#timeline-ruler');
  for (const mode of ['smooth', 'stepped']) {
    await page.locator('#animation-mode').selectOption(mode);
    if (mode === 'stepped') await page.locator('#animation-fps').fill('1');
    if (mode === 'stepped') await page.locator('#animation-fps').press('Tab');
    await ruler.press('Home');
    for (const time of [0, 0.25, 0.5, 0.75, 1]) {
      if (time !== 0) for (let step = 0; step < 25; step++) await ruler.press('ArrowRight');
      expect(Number(await ruler.getAttribute('aria-valuenow'))).toBeCloseTo(time, 8);
      const radians = mode === 'stepped' && time < 1 ? 0 : time;
      expect(Number(await rotation(page).inputValue())).toBeCloseTo((radians * 180) / Math.PI, 2);
      await expect(page.locator('#timeline-interpolation')).toHaveValue('linear');
      await expect(key(page, 0, 'rotation')).toHaveAttribute('data-interpolation', 'linear');
    }
    await ruler.press('Home');
    await page.locator('#play-pause').click();
    await expect(page.locator('#play-pause')).toHaveText('Pause');
    await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).toBeGreaterThan(0.1);
    await page.locator('#play-pause').click();
    if (mode === 'stepped') expect(Number(await rotation(page).inputValue())).toBe(0);
    else expect(Number(await rotation(page).inputValue())).toBeGreaterThan(0);
  }
  await page.setViewportSize({ width: 620, height: 1400 });
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('interpolation-mobile.png') });
});

async function openHardeningEditor(page: Page) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        playback: { mode: 'smooth' },
        interpolation: undefined,
        events: [],
        tracks: {
          root: [
            { time: 0, rotation: 0 },
            { time: 400, y: 7 },
            { time: 500, rotation: 0.5 },
            { time: 1000, rotation: 1 },
          ],
          torso: [
            { time: 200, x: 20 },
            { time: 800, x: 80 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  for (const bone of ['root', 'torso'])
    await page.getByRole('button', { name: `Expand ${bone} properties`, exact: true }).click();
}
const hardeningKey = (page: Page, time: number, property = 'rotation', bone = 'root') =>
  page.getByRole('button', { name: `Select ${bone} ${property} key at ${time} s`, exact: true });
async function downloadAnimation(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const path = await (await waiting).path();
  if (!path) throw new Error('Animation download has no local file.');
  return animationFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

test('multi-track interpolation inspection stays coherent through the complete key/history/playback workflow', async ({
  page,
}) => {
  await openHardeningEditor(page);
  await hardeningKey(page, 0).click();
  await hardeningKey(page, 0.5).click({ modifiers: ['ControlOrMeta'] });
  await hardeningKey(page, 0.2, 'x', 'torso').click({ modifiers: ['ControlOrMeta'] });
  const inspector = page.locator('#timeline-interpolation');
  await expect(inspector).toHaveValue('linear');
  await page.locator('#animation-interpolation').selectOption('linear');
  await page.locator('#timeline').press('ArrowRight');
  await expect(hardeningKey(page, 0.01)).toHaveAttribute('data-interpolation', 'linear');
  await expect(hardeningKey(page, 0.51)).toHaveAttribute('aria-pressed', 'true');
  await expect(hardeningKey(page, 0.21, 'x', 'torso')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#timeline-copy-keys').click();
  await page.locator('#timeline-ruler').press('End');
  await page.locator('#timeline-paste-keys').click();
  await expect(hardeningKey(page, 1)).toHaveAttribute('title', /value 0/);
  await expect(hardeningKey(page, 1.5)).toHaveAttribute('data-interpolation', 'unavailable');
  await expect(inspector).toHaveValue('');
  await page.locator('#timeline-duplicate-keys').click();
  await expect(hardeningKey(page, 1.51)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#timeline').press('ArrowLeft');
  await expect(hardeningKey(page, 1.5)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#timeline-delete-key').click();
  await expect(inspector).toHaveAttribute('data-unavailable-reason', 'empty-selection');
  for (let index = 0; index < 6; index++) await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-interpolation')).toHaveValue('');
  await expect(hardeningKey(page, 1)).toHaveAttribute('title', /value 1/);
  await expect(hardeningKey(page, 0.5)).toHaveAttribute('data-interpolation', 'linear');
  for (let index = 0; index < 6; index++) await page.locator('#animation-redo').click();
  await expect(page.locator('#animation-redo')).toBeDisabled();
  await expect(page.locator('#animation-interpolation')).toHaveValue('linear');
  await expect(inspector).toHaveAttribute('data-unavailable-reason', 'empty-selection');
  await page.locator('#animation-mode').selectOption('stepped');
  await page.locator('#animation-fps').fill('10');
  await page.locator('#animation-fps').press('Tab');
  const beforePreview = await downloadAnimation(page);
  expect(beforePreview.interpolation).toBe('linear');
  expect(beforePreview.playback).toEqual({ mode: 'stepped', fps: 10 });
  await page.locator('#preview-loop').click();
  await page.locator('#playback-speed').selectOption('2');
  await page.locator('#reset-time').click();
  await page.locator('#play-pause').click();
  await expect
    .poll(async () => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow')))
    .toBeGreaterThan(0.1);
  await page.locator('#play-pause').click();
  for (const facing of ['left', 'right', 'left', 'right']) await page.locator('#animation-facing').selectOption(facing);
  await page.locator('#animation-ik-preview').check();
  await page.locator('#timeline-ruler').press('Home');
  await page.locator('#timeline-ruler').press('Shift+ArrowRight');
  await page.locator('#animation-ik-preview').uncheck();
  expect(await downloadAnimation(page)).toEqual(beforePreview);
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('interpolation-hardening.png') });
});

test('terminal, singleton and empty property markers refresh after deleting successors and Undo/Redo', async ({
  page,
}) => {
  await openHardeningEditor(page);
  await expect(hardeningKey(page, 0.4, 'y')).toHaveAttribute('data-interpolation', 'unavailable');
  const empty = page.locator('.timeline-track-lane[data-bone-id="root"][data-property="scaleX"]');
  await expect(empty.locator('.timeline-keyframe')).toHaveCount(0);
  await hardeningKey(page, 1).click();
  await page.locator('#timeline-delete-key').click();
  await expect(hardeningKey(page, 0.5)).toHaveAttribute('data-interpolation', 'unavailable');
  await hardeningKey(page, 0.5).click();
  await expect(page.locator('#timeline-interpolation')).toHaveValue('');
  await hardeningKey(page, 0.5).evaluate((element) => {
    element.dataset.identityProbe = 'surviving';
  });
  await page.locator('#animation-undo').click();
  await expect(page.locator('#timeline-interpolation')).toHaveValue('linear');
  await expect(hardeningKey(page, 0.5)).toHaveAttribute('data-identity-probe', 'surviving');
  await expect(hardeningKey(page, 0.5)).toHaveAttribute('title', /Linear \(inherited from clip\)/);
  await page.locator('#animation-redo').click();
  await expect(hardeningKey(page, 0.5)).toHaveAttribute('title', /no outgoing segment/);
  await expect(page.locator('#timeline-interpolation')).toHaveValue('');
  await page.locator('#timeline-delete-key').click();
  await expect(page.locator('#timeline-interpolation')).toHaveAttribute('data-unavailable-reason', 'empty-selection');
  await expect(hardeningKey(page, 0)).toHaveAttribute('data-interpolation', 'unavailable');
});
