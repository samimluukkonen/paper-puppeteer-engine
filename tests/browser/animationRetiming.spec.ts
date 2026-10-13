import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationMenuControl, test } from './fixtures.js';

// The multi-step authoring/export workflow also runs on software-rendered local Chrome.
test.setTimeout(60000);

const marker = (page: Page, time: number, bone = 'root', property = 'x') =>
  page.locator(
    `.timeline-track-lane[data-bone-id="${bone}"][data-property="${property}"] .timeline-keyframe[data-time="${time}"]`,
  );
const panel = (page: Page) => page.getByRole('region', { name: 'Retime selected keys', exact: true });
async function openEditor(page: Page) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 2000,
        interpolation: 'linear',
        playback: { mode: 'smooth' },
        tracks: {
          root: [
            { time: 0, x: 0, y: 8 },
            { time: 500, x: 20 },
            { time: 1000, x: 40 },
            { time: 1500, x: 99, y: 10 },
          ],
          torso: [
            { time: 250, rotation: 0.3 },
            { time: 750, rotation: 0.6 },
          ],
        },
        ikTracks: { rightArmIK: [{ time: 500, x: 60, y: 70, mix: 0.3 }] },
        events: [{ time: 500, name: 'cue', data: { value: 3 } }],
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  for (const bone of ['root', 'torso'])
    await page.getByRole('button', { name: `Expand ${bone} properties`, exact: true }).click();
  await page.addStyleTag({ content: '.timeline-inset { max-height: 650px; }' });
  await selectGroup(page);
  await openPanel(page);
}
async function selectGroup(page: Page) {
  await marker(page, 0.5).press('Enter');
  for (const [time, bone, property] of [
    [0, 'root', 'x'],
    [1, 'root', 'x'],
    [0.25, 'torso', 'rotation'],
    [0.75, 'torso', 'rotation'],
  ] as const)
    await marker(page, time, bone, property).click({ modifiers: ['Control'] });
  await expect(page.locator('.timeline-keyframe[aria-pressed="true"]')).toHaveCount(5);
}
async function openPanel(page: Page) {
  await (await animationMenuControl(page, '#animation-retime-open')).click();
  await expect(panel(page)).toBeVisible();
}
async function download(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const path = await (await waiting).path();
  if (!path) throw new Error('Missing downloaded animation.');
  return animationFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

test('preview/compress/undo/expand/collision/redo preserve values, selection, events and exported playback', async ({
  page,
}) => {
  await openEditor(page);
  await expect(panel(page)).toContainText('Selected keys: 5');
  await expect(panel(page)).toContainText('Animation events are unaffected');
  await panel(page).getByLabel('Time scale (×)').fill('0.5');
  await panel(page).getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(panel(page).locator('tbody tr')).toHaveCount(5);
  await panel(page).screenshot({ path: test.info().outputPath('retiming-preview.png') });
  await expect(marker(page, 1)).toHaveCount(1);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(marker(page, 0.25)).toHaveAttribute('data-primary', 'true');
  await expect(marker(page, 0.5)).toHaveAttribute('title', /value 40/);
  await expect(marker(page, 0.125, 'torso', 'rotation')).toHaveAttribute('title', /value 0.3/);
  await expect(page.locator('.timeline-keyframe[aria-pressed="true"]')).toHaveCount(5);
  await expect(page.locator('.timeline-event[data-event-name="cue"]')).toHaveAttribute('data-time', '0.5');
  await page.locator('#animation-undo').click();
  await expect(marker(page, 1)).toHaveAttribute('title', /value 40/);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await selectGroup(page);
  await panel(page).getByLabel('Time scale (×)').fill('1.5');
  await panel(page).getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(panel(page)).toContainText('Replaced destination keys: 1');
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(marker(page, 1.5)).toHaveAttribute('title', /value 40/);
  await expect(marker(page, 1.5, 'root', 'y')).toHaveAttribute('title', /value 10/);
  await expect(marker(page, 0.75)).toHaveAttribute('data-primary', 'true');
  await page.locator('#animation-undo').click();
  await expect(marker(page, 1.5)).toHaveAttribute('title', /value 99/);
  await page.locator('#animation-redo').click();
  await expect(marker(page, 1.5)).toHaveAttribute('title', /value 40/);
  await panel(page).getByRole('button', { name: 'Close Retime selected keys' }).click();
  await page.locator('#play-pause').click();
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  await expect
    .poll(async () => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow')))
    .toBeGreaterThan(0.5);
  await page.locator('#play-pause').click();
  const output = await download(page);
  expect(output.duration).toBe(2000);
  expect(output.interpolation).toBe('linear');
  expect(output.playback).toEqual({ mode: 'smooth' });
  expect(output.events).toEqual([{ time: 500, name: 'cue', data: { value: 3 } }]);
  expect(output.tracks.root).toEqual([
    { time: 0, x: 0, y: 8 },
    { time: 750, x: 20 },
    { time: 1500, x: 40, y: 10 },
  ]);
});

test('playhead anchor and rejected overflow leave data and redo intact; closing invalidates preview', async ({
  page,
}) => {
  await openEditor(page);
  await panel(page).getByLabel('Time scale (×)').fill('0.5');
  await panel(page).getByLabel('Playhead', { exact: true }).check();
  await panel(page).getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(panel(page)).toContainText('Anchor: 0.5s');
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(marker(page, 0.25)).toHaveAttribute('title', /value 0/);
  await expect(marker(page, 0.75)).toHaveAttribute('title', /value 40/);
  await page.locator('#animation-undo').click();
  await selectGroup(page);
  await panel(page).getByLabel('First selected time').check();
  await panel(page).getByLabel('Time scale (×)').fill('3');
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(panel(page).getByRole('status')).toContainText('outside the animation duration');
  await expect(marker(page, 1)).toHaveAttribute('title', /value 40/);
  await expect(marker(page, 1.5)).toHaveAttribute('title', /value 99/);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-redo')).toBeEnabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await panel(page).getByLabel('Time scale (×)').fill('0');
  await expect(panel(page).getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await panel(page).getByLabel('Time scale (×)').fill('0.5');
  await panel(page).getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(panel(page).locator('table')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Close Retime selected keys' }).click();
  await openPanel(page);
  await expect(panel(page).locator('table')).toHaveCount(0);
  await page.locator('#animation-selection').selectOption('walk');
  await expect(panel(page)).toContainText('Selected keys: 0');
  await expect(panel(page).getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
});

test('a selected IK Influence channel retimes through the same panel with typed selection and history', async ({
  page,
}) => {
  await openEditor(page);
  await panel(page).getByRole('button', { name: 'Close Retime selected keys' }).click();
  await page.getByRole('button', { name: 'Expand rightArmIK properties', exact: true }).click();
  const lane = page.locator('.timeline-track-lane[data-constraint-id="rightArmIK"][data-property="mix"]');
  await lane.locator('.timeline-keyframe[data-time="0.5"]').press('Enter');
  await page.locator('#timeline-time-input').fill('0.2');
  await page.locator('#timeline-time-input').press('Enter');
  await openPanel(page);
  await expect(panel(page)).toContainText('Selected keys: 1');
  await panel(page).getByLabel('Time scale (×)').fill('0.5');
  await panel(page).getByLabel('Playhead', { exact: true }).check();
  await panel(page).getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(panel(page).locator('tbody')).toContainText('IK rightArmIK.mix');
  await panel(page).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(lane.locator('.timeline-keyframe[data-time="0.35"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(lane.locator('.timeline-keyframe[data-time="0.35"]')).toHaveAttribute('title', /value 0.3/);
  await expect(
    page.locator('.timeline-track-lane[data-constraint-id="rightArmIK"][data-property="x"] .timeline-keyframe'),
  ).toHaveAttribute('data-time', '0.5');
  await page.locator('#animation-undo').click();
  await expect(lane.locator('.timeline-keyframe')).toHaveAttribute('data-time', '0.5');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#animation-redo').click();
  await expect(lane.locator('.timeline-keyframe')).toHaveAttribute('data-time', '0.35');
  await expect(marker(page, 1)).toHaveAttribute('title', /value 40/);
  await expect(page.locator('.timeline-event[data-event-name="cue"]')).toHaveAttribute('data-time', '0.5');
});
