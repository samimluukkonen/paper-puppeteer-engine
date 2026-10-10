import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

test.describe.configure({ timeout: 60000 });

async function openEditor(page: Page) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        playback: { mode: 'smooth' },
        events: [],
        interpolation: 'linear',
        tracks: {
          leftUpperArm: [
            { time: 0, rotation: -0.8 },
            { time: 1000, rotation: 0.4 },
          ],
          rightUpperArm: [
            { time: 0, rotation: 0.6 },
            { time: 1000, rotation: -0.3 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-show-bones').uncheck();
  await page.locator('.animation-mirror-tools > summary').click();
}
const panel = (page: Page) => page.getByRole('region', { name: 'Mirror tools', exact: true });
const poseButton = (page: Page) => panel(page).getByRole('button', { name: 'Mirror Current Pose', exact: true });
const keysButton = (page: Page) => panel(page).getByRole('button', { name: 'Mirror Selected Keys', exact: true });
const key = (page: Page, bone: string, time: string) =>
  page.locator(`#timeline-tracks [data-bone-id="${bone}"][data-property="rotation"] [data-time="${time}"]`);

test('React pair editing validates, persists overrides per rig, and keeps authored state clean', async ({ page }) => {
  await openEditor(page);
  await expect(poseButton(page)).toBeEnabled();
  await expect(keysButton(page)).toBeDisabled();
  await panel(page).getByText('Configure Bone Pairs', { exact: true }).click();
  await expect(panel(page)).toContainText('Unpaired bones:');
  await panel(page).getByRole('button', { name: 'Add pair', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('does not exist');
  await expect(poseButton(page)).toBeDisabled();
  const left = panel(page)
    .getByRole('combobox', { name: /^Left bone/ })
    .last();
  const right = panel(page)
    .getByRole('combobox', { name: /^Right bone/ })
    .last();
  await left.selectOption('leftUpperArm');
  await right.selectOption('leftUpperArm');
  await expect(panel(page).getByRole('alert')).toContainText('itself');
  await panel(page)
    .getByRole('button', { name: /^Remove pair/ })
    .last()
    .click();
  const firstLeft = panel(page).getByRole('combobox', { name: 'Left bone 1', exact: true });
  const firstRight = panel(page).getByRole('combobox', { name: 'Right bone 1', exact: true });
  const leftId = await firstLeft.inputValue();
  const rightId = await firstRight.inputValue();
  await firstLeft.selectOption(rightId);
  await expect(poseButton(page)).toBeDisabled();
  await firstRight.selectOption(leftId);
  await expect(poseButton(page)).toBeEnabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.reload();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('.animation-mirror-tools > summary').click();
  await panel(page).getByText('Configure Bone Pairs', { exact: true }).click();
  await expect(firstLeft).toHaveValue(rightId);
  await expect(firstRight).toHaveValue(leftId);
  await panel(page).getByRole('button', { name: 'Use inferred pairs', exact: true }).click();
  await expect(firstLeft).toHaveValue(leftId);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('preview directions, shortcut guards, onion skin and facing preserve time, history and artwork', async ({
  page,
}) => {
  test.setTimeout(60000);
  await openEditor(page);
  await page.locator('.animation-mirror-tools > summary').click();
  await page.locator('#animation-onion-skinning').check();
  const canvas = page.locator('#animation-stage canvas');
  const closedPanel = await canvas.screenshot();
  await page.locator('.animation-mirror-tools > summary').click();
  const normal = await canvas.screenshot();
  const clock = await page.locator('#timeline-ruler').getAttribute('aria-valuenow');
  await panel(page).getByRole('button', { name: 'Preview Mirrored Pose', exact: true }).click();
  await expect.poll(async () => (await canvas.screenshot()).equals(normal)).toBe(false);
  for (const direction of ['Right → Left', 'Swap', 'Left → Right']) {
    await panel(page).getByRole('radio', { name: direction, exact: true }).check();
    await expect(panel(page).getByRole('button', { name: 'Hide Mirrored Preview', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await canvas.screenshot({
      path: test
        .info()
        .outputPath(
          `mirror-${direction === 'Swap' ? 'swap' : direction.startsWith('Left') ? 'left-right' : 'right-left'}.png`,
        ),
    });
  }
  await page.locator('#animation-facing').selectOption('left');
  await canvas.screenshot({ path: test.info().outputPath('mirror-facing-left.png') });
  await page.locator('#animation-facing').selectOption('right');
  await panel(page).getByRole('button', { name: 'Hide Mirrored Preview', exact: true }).click();
  await expect.poll(async () => (await canvas.screenshot()).equals(normal)).toBe(true);
  await page.locator('#timeline-ruler').focus();
  await page.keyboard.press('m');
  await expect(panel(page).getByRole('button', { name: 'Hide Mirrored Preview', exact: true })).toBeVisible();
  await page.keyboard.press('Control+m');
  await expect(panel(page).getByRole('button', { name: 'Hide Mirrored Preview', exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Hide Mirrored Preview', exact: true }).press('Escape');
  await expect(panel(page).getByRole('button', { name: 'Preview Mirrored Pose', exact: true })).toBeVisible();
  await page.locator('#timeline-ruler').focus();
  await page.keyboard.press('m');
  await page.locator('.animation-mirror-tools > summary').click();
  await expect.poll(async () => (await canvas.screenshot()).equals(closedPanel)).toBe(true);
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', clock!);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('current pose and selected keys refresh inspector and timeline with one Undo/Redo and unchanged sources', async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('.animation-mirror-tools > summary').click();
  await page.locator('#animation-bones').getByRole('button', { name: 'leftUpperArm', exact: true }).click();
  await page.locator('.animation-mirror-tools > summary').click();
  await poseButton(page).click();
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: rightUpperArm');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await expect(keysButton(page)).toBeDisabled();
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-redo').click();
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await page.locator('#animation-undo').click();
  await page.getByRole('button', { name: 'Expand leftUpperArm properties', exact: true }).click();
  await key(page, 'leftUpperArm', '0').click();
  await key(page, 'leftUpperArm', '1').click({ modifiers: ['Control'] });
  await expect(keysButton(page)).toBeEnabled();
  await keysButton(page).click();
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: rightUpperArm');
  await expect(page.locator('.timeline-keyframe[aria-pressed="true"]')).toHaveCount(2);
  await expect(key(page, 'rightUpperArm', '0')).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page, 'rightUpperArm', '1')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#animation-redo').click();
  const waiting = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const path = await (await waiting).path();
  if (!path) throw new Error('Missing exported animation.');
  const exported = animationFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  expect(exported.tracks.leftUpperArm).toEqual([
    { time: 0, rotation: -0.8 },
    { time: 1000, rotation: 0.4 },
  ]);
  expect(exported.tracks.rightUpperArm).not.toEqual([
    { time: 0, rotation: 0.6 },
    { time: 1000, rotation: -0.3 },
  ]);
  expect(exported.interpolation).toBe('linear');
  expect(exported).not.toHaveProperty('pairs');
});
