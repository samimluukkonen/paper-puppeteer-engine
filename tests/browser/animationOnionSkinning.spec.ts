import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationControl, animationFileAction, test } from './fixtures.js';

test('onion skins render through scrubbing, facing, playback and boundaries without blocking editing or dirtying', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('walk');
  await page.locator('#animation-show-bones').uncheck();
  const ruler = page.getByRole('slider', { name: 'Animation time' });
  const canvas = page.locator('#animation-stage canvas');
  const toggle = page.getByRole('checkbox', { name: 'Onion Skinning', exact: true });
  const box = await ruler.boundingBox();
  if (!box) throw new Error('Missing timeline bounds.');
  await page.mouse.click(box.x + box.width * 0.35, box.y + 18);
  const normal = await canvas.screenshot();
  await toggle.check();
  await expect.poll(async () => (await canvas.screenshot()).equals(normal)).toBe(false);
  await canvas.screenshot({ path: test.info().outputPath('onion-right.png') });
  await toggle.uncheck();
  await expect.poll(async () => (await canvas.screenshot()).equals(normal)).toBe(true);
  await toggle.check();
  await page.locator('#animation-facing').selectOption('left');
  await canvas.screenshot({ path: test.info().outputPath('onion-left.png') });
  const mirrored = await canvas.screenshot();
  expect(mirrored.equals(normal)).toBe(false);
  await page.mouse.click(box.x + box.width * 0.7, box.y + 18);
  await expect.poll(async () => (await canvas.screenshot()).equals(mirrored)).toBe(false);
  await page.locator('#animation-show-bones').check();
  await page
    .locator('#animation-bones button')
    .filter({ hasText: /^head$/ })
    .click();
  await expect(page.locator('#animation-bone-title')).toContainText('head');
  await ruler.focus();
  await ruler.press('Home');
  await expect(ruler).toHaveAttribute('aria-valuenow', '0');
  await canvas.screenshot({ path: test.info().outputPath('onion-start.png') });
  await ruler.press('End');
  expect(Number(await ruler.getAttribute('aria-valuenow'))).toBe(Number(await ruler.getAttribute('aria-valuemax')));
  await canvas.screenshot({ path: test.info().outputPath('onion-end.png') });
  await page.locator('#reset-time').click();
  await page.locator('#play-pause').click();
  await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).toBeGreaterThan(0.05);
  await page.locator('#play-pause').click();
  await toggle.uncheck();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-selection').selectOption('idle');
  await toggle.check();
  await toggle.uncheck();
});

