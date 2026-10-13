import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationMenuControl, toggleAnimationToolPanel, test } from './fixtures.js';

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
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK', { timeout: 15000 });
  await page.locator('#animation-show-bones').uncheck();
  await toggleAnimationToolPanel(page, 'mirror');
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
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK', { timeout: 15000 });
  await toggleAnimationToolPanel(page, 'mirror');
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
  await toggleAnimationToolPanel(page, 'mirror');
  await page.locator('#animation-onion-skinning').check();
  const canvas = page.locator('#animation-stage canvas');
  const closedPanel = await canvas.screenshot();
  await toggleAnimationToolPanel(page, 'mirror');
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
  await toggleAnimationToolPanel(page, 'mirror');
  await expect.poll(async () => (await canvas.screenshot()).equals(closedPanel)).toBe(true);
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', clock!);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('current pose and selected keys refresh inspector and timeline with one Undo/Redo and unchanged sources', async ({
  page,
}) => {
  await openEditor(page);
  await toggleAnimationToolPanel(page, 'mirror');
  await page.locator('#animation-bones').getByRole('button', { name: 'leftUpperArm', exact: true }).click();
  await toggleAnimationToolPanel(page, 'mirror');
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

test('mirrored commits refresh temporal ghosts and export identical authored values with IK and facing toggles', async ({
  page,
}) => {
  await openEditor(page);
  await toggleAnimationToolPanel(page, 'mirror');
  await page.getByRole('button', { name: 'Expand leftUpperArm properties', exact: true }).click();
  await key(page, 'leftUpperArm', '0').click();
  await key(page, 'leftUpperArm', '1').click({ modifiers: ['Control'] });
  const ruler = page.locator('#timeline-ruler');
  const bounds = await ruler.boundingBox();
  if (!bounds) throw new Error('Missing timeline bounds.');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 18);
  // A stationary ruler click clears key selection; select the source group at the held playhead.
  await key(page, 'leftUpperArm', '0').click();
  await key(page, 'leftUpperArm', '1').click({ modifiers: ['Control'] });
  await page.locator('#animation-onion-skinning').check();
  const canvas = page.locator('#animation-stage canvas');
  const originalGhosts = await canvas.screenshot();
  await toggleAnimationToolPanel(page, 'mirror');
  for (let index = 0; index < 3; ++index) {
    await panel(page).getByRole('button', { name: 'Preview Mirrored Pose', exact: true }).click();
    await page.locator('#animation-onion-skinning').uncheck();
    await page.locator('#animation-onion-skinning').check();
    await panel(page).getByRole('button', { name: 'Hide Mirrored Preview', exact: true }).click();
  }
  await toggleAnimationToolPanel(page, 'mirror');
  await expect.poll(async () => (await canvas.screenshot()).equals(originalGhosts)).toBe(true);
  await toggleAnimationToolPanel(page, 'mirror');
  await keysButton(page).click();
  await toggleAnimationToolPanel(page, 'mirror');
  await expect.poll(async () => (await canvas.screenshot()).equals(originalGhosts)).toBe(false);
  await canvas.screenshot({ path: test.info().outputPath('mirror-committed-onion-skins.png') });
  const download = async () => {
    const waiting = page.waitForEvent('download');
    await page.locator('#animation-download').click();
    const path = await (await waiting).path();
    if (!path) throw new Error('Missing exported animation.');
    return animationFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  };
  const withoutIK = await download();
  await page.locator('#animation-undo').click();
  await (await animationMenuControl(page, '#animation-ik-preview')).check();
  await page.locator('#animation-facing').selectOption('left');
  await key(page, 'leftUpperArm', '0').click();
  await key(page, 'leftUpperArm', '1').click({ modifiers: ['Control'] });
  await toggleAnimationToolPanel(page, 'mirror');
  await keysButton(page).click();
  await toggleAnimationToolPanel(page, 'mirror');
  expect(await download()).toEqual(withoutIK);
});

test('repeated animation/character/route changes release previews and restore valid rig pairs', async ({ page }) => {
  await openEditor(page);
  for (const animation of ['walk', 'idle', 'walk', 'idle']) {
    await panel(page).getByRole('button', { name: 'Preview Mirrored Pose', exact: true }).click();
    await page.locator('#animation-selection').selectOption(animation);
    await panel(page).getByRole('button', { name: 'Hide Mirrored Preview', exact: true }).click();
    await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  }
  await panel(page).getByRole('button', { name: 'Preview Mirrored Pose', exact: true }).click();
  await page.locator('#character-selection').selectOption('random-paperdoll-sketch');
  await expect(page.locator('#character-status')).toHaveText('Character: random-paperdoll-sketch', { timeout: 15000 });
  await toggleAnimationToolPanel(page, 'mirror');
  await expect(poseButton(page)).toBeEnabled();
  await expect(panel(page).getByRole('button', { name: 'Preview Mirrored Pose', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await panel(page).getByRole('button', { name: 'Preview Mirrored Pose', exact: true }).click();
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(page.locator('#validation')).toHaveText('Validation: OK', { timeout: 15000 });
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK', { timeout: 15000 });
  await toggleAnimationToolPanel(page, 'mirror');
  await expect(panel(page).getByRole('button', { name: 'Preview Mirrored Pose', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#timeline-ruler').focus();
  await page.keyboard.press('m');
  await expect(panel(page).getByRole('button', { name: 'Hide Mirrored Preview', exact: true })).toBeVisible();
  await page.keyboard.press('m');
  await expect(panel(page).getByRole('button', { name: 'Preview Mirrored Pose', exact: true })).toBeVisible();
});
