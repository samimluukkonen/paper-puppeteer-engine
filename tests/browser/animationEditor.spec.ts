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
  for (const selector of ['#playback-speed', '#animation-mode', '#animation-fps', '#animation-undo', '#animation-redo'])
    await expect(page.locator(selector)).toBeDisabled();
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

test('preview speeds scale browser playback while remaining transient across selection', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), duration: 60_000 } });
  });
  await openEditor(page);
  await expect(page.locator('#playback-speed')).toHaveValue('1');
  for (const speed of [0.5, 1, 2]) {
    await page.locator('#playback-speed').selectOption(String(speed));
    await page.locator('#play-pause').click();
    const measured = await page.locator('#timeline').evaluate(async (element) => {
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await frame();
      const start = performance.now();
      const initial = Number(element.getAttribute('aria-valuenow'));
      while (performance.now() - start < 350) await frame();
      return (Number(element.getAttribute('aria-valuenow')) - initial) / ((performance.now() - start) / 1000);
    });
    expect(measured).toBeGreaterThan(speed * 0.75);
    expect(measured).toBeLessThan(speed * 1.25);
    await page.locator('#play-pause').click();
    await expect(page.locator('#animation-metadata')).toContainText(`Speed: ${speed}×`);
    await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
    await expect(page.locator('#animation-undo')).toBeDisabled();
  }
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('#playback-speed')).toHaveValue('2');
  await expect(page.locator('#play-pause')).toHaveText('Play');
});

