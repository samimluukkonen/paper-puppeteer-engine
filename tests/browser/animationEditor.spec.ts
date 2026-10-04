import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';

async function openEditor(page: Page): Promise<void> {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(page.locator('#animation-stage canvas')).toBeVisible();
}

test('editor routes and the demo remain linked under the deployment base', async ({ page, baseURL }) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page).toHaveURL(new URL('animation-editor/', baseURL!).href);
  await expect(page.locator('#character-status')).toHaveText('Character: demo-puppet');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('treeitem', { name: 'head', exact: true }).click();
  const x = page.locator('#inspector input[data-scope="bone"][data-field="x"]');
  await x.fill('12');
  await x.press('Tab');
  await page.locator('#undo').click();
  await expect(x).toHaveValue('0');
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await page.getByRole('link', { name: 'Engine demo' }).click();
  await expect(page.locator('#status-text')).toContainText('Current: idle');
});

test('ruler, current time, selection and scrubbed artwork update without dirtying', async ({ page }) => {
  await openEditor(page);
  await page.screenshot({ path: test.info().outputPath('animation-editor-desktop.png'), fullPage: true });
  const timeline = page.getByRole('slider', { name: 'Animation time' });
  await expect(page.locator('#current-time')).toHaveText('0.000 / 1.800 s');
  await expect(page.locator('.timeline-tick.major').first()).toBeVisible();
  await expect(page.locator('#timeline-playhead')).toBeVisible();
  await page.locator('#animation-selection').selectOption('walk');
  const duration = Number(await timeline.getAttribute('aria-valuemax'));
  const canvas = page.locator('#animation-stage canvas');
  const start = await canvas.screenshot();
  const box = await timeline.boundingBox();
  if (!box) throw new Error('Missing timeline bounds.');
  for (const fraction of [0.01, 0.5, 0.99]) {
    await page.mouse.click(box.x + box.width * fraction, box.y + 50);
    expect(Number(await timeline.getAttribute('aria-valuenow'))).toBeCloseTo(duration * fraction, 2);
  }
  await page.mouse.click(box.x + box.width * 0.25, box.y + 50);
  await expect.poll(async () => (await canvas.screenshot()).equals(start)).toBe(false);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#reset-time').click();
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
  await page.locator('#animation-selection').selectOption('idle');
  await expect(page.locator('#current-time')).toHaveText('0.000 / 1.800 s');
});

test('captured pointer scrubs outside both edges, release ends drag, keyboard and resize preserve time', async ({
  page,
}) => {
  await openEditor(page);
  const timeline = page.getByRole('slider', { name: 'Animation time' });
  const box = await timeline.boundingBox();
  if (!box) throw new Error('Missing timeline bounds.');
  await page.mouse.move(box.x + box.width / 2, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x - 15, box.y + 150, { steps: 4 });
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
  await page.mouse.move(box.x + box.width + 15, box.y + 150, { steps: 8 });
  await expect(timeline).toHaveAttribute('aria-valuenow', '1.8');
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, box.y + 50);
  await expect(timeline).toHaveAttribute('aria-valuenow', '1.8');
  await timeline.press('Home');
  await timeline.press('ArrowRight');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0.01');
  await timeline.press('End');
  await page.setViewportSize({ width: 620, height: 1100 });
  await expect(timeline).toHaveAttribute('aria-valuenow', '1.8');
  const resized = await timeline.boundingBox();
  if (!resized) throw new Error('Missing resized timeline.');
  const playhead = await page.locator('#timeline-playhead').boundingBox();
  expect(playhead!.x).toBeCloseTo(resized.x + resized.width, 0);
  await page.screenshot({ path: test.info().outputPath('animation-editor-narrow.png'), fullPage: true });
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('no animations and no selection show safe empty timelines', async ({ page }) => {
  await openEditor(page);
  await page.locator('#animation-selection').selectOption('');
  await expect(page.locator('#animation-status')).toHaveText('No animation selected.');
  await expect(page.locator('#current-time')).toHaveText('0.000 / 0.000 s');
  await page.route('**/characters/demo-puppet/character.json', async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    await route.fulfill({ json: { ...manifest, animations: [] } });
  });
  await page.reload();
  await expect(page.locator('#animation-status')).toHaveText('This character has no animations.');
  await expect(page.locator('#animation-stage canvas')).toBeVisible();
  await expect(page.locator('#animation-selection')).toBeDisabled();
  await expect(page.locator('#timeline')).toHaveAttribute('aria-disabled', 'true');
});

test('invalid zero-duration data reports shared validation errors and survives resize', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    const animation = await response.json();
    await route.fulfill({ json: { ...animation, duration: 0 } });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toContainText('Animation duration must be greater than zero');
  await page.setViewportSize({ width: 620, height: 1100 });
  await expect(page.locator('#animation-status')).toContainText('Animation duration must be greater than zero');
  await expect(page.locator('#timeline')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#timeline')).toHaveAttribute('aria-disabled', 'true');
});

