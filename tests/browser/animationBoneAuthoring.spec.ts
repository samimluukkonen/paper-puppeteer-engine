import { expect, type Page } from '@playwright/test';
import { animationHierarchy, animationMenuControl, animationControl, test, inspectorControl } from './fixtures.js';

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

/** Use the rendered selection ring so preview picking survives panel/camera size changes. */
async function selectedBonePoint(page: Page): Promise<{ x: number; y: number }> {
  const canvas = page.locator('#animation-stage canvas');
  const screenshot = await canvas.screenshot();
  const point = await page.evaluate(
    async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let x = 0,
        y = 0,
        count = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (
          Math.abs(data[index]! - 183) <= 2 &&
          Math.abs(data[index + 1]! - 84) <= 2 &&
          Math.abs(data[index + 2]! - 58) <= 2
        ) {
          const pixel = index / 4;
          x += pixel % bitmap.width;
          y += Math.floor(pixel / bitmap.width);
          count++;
        }
      }
      return count ? { x: x / count, y: y / count, width: bitmap.width, height: bitmap.height } : null;
    },
    `data:image/png;base64,${screenshot.toString('base64')}`,
  );
  if (!point) throw new Error('Selected bone ring was not rendered.');
  const bounds = (await canvas.boundingBox())!;
  return {
    x: bounds.x + (point.x * bounds.width) / point.width,
    y: bounds.y + (point.y * bounds.height) / point.height,
  };
}