test('authored mode and FPS update the paused pose immediately and undo restores settings', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...(await response.json()),
        duration: 2000,
        events: [],
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 2000, x: 200 },
          ],
        },
      },
    });
  });
  await openEditor(page);
  await expect(page.locator('#animation-mode')).toHaveValue('smooth');
  await expect(page.locator('#animation-fps')).toBeDisabled();
  await page.locator('#animation-mode').selectOption('stepped');
  await expect(page.locator('#animation-fps')).toHaveValue('10');
  const timeline = page.locator('#timeline');
  for (let step = 0; step < 15; step += 1) await timeline.press('ArrowRight');
  const canvas = page.locator('#animation-stage canvas');
  const steppedPose = await canvas.screenshot();
  await page.locator('#animation-fps').fill('20');
  await page.locator('#animation-fps').press('Tab');
  await expect(page.locator('#animation-metadata')).toContainText('Mode: stepped · FPS: 20');
  await expect(page.locator('#current-time')).toHaveText('0.150 / 2.000 s');
  expect((await canvas.screenshot()).equals(steppedPose)).toBe(false);
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-status')).toContainText('Unsaved animation changes');
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-fps')).toHaveValue('10');
  expect((await canvas.screenshot()).equals(steppedPose)).toBe(true);
  await page.locator('#animation-redo').click();
  await expect(page.locator('#animation-fps')).toHaveValue('20');
  await page.locator('#animation-mode').selectOption('smooth');
  await expect(page.locator('#animation-fps')).toBeDisabled();
  const smoothPose = await canvas.screenshot();
  await timeline.press('ArrowRight');
  expect((await canvas.screenshot()).equals(smoothPose)).toBe(false);
  await page.locator('#animation-undo').click();
  await page.locator('#animation-undo').click();
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-mode')).toHaveValue('smooth');
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('#animation-selection')).toHaveValue('walk');
  await page.screenshot({ path: test.info().outputPath('animation-settings-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 620, height: 1100 });
  await page.screenshot({ path: test.info().outputPath('animation-settings-narrow.png'), fullPage: true });
});

test('invalid FPS restores the authored value and typing while playing retains the uncommitted edit', async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('#animation-mode').selectOption('stepped');
  const fps = page.locator('#animation-fps');
  for (const invalid of ['-1', '0', '241', '']) {
    await fps.fill(invalid);
    await fps.press('Tab');
    await expect(page.locator('#animation-status')).toContainText(
      'Animation FPS must be a finite number from 1 to 240',
    );
    await expect(fps).toHaveValue('10');
    await expect(page.locator('#animation-metadata')).toContainText('FPS: 10');
  }
  await page.locator('#preview-loop').click();
  await page.locator('#play-pause').click();
  await fps.fill('12.5');
  await page.waitForTimeout(200);
  await expect(fps).toHaveValue('12.5');
  await expect(page.locator('#animation-metadata')).toContainText('FPS: 10');
  await fps.dispatchEvent('keydown', { key: ' ', code: 'Space', bubbles: true });
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  await fps.press('Tab');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(page.locator('#animation-metadata')).toContainText('FPS: 12.5');
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  await page.locator('#playback-speed').focus();
  await page.locator('#playback-speed').dispatchEvent('keydown', { key: ' ', code: 'Space', bubbles: true });
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  await page.locator('#play-pause').click();
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

test('Space activates focused Restart and Loop preview buttons without toggling playback', async ({ page }) => {
  await openEditor(page);
  const timeline = page.locator('#timeline');
  const playPause = page.locator('#play-pause');
  await timeline.press('End');
  await page.locator('#reset-time').focus();
  await page.keyboard.press('Space');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
  await expect(playPause).toHaveText('Play');
  const loop = page.locator('#preview-loop');
  await loop.focus();
  await page.keyboard.press('Space');
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
  await expect(playPause).toHaveText('Play');
  await page.keyboard.press('Space');
  await expect(loop).toHaveAttribute('aria-pressed', 'false');
  await expect(playPause).toHaveText('Play');
});

test('playback advances without measuring layout or rewriting unchanged timeline controls', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), duration: 60_000 } });
  });
  await openEditor(page);
  await page.locator('#play-pause').click();
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  const work = await page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    await frame();
    const timeline = document.querySelector<HTMLElement>('#timeline')!;
    const bounds = timeline.getBoundingClientRect;
    let measurements = 0;
    let timeUpdates = 0;
    let unchangedWrites = 0;
    timeline.getBoundingClientRect = function () {
      measurements += 1;
      return bounds.call(this);
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.target === timeline && mutation.attributeName === 'aria-valuenow') timeUpdates += 1;
        else unchangedWrites += 1;
      }
    });
    observer.observe(timeline, {
      attributes: true,
      attributeFilter: ['aria-valuenow', 'aria-valuemax', 'aria-disabled'],
    });
    for (const selector of ['#animation-metadata', '#animation-status', '#animation-dirty', '#play-pause'])
      observer.observe(document.querySelector(selector)!, { childList: true, characterData: true, subtree: true });
    try {
      for (let count = 0; count < 10; count += 1) await frame();
      return { measurements, timeUpdates, unchangedWrites };
    } finally {
      timeline.getBoundingClientRect = bounds;
      observer.disconnect();
    }
  });
  expect(work.timeUpdates).toBeGreaterThan(0);
  expect(work.measurements).toBe(0);
  expect(work.unchangedWrites).toBe(0);
  await page.locator('#play-pause').click();
  await expect(page.locator('#play-pause')).toHaveText('Play');
});

test('loop preview repeats, remains a preference across selection, and stops at the endpoint when disabled', async ({
  page,
}) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...(await response.json()),
        duration: 400,
        loop: false,
        events: [],
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 400, x: 40 },
          ],
        },
      },
    });
  });
  await openEditor(page);
  const loop = page.getByRole('button', { name: 'Loop preview', exact: true });
  const playPause = page.locator('#play-pause');
  const timeline = page.locator('#timeline');
  await expect(loop).toHaveAttribute('aria-pressed', 'false');
  await loop.click();
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-metadata')).toContainText('Authored loop: off · Playback: loop');
  await playPause.click();
  const wraps = await timeline.evaluate(async (element) => {
    let previous = Number(element.getAttribute('aria-valuenow'));
    let count = 0;
    return await new Promise<number>((resolve) => {
      const finish = () => {
        observer.disconnect();
        clearTimeout(timeout);
        resolve(count);
      };
      const observer = new MutationObserver(() => {
        const current = Number(element.getAttribute('aria-valuenow'));
        if (current < previous) count += 1;
        previous = current;
        if (count >= 3) finish();
      });
      const timeout = setTimeout(finish, 5000);
      observer.observe(element, { attributes: true, attributeFilter: ['aria-valuenow'] });
    });
  });
  expect(wraps).toBe(3);
  await expect(playPause).toHaveText('Pause');
  await loop.click();
  await expect(playPause).toHaveText('Play');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0.4');
  await loop.click();
  await playPause.click();
  await page.locator('#animation-selection').selectOption('walk');
  await expect(playPause).toHaveText('Play');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.screenshot({ path: test.info().outputPath('animation-loop-preview.png'), fullPage: true });
});

