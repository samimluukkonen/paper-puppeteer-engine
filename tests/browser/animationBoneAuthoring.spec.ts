import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';

async function openEditor(page: Page): Promise<void> {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
}

async function time(page: Page, seconds: number): Promise<void> {
  const timeline = page.locator('#timeline');
  await timeline.focus();
  await timeline.press('Home');
  for (let step = 0; step < Math.round(seconds * 10); step += 1) await timeline.press('Shift+ArrowRight');
}

const input = (page: Page, property: string) =>
  page.locator(`#animation-bone-fields input[data-property="${property}"]`);
const keyed = (page: Page, property: string) => page.locator(`[data-keyed-property="${property}"]`);

test('three-key authoring, exact history, interpolation, parent-local editing and playback', async ({ page }) => {
  await openEditor(page);
  const selectBone = (bone: string) =>
    page.locator('#animation-bones').getByRole('button', { name: bone, exact: true }).click();
  const setRotation = async (value: string) => {
    await input(page, 'rotation').fill(value);
    await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  };
  await selectBone('rightForearm');
  for (const [seconds, value] of [
    [0, '-20'],
    [0.5, '35'],
    [1, '-10'],
  ] as const) {
    await time(page, seconds);
    await setRotation(value);
    await expect(input(page, 'rotation')).toHaveValue(value);
  }
  await page.locator('#animation-undo').click();
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'false');
  await page.locator('#animation-redo').click();
  await expect(input(page, 'rotation')).toHaveValue('-10');
  await time(page, 0.5);
  // Many browser input events still produce a single authored update.
  for (const value of ['36', '40', '45']) await input(page, 'rotation').fill(value);
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await page.locator('#animation-undo').click();
  await expect(input(page, 'rotation')).toHaveValue('35');
  await page.locator('#animation-redo').click();
  await expect(input(page, 'rotation')).toHaveValue('45');
  await page.getByRole('button', { name: 'Delete Rotation (°) key', exact: true }).click();
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'false');
  await page.locator('#animation-undo').click();
  await expect(input(page, 'rotation')).toHaveValue('45');
  await page.locator('#animation-redo').click();
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'false');
  await page.locator('#animation-undo').click();
  await selectBone('rightUpperArm');
  await setRotation('60');
  await expect(page.locator('#animation-redo')).toBeDisabled();
  await selectBone('rightForearm');
  await expect(input(page, 'rotation')).toHaveValue('45');
  // Use five precise steps from 0.2 to inspect 0.25 s.
  await time(page, 0.2);
  for (let step = 0; step < 5; step += 1) await page.locator('#timeline').press('ArrowRight');
  await expect(input(page, 'rotation')).toHaveValue('12.5');
  await page.locator('#animation-mode').selectOption('stepped');
  await expect(input(page, 'rotation')).toHaveValue('6');
  for (const fps of ['12', '15', '20']) await page.locator('#animation-fps').fill(fps);
  await page.locator('#animation-fps').press('Tab');
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-fps')).toHaveValue('10');
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-mode')).toHaveValue('smooth');
  await expect(input(page, 'rotation')).toHaveValue('12.5');
  await page.locator('#preview-loop').click();
  await page.locator('#playback-speed').selectOption('2');
  await page.locator('#reset-time').click();
  await page.locator('#play-pause').click();
  await expect
    .poll(async () => Number(await page.locator('#timeline').getAttribute('aria-valuenow')))
    .toBeGreaterThan(0);
  await page.waitForTimeout(1100);
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  await page.locator('#play-pause').click();
  await time(page, 0.5);
  await expect(input(page, 'rotation')).toHaveValue('45');
  await page.locator('#animation-facing').selectOption('left');
  await page.locator('#animation-ik-preview').check();
  await expect(input(page, 'rotation')).toHaveValue('45');
  await page.locator('#animation-facing').selectOption('right');
  await page.locator('#animation-ik-preview').uncheck();
  await expect(input(page, 'rotation')).toHaveValue('45');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.screenshot({ path: test.info().outputPath('history-authoring.png'), fullPage: true });
});

test('drafts cancel at held endpoints and empty history; shortcuts respect typing and composition', async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('#animation-bones').getByRole('button', { name: 'rightForearm', exact: true }).click();
  const timeline = page.locator('#timeline');
  await timeline.focus();
  await timeline.press('End');
  const evaluated = await input(page, 'rotation').inputValue();
  await input(page, 'rotation').fill('99');
  await timeline.focus();
  await timeline.press('End');
  await expect(input(page, 'rotation')).toHaveValue(evaluated);
  await expect(input(page, 'rotation')).toHaveAttribute('data-temporary', 'false');
  await input(page, 'rotation').fill('99');
  await timeline.focus();
  await timeline.press('Control+z');
  await expect(input(page, 'rotation')).toHaveValue(evaluated);
  await input(page, 'rotation').fill('99');
  await timeline.focus();
  await timeline.press('Meta+Shift+z');
  await expect(input(page, 'rotation')).toHaveValue(evaluated);
  await time(page, 0.5);
  await input(page, 'rotation').fill('35');
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await input(page, 'rotation').focus();
  await input(page, 'rotation').dispatchEvent('keydown', { key: 'z', ctrlKey: true });
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'true');
  await timeline.focus();
  for (const extra of [{ altKey: true }, { isComposing: true }, { repeat: true }])
    await timeline.dispatchEvent('keydown', { key: 'z', ctrlKey: true, ...extra });
  await timeline.evaluate((element) => {
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    event.preventDefault();
    element.dispatchEvent(event);
  });
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'true');
  await timeline.press('Meta+z');
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'false');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await timeline.press('Control+Shift+z');
  await expect(input(page, 'rotation')).toHaveValue('35');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
});