test('artist controls render multiple directions, spacing, opacity and tint while preserving clean authored state', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 4000,
        playback: { mode: 'smooth' },
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 4000, x: 300 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-show-bones').uncheck();
  const ruler = page.locator('#timeline-ruler');
  const bounds = await ruler.boundingBox();
  if (!bounds) throw new Error('Missing timeline bounds.');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 18);
  const clock = await ruler.getAttribute('aria-valuenow');
  const canvas = page.locator('#animation-stage canvas');
  const normal = await canvas.screenshot();
  await page.locator('#animation-onion-skinning').check();
  const oneEach = await canvas.screenshot();
  expect(oneEach.equals(normal)).toBe(false);
  const panel = page.locator('.animation-onion-settings');
  const setNumber = async (name: string, value: string) => {
    await panel.locator('summary').click();
    await page.locator(`#animation-onion-${name}`).fill(value);
    await panel.locator('summary').click();
  };
  await setNumber('previous-count', '3');
  await setNumber('next-count', '3');
  const six = await canvas.screenshot({ path: test.info().outputPath('onion-six.png') });
  expect(six.equals(oneEach)).toBe(false);
  await setNumber('next-count', '0');
  const previousOnly = await canvas.screenshot();
  expect(previousOnly.equals(six)).toBe(false);
  await setNumber('previous-count', '0');
  await expect.poll(async () => (await canvas.screenshot()).equals(normal)).toBe(true);
  await setNumber('next-count', '3');
  const nextOnly = await canvas.screenshot();
  expect(nextOnly.equals(previousOnly)).toBe(false);
  await setNumber('previous-count', '3');
  for (const spacing of ['1', '2', '5']) {
    await setNumber('spacing', spacing);
    await canvas.screenshot({ path: test.info().outputPath(`onion-spacing-${spacing}.png`) });
  }
  await panel.locator('summary').click();
  await page.locator('#animation-onion-previous-opacity').press('Home');
  await page.locator('#animation-onion-next-opacity').press('End');
  await expect(page.locator('#animation-onion-previous-opacity')).toHaveValue('0.05');
  await expect(page.locator('#animation-onion-next-opacity')).toHaveValue('0.6');
  for (const [direction, color] of [
    ['previous', '#b366ff'],
    ['next', '#55cc88'],
  ] as const) {
    await page.locator(`#animation-onion-${direction}-color`).evaluate((element, value) => {
      (element as HTMLInputElement).value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, color);
  }
  await panel.locator('summary').click();
  await canvas.screenshot({ path: test.info().outputPath('onion-custom-style.png') });
  await expect(ruler).toHaveAttribute('aria-valuenow', clock!);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#reset-time').click();
  await page.locator('#play-pause').click();
  await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).toBeGreaterThan(0.1);
  await page.locator('#play-pause').click();
  await (await animationControl(page, '#animation-mode')).selectOption('stepped');
  const fps = await animationControl(page, '#animation-fps');
  await fps.fill('12');
  await fps.press('Tab');
  await (await animationControl(page, '#animation-interpolation')).selectOption('linear');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 18);
  await canvas.screenshot({ path: test.info().outputPath('onion-authored-fps.png') });
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).click();
  await page.locator('#timeline').press('ArrowRight');
  const firstKey = page
    .locator('.timeline-track-lane[data-bone-id="root"][data-property="x"] .timeline-keyframe')
    .first();
  await expect.poll(async () => Number(await firstKey.getAttribute('data-time'))).toBeGreaterThan(0);
  await canvas.screenshot({ path: test.info().outputPath('onion-key-edit.png') });
  await page.locator('#animation-undo').click();
  await expect(firstKey).toHaveAttribute('data-time', '0');
  await page.locator('#animation-redo').click();
  await expect.poll(async () => Number(await firstKey.getAttribute('data-time'))).toBeGreaterThan(0);
  for (let edit = 0; edit < 4; ++edit) await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-onion-skinning')).toBeChecked();
  await page.locator('#animation-selection').selectOption('walk');
  await panel.locator('summary').click();
  await expect(page.locator('#animation-onion-previous-count')).toHaveValue('3');
  await expect(page.locator('#animation-onion-spacing')).toHaveValue('5');
  await page.setViewportSize({ width: 620, height: 1400 });
  await expect(page.getByLabel('Next color', { exact: true })).toBeInViewport();
  await page.locator('.animation-preview').screenshot({ path: test.info().outputPath('onion-controls-mobile.png') });
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('six ghosts survive JSON round trips and IK preview; route changes keep onion controls exclusive to animation', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('walk');
  const downloadJson = async () => {
    const waiting = page.waitForEvent('download');
    await (await animationControl(page, '#animation-download')).click();
    const path = await (await waiting).path();
    if (!path) throw new Error('Missing animation download.');
    return readFile(path, 'utf8');
  };
  const original = await downloadJson();
  await page.locator('#animation-onion-skinning').check();
  const panel = page.locator('.animation-onion-settings');
  await panel.locator('summary').click();
  await expect(panel).toContainText('Ghosts show authored poses before IK preview');
  await page.locator('#animation-onion-previous-count').fill('3');
  await page.locator('#animation-onion-next-count').fill('3');
  await panel.locator('summary').click();
  const ruler = page.getByRole('slider', { name: 'Animation time' });
  await ruler.focus();
  await ruler.press('ArrowRight');
  const time = await ruler.getAttribute('aria-valuenow');
  await page.locator('#animation-ik-preview').check();
  await expect(ruler).toHaveAttribute('aria-valuenow', time!);
  expect(await downloadJson()).toBe(original);
  await animationFileAction(page, '#animation-import-paste', (control) => control.click());
  await animationFileAction(page, '#animation-import-text', (control) => control.fill(original));
  await animationFileAction(page, '#animation-import-submit', (control) => control.click());
  await expect(ruler).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#animation-onion-skinning')).toBeChecked();
  expect(await downloadJson()).toBe(original);
  await page.locator('#animation-ik-preview').uncheck();
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await expect(page.locator('#animation-onion-skinning')).toHaveCount(0);
  await page.goto('animation-editor/?character=random-paperdoll-sketch');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(page.locator('#animation-onion-skinning')).not.toBeChecked();
  await page.locator('#animation-onion-skinning').check();
  await page.locator('#animation-onion-skinning').uncheck();
});