test('bone hierarchy keyboard navigation keeps one tab stop without authoring or seeking', async ({ page }) => {
  await openEditor(page);
  await time(page, 0.5);
  const hierarchy = await animationHierarchy(page);
  const root = hierarchy.getByRole('button', { name: 'root', exact: true });
  const pelvis = hierarchy.getByRole('button', { name: 'pelvis', exact: true });
  const torso = hierarchy.getByRole('button', { name: 'torso', exact: true });
  const head = hierarchy.getByRole('button', { name: 'head', exact: true });
  await expect(hierarchy.locator('[tabindex="0"]')).toHaveCount(1);
  await root.click();
  await root.press('ArrowDown');
  await expect(pelvis).toBeFocused();
  await pelvis.press('ArrowRight');
  await expect(torso).toBeFocused();
  await torso.press('ArrowRight');
  await expect(head).toBeFocused();
  await head.press('ArrowLeft');
  await expect(torso).toBeFocused();
  await torso.press('ArrowDown');
  await expect(head).toBeFocused();
  await head.press('ArrowUp');
  await expect(torso).toBeFocused();
  await torso.press('Home');
  await expect(root).toBeFocused();
  await root.press('End');
  const last = hierarchy.getByRole('button').last();
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  await expect(hierarchy.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0.5');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('three-key authoring, exact history, interpolation, parent-local editing and playback', async ({ page }) => {
  await openEditor(page);
  const selectBone = async (bone: string) => {
    await (await animationHierarchy(page)).getByRole('button', { name: bone, exact: true }).click();
    await inspectorControl(page, '#animation-bone-inspector');
  };
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
  await page.getByLabel('Rotation (°) key actions', { exact: true }).click();
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
  await (await animationControl(page, '#animation-mode')).selectOption('stepped');
  await expect(input(page, 'rotation')).toHaveValue('6');
  for (const fps of ['12', '15', '20']) await (await animationControl(page, '#animation-fps')).fill(fps);
  await (await animationControl(page, '#animation-fps')).press('Tab');
  await page.locator('#animation-undo').click();
  await expect(await animationControl(page, '#animation-fps')).toHaveValue('10');
  await page.locator('#animation-undo').click();
  await expect(await animationControl(page, '#animation-mode')).toHaveValue('smooth');
  await expect(input(page, 'rotation')).toHaveValue('12.5');
  await page.locator('#preview-loop').click();
  await page.locator('#playback-speed').selectOption('2');
  await page.locator('#reset-time').click();
  await page.locator('#play-pause').click();
  await expect
    .poll(async () => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow')))
    .toBeGreaterThan(0);
  await page.waitForTimeout(1100);
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  await page.locator('#play-pause').click();
  await time(page, 0.5);
  await expect(input(page, 'rotation')).toHaveValue('45');
  await page.locator('#animation-facing').selectOption('left');
  await (await animationMenuControl(page, '#animation-ik-preview')).check();
  await expect(input(page, 'rotation')).toHaveValue('45');
  await page.locator('#animation-facing').selectOption('right');
  await (await animationMenuControl(page, '#animation-ik-preview')).uncheck();
  await expect(input(page, 'rotation')).toHaveValue('45');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.screenshot({ path: test.info().outputPath('history-authoring.png'), fullPage: true });
});

test('drafts cancel at held endpoints and empty history; shortcuts respect typing and composition', async ({
  page,
}) => {
  await openEditor(page);
  await (await animationHierarchy(page)).getByRole('button', { name: 'rightForearm', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
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

test('dirty animation switching retains per-clip history and clears temporary transforms', async ({ page }) => {
  await openEditor(page);
  await (await animationHierarchy(page)).getByRole('button', { name: 'rightForearm', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
  await time(page, 0.5);
  await input(page, 'rotation').fill('35');
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('#animation-selection')).toHaveValue('walk');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-selection').selectOption('idle');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
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
  await expect(page.locator('#animation-redo')).toBeEnabled();
  await page.locator('#animation-redo').click();
  await expect(input(page, 'rotation')).toHaveValue('35');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
});

test('demo bone hierarchy, temporary preview, sparse create/update/delete, and playback', async ({ page }) => {
  await openEditor(page);
  for (const bone of ['torso', 'rightUpperArm', 'rightForearm', 'rightHand']) {
    await (await animationHierarchy(page)).getByRole('button', { name: bone, exact: true }).click();
    await inspectorControl(page, '#animation-bone-inspector');
    await expect(page.locator('#animation-bone-title')).toHaveText(`Bone: ${bone}`);
  }
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await (await animationHierarchy(page)).getByRole('button', { name: 'torso', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
  const torsoPoint = await selectedBonePoint(page);
  await (await animationHierarchy(page)).getByRole('button', { name: 'rightHand', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
  await page.mouse.click(torsoPoint.x, torsoPoint.y);
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: torso');
  await time(page, 0.5);
  await (await animationHierarchy(page)).getByRole('button', { name: 'rightForearm', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
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
  await page.getByLabel('Rotation (°) key actions', { exact: true }).click();
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
    .poll(async () => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow')))
    .toBeGreaterThan(0.5);
  await input(page, 'rotation').focus();
  await expect(page.locator('#play-pause')).toHaveText('Play');
  const heldTime = await page.locator('#timeline-ruler').getAttribute('aria-valuenow');
  await input(page, 'rotation').fill('20');
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', heldTime!);
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await page.screenshot({ path: test.info().outputPath('bone-authoring.png'), fullPage: true });
});

test('draft cancel, navigation, invalid fields, and preview-only IK/facing', async ({ page }) => {
  await openEditor(page);
  await time(page, 0.5);
  await (await animationHierarchy(page)).getByRole('button', { name: 'rightForearm', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
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
  await (await animationHierarchy(page)).getByRole('button', { name: 'rightHand', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
  await expect(input(page, 'rotation')).toHaveAttribute('data-temporary', 'false');
  await input(page, 'rotation').fill('');
  await expect(page.getByRole('button', { name: 'Set Rotation (°) key', exact: true })).toBeDisabled();
  await page.locator('#animation-cancel-transform').click();
  await expect(input(page, 'rotation')).not.toHaveValue('');
  await page.locator('#animation-facing').selectOption('left');
  await (await animationMenuControl(page, '#animation-ik-preview')).check();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await time(page, 0.5);
  await (await animationHierarchy(page)).getByRole('button', { name: 'rightForearm', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
  await input(page, 'rotation').fill('35');
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await expect(input(page, 'rotation')).toHaveValue('35');
  await page.locator('#animation-facing').selectOption('right');
  await (await animationMenuControl(page, '#animation-ik-preview')).uncheck();
  await expect(input(page, 'rotation')).toHaveValue('35');
  await expect(keyed(page, 'rotation')).toHaveAttribute('data-keyed', 'true');
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.setViewportSize({ width: 600, height: 1000 });
  await page.locator('#animation-inspector-toggle').click();
  await expect(input(page, 'rotation')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('bone-authoring-mobile.png'), fullPage: true });
});