test('dirty animation switching preserves authored history and new sessions start clean', async ({ page }) => {
  await openEditor(page);
  await page.locator('#animation-bones').getByRole('button', { name: 'rightForearm', exact: true }).click();
  await time(page, 0.5);
  await input(page, 'rotation').fill('35');
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-status')).toContainText('Unsaved animation changes');
  await expect(input(page, 'rotation')).toHaveValue('35');
  await page.locator('#animation-undo').click();
  await input(page, 'rotation').fill('99');
  await page.locator('#animation-selection').selectOption('walk');
  await expect(input(page, 'rotation')).toHaveAttribute('data-temporary', 'false');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-redo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-selection').selectOption('idle');
  await time(page, 0.5);
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'false');
  await expect(input(page, 'rotation')).not.toHaveValue('99');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
});

test('demo bone hierarchy, temporary preview, sparse create/update/delete, and playback', async ({ page }) => {
  await openEditor(page);
  for (const bone of ['torso', 'rightUpperArm', 'rightForearm', 'rightHand']) {
    await page.locator('#animation-bones').getByRole('button', { name: bone, exact: true }).click();
    await expect(page.locator('#animation-bone-title')).toHaveText(`Bone: ${bone}`);
  }
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  const previewBounds = await page.locator('#animation-stage canvas').boundingBox();
  if (!previewBounds) throw new Error('Missing puppet preview.');
  await page.locator('#animation-stage canvas').click({
    position: { x: previewBounds.width / 2, y: (previewBounds.height * 435) / 640 },
  });
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: root');
  await time(page, 0.5);
  await page.locator('#animation-bones').getByRole('button', { name: 'rightForearm', exact: true }).click();
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'false');
  const canvas = page.locator('#animation-stage canvas');
  const before = await canvas.screenshot();
  await input(page, 'rotation').fill('35');
  await expect(input(page, 'rotation')).toHaveAttribute('data-temporary', 'true');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'true');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  for (const property of ['x', 'y', 'scaleX', 'scaleY'])
    await expect(keyed(page, property)).toHaveAttribute('data-keyed', 'false');
  await time(page, 0.8);
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'false');
  await time(page, 0.5);
  await expect(input(page, 'rotation')).toHaveValue('35');
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'true');
  await input(page, 'rotation').fill('45');
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await expect(input(page, 'rotation')).toHaveValue('45');
  await input(page, 'x').fill('12');
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  await input(page, 'y').fill('65');
  await page.getByRole('button', { name: 'Set Y key', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Rotation (°) key', exact: true }).click();
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'false');
  await expect(input(page, 'rotation')).not.toHaveValue('45');
  await expect(keyed(page, 'x')).toHaveAttribute('data-keyed', 'true');
  await expect(keyed(page, 'y')).toHaveAttribute('data-keyed', 'true');
  await page.locator('#animation-undo').click();
  await expect(input(page, 'rotation')).toHaveValue('45');
  await time(page, 1);
  await input(page, 'rotation').fill('10');
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await time(page, 0.5);
  await page.locator('#play-pause').click();
  await expect
    .poll(async () => Number(await page.locator('#timeline').getAttribute('aria-valuenow')))
    .toBeGreaterThan(0.5);
  await input(page, 'rotation').focus();
  await expect(page.locator('#play-pause')).toHaveText('Play');
  const heldTime = await page.locator('#timeline').getAttribute('aria-valuenow');
  await input(page, 'rotation').fill('20');
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await expect(page.locator('#timeline')).toHaveAttribute('aria-valuenow', heldTime!);
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await page.screenshot({ path: test.info().outputPath('bone-authoring.png'), fullPage: true });
});

test('draft cancel, navigation, invalid fields, and preview-only IK/facing', async ({ page }) => {
  await openEditor(page);
  await time(page, 0.5);
  await page.locator('#animation-bones').getByRole('button', { name: 'rightForearm', exact: true }).click();
  const evaluated = await input(page, 'rotation').inputValue();
  await input(page, 'rotation').fill('35');
  await page.locator('#animation-cancel-transform').click();
  await expect(input(page, 'rotation')).toHaveValue(evaluated);
  await input(page, 'rotation').fill('35');
  await input(page, 'rotation').press('Escape');
  await expect(input(page, 'rotation')).toHaveValue(evaluated);
  await input(page, 'rotation').fill('35');
  await time(page, 0.8);
  await expect(input(page, 'rotation')).toHaveAttribute('data-temporary', 'false');
  await input(page, 'rotation').fill('35');
  await page.locator('#animation-bones').getByRole('button', { name: 'rightHand', exact: true }).click();
  await expect(input(page, 'rotation')).toHaveAttribute('data-temporary', 'false');
  await input(page, 'rotation').fill('');
  await expect(page.getByRole('button', { name: 'Set Rotation (°) key', exact: true })).toBeDisabled();
  await page.locator('#animation-cancel-transform').click();
  await expect(input(page, 'rotation')).not.toHaveValue('');
  await page.locator('#animation-facing').selectOption('left');
  await page.locator('#animation-ik-preview').check();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await time(page, 0.5);
  await page.locator('#animation-bones').getByRole('button', { name: 'rightForearm', exact: true }).click();
  await input(page, 'rotation').fill('35');
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await expect(input(page, 'rotation')).toHaveValue('35');
  await page.locator('#animation-facing').selectOption('right');
  await page.locator('#animation-ik-preview').uncheck();
  await expect(input(page, 'rotation')).toHaveValue('35');
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'true');
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.setViewportSize({ width: 600, height: 1000 });
  await expect(input(page, 'rotation')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('bone-authoring-mobile.png'), fullPage: true });
});