test('playing drag owns time and pose until release; paused drag remains paused', async ({ page }) => {
  await openEditor(page);
  const timeline = page.locator('#timeline');
  const playPause = page.locator('#play-pause');
  const canvas = page.locator('#animation-stage canvas');
  const loop = page.locator('#preview-loop');
  const time = async () => Number(await timeline.getAttribute('aria-valuenow'));
  const box = await timeline.boundingBox();
  if (!box) throw new Error('Missing timeline bounds.');
  await loop.click();
  await playPause.click();
  await page.mouse.move(box.x + box.width * 0.25, box.y + 50);
  await page.mouse.down();
  await expect(page.locator('#animation-metadata')).toContainText('Scrubbing');
  const held = await time();
  const pose = await canvas.screenshot();
  await page.waitForTimeout(200);
  expect(await time()).toBe(held);
  expect((await canvas.screenshot()).equals(pose)).toBe(true);
  await page.mouse.move(box.x + box.width * 0.6, box.y + 50, { steps: 5 });
  const moved = await time();
  expect(moved).toBeCloseTo(1.8 * 0.6, 2);
  expect((await canvas.screenshot()).equals(pose)).toBe(false);
  await page.waitForTimeout(150);
  expect(await time()).toBe(moved);
  await page.mouse.up();
  await expect(playPause).toHaveText('Pause');
  await expect.poll(time).toBeGreaterThan(moved);
  await playPause.click();
  await page.mouse.move(box.x + box.width * 0.3, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 15, box.y + 70);
  await expect(timeline).toHaveAttribute('aria-valuenow', '1.8');
  await page.mouse.up();
  await page.waitForTimeout(150);
  await expect(timeline).toHaveAttribute('aria-valuenow', '1.8');
  await expect(playPause).toHaveText('Play');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('selection during a playing drag releases the old pointer without resuming the new animation', async ({
  page,
}) => {
  await openEditor(page);
  const timeline = page.locator('#timeline');
  const box = await timeline.boundingBox();
  if (!box) throw new Error('Missing timeline bounds.');
  await page.locator('#play-pause').click();
  await page.mouse.move(box.x + box.width * 0.4, box.y + 50);
  await page.mouse.down();
  await expect(page.locator('#animation-metadata')).toContainText('Scrubbing');
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
  await page.mouse.move(box.x + box.width * 0.7, box.y + 50);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#animation-metadata')).not.toContainText('Scrubbing');
});

for (const ending of ['pointercancel', 'lostpointercapture', 'blur'] as const) {
  test(`${ending} ends a playing drag and restores advancement`, async ({ page }) => {
    await openEditor(page);
    const timeline = page.locator('#timeline');
    await page.locator('#preview-loop').click();
    await page.locator('#play-pause').click();
    const box = await timeline.boundingBox();
    if (!box) throw new Error('Missing timeline bounds.');
    await page.mouse.move(box.x + box.width * 0.3, box.y + 50);
    await page.mouse.down();
    const held = Number(await timeline.getAttribute('aria-valuenow'));
    await timeline.evaluate((element, eventName) => {
      if (eventName === 'blur') window.dispatchEvent(new Event('blur'));
      else element.dispatchEvent(new PointerEvent(eventName, { pointerId: 1, bubbles: true }));
    }, ending);
    await expect(page.locator('#animation-metadata')).not.toContainText('Scrubbing');
    await expect.poll(async () => Number(await timeline.getAttribute('aria-valuenow'))).toBeGreaterThan(held);
    await page.mouse.up();
    await expect(page.locator('#play-pause')).toHaveText('Pause');
    await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  });
}