test('stepped animation metadata and held preview frames use the existing runtime mode', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    const animation = await response.json();
    await route.fulfill({ json: { ...animation, playback: { mode: 'stepped', fps: 10 } } });
  });
  await openEditor(page);
  await expect(page.locator('#animation-metadata')).toContainText('Mode: stepped · FPS: 10');
  const timeline = page.locator('#timeline');
  const canvas = page.locator('#animation-stage canvas');
  await timeline.press('Home');
  await timeline.press('ArrowRight');
  const frame = await canvas.screenshot();
  await timeline.press('ArrowRight');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0.02');
  expect((await canvas.screenshot()).equals(frame)).toBe(true);
});

test('play, pause, resume, restart, and completion synchronize the preview and timeline', async ({ page }) => {
  // Different endpoint poses make holding the final frame observable, including for authored loop=true.
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    const animation = await response.json();
    await route.fulfill({
      json: {
        ...animation,
        duration: 2050,
        loop: true,
        playback: { mode: 'stepped', fps: 10 },
        events: [],
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 2050, x: 100 },
          ],
        },
      },
    });
  });
  await openEditor(page);
  const timeline = page.locator('#timeline');
  const playPause = page.locator('#play-pause');
  const restart = page.getByRole('button', { name: 'Restart', exact: true });
  const canvas = page.locator('#animation-stage canvas');
  const time = async () => Number(await timeline.getAttribute('aria-valuenow'));
  const initial = await canvas.screenshot();
  await playPause.click();
  await expect(playPause).toHaveText('Pause');
  await expect.poll(time).toBeGreaterThan(0.2);
  await playPause.click();
  await expect(playPause).toHaveText('Play');
  const pausedTime = await time();
  const pausedPose = await canvas.screenshot();
  expect(pausedPose.equals(initial)).toBe(false);
  await expect(page.locator('#current-time')).toHaveText(`${pausedTime.toFixed(3)} / 2.050 s`);
  const bounds = await timeline.boundingBox();
  const playhead = await page.locator('#timeline-playhead').boundingBox();
  expect(playhead!.x).toBeCloseTo(bounds!.x + (pausedTime / 2.05) * bounds!.width, 0);
  await page.waitForTimeout(150);
  expect(await time()).toBe(pausedTime);
  expect((await canvas.screenshot()).equals(pausedPose)).toBe(true);
  await playPause.click();
  await expect.poll(time).toBeGreaterThan(pausedTime);
  await restart.click();
  await expect(playPause).toHaveText('Pause');
  await expect.poll(time).toBeLessThan(pausedTime);
  await playPause.click();
  await restart.click();
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
  await expect(playPause).toHaveText('Play');
  expect((await canvas.screenshot()).equals(initial)).toBe(true);
  await timeline.press('End');
  const finalPose = await canvas.screenshot();
  expect(finalPose.equals(initial)).toBe(false);
  await timeline.press('ArrowLeft');
  await playPause.click();
  await expect(playPause).toHaveText('Play');
  await expect(timeline).toHaveAttribute('aria-valuenow', '2.05');
  await page.waitForTimeout(150);
  expect((await canvas.screenshot()).equals(finalPose)).toBe(true);
  await playPause.click();
  await expect(playPause).toHaveText('Pause');
  await expect.poll(time).toBeLessThan(1);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-selection').selectOption('walk');
  await expect(playPause).toHaveText('Play');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
  await page.screenshot({ path: test.info().outputPath('animation-playback-controls.png'), fullPage: true });
});

test('Space toggles playback once and leaves typing targets alone', async ({ page }) => {
  await openEditor(page);
  const playPause = page.locator('#play-pause');
  const timeline = page.locator('#timeline');
  await timeline.focus();
  await page.keyboard.down('Space');
  await expect(playPause).toHaveText('Pause');
  await page.keyboard.down('Space');
  await expect(playPause).toHaveText('Pause');
  await page.keyboard.up('Space');
  await page.keyboard.press('Space');
  await expect(playPause).toHaveText('Play');
  // Space on a focused button must not also generate a native click that toggles a second time.
  await playPause.focus();
  await page.keyboard.press('Space');
  await expect(playPause).toHaveText('Pause');
  await page.keyboard.press('Space');
  await expect(playPause).toHaveText('Play');
  await page.locator('#animation-selection').focus();
  await page.locator('#animation-selection').dispatchEvent('keydown', { code: 'Space', key: ' ', bubbles: true });
  await expect(playPause).toHaveText('Play');
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'typing-targets';
    host.innerHTML = '<input><textarea></textarea><div contenteditable="true"><span>Editable</span></div>';
    document.body.append(host);
  });
  for (const selector of ['input', 'textarea', '[contenteditable] span']) {
    const target = page.locator(`#typing-targets ${selector}`);
    await target.click();
    await page.keyboard.press('Space');
    await expect(playPause).toHaveText('Play');
  }
  await page.locator('#typing-targets').evaluate((element) => element.remove());
  await page.locator('#animation-selection').selectOption('');
  await expect(playPause).toBeDisabled();
  await expect(page.locator('#reset-time')).toBeDisabled();
  await timeline.press('Space');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
});
