import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';

test.use({ actionTimeout: 15_000 });

let consumerScript = '';
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: { entry: fileURLToPath(new URL('./standaloneStoryHarness.ts', import.meta.url)), formats: ['es'] },
    },
  });
  for (const output of Array.isArray(result) ? result : [result])
    if ('output' in output)
      for (const chunk of output.output) if (chunk.type === 'chunk' && chunk.isEntry) consumerScript = chunk.code;
  if (!consumerScript) throw new Error('Missing standalone story consumer.');
});

async function mount(page: Page, space = false, audio = false, portable = false, acceptance = false) {
  await page.route('**/story-host', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Story viewer</title>' }),
  );
  await page.route('**/story-consumer.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: consumerScript }),
  );
  await page.goto('story-host');
  await page.evaluate(
    async ({ space, audio, portable, acceptance }) => {
      const url = new URL('story-consumer.js', location.href).href;
      const api = (await import(/* @vite-ignore */ url)) as typeof import('./standaloneStoryHarness.js');
      window.storyConsumer = await api.mountStory(space, audio, portable, acceptance);
    },
    { space, audio, portable, acceptance },
  );
}
const snapshot = (page: Page) => page.evaluate(() => window.storyConsumer.snapshot());
const focus = (page: Page) => page.evaluate(() => window.storyConsumer.focus());

test('three-scene cinematic story ZIP renders mesh, large artwork, holds, camera and concurrent audio', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page, false, true, true, true);
  await expect.poll(() => snapshot(page)).toMatchObject({ index: 0, time: 500, line: 'response', waiting: true });
  await expect.poll(async () => (await snapshot(page)).audio).toMatch(/^(ready|locked|error)$/);
  if ((await snapshot(page)).audio !== 'ready')
    await page.getByRole('button', { name: 'Enable story audio' }).click({ timeout: 15000 });
  await expect.poll(() => snapshot(page)).toMatchObject({ audio: 'ready', voices: 1 });
  const held = await snapshot(page);
  await expect.poll(async () => (await snapshot(page)).rootScales).not.toEqual(held.rootScales);
  const later = await snapshot(page);
  expect(later.time).toBe(held.time);
  expect(later.camera).toEqual(held.camera);
  expect(later.actorPositions).toEqual(held.actorPositions);
  expect(later.rootScales).not.toEqual(held.rootScales);
  await page.screenshot({ path: info.outputPath('three-scene-story.png') });
  await page.keyboard.press('Enter');
  await expect.poll(() => snapshot(page)).toMatchObject({ index: 1, time: 0, line: '01-question' });
  await page.keyboard.down('Enter');
  for (let i = 0; i < 20; i++) await page.keyboard.down('Enter');
  expect((await snapshot(page)).line).toBe('02-reply');
  await page.keyboard.up('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => snapshot(page)).toMatchObject({ index: 2, time: 500, line: 'response' });
  const sword = await snapshot(page);
  expect(sword.camera?.zoom).toBeCloseTo(1.25);
  expect(sword.actorPositions[0]!.x).toBeCloseTo(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => snapshot(page)).toMatchObject({ status: 'completed', voices: 0 });
  const completed = await snapshot(page);
  expect(completed.metrics.activations).toHaveLength(3);
  expect(completed.metrics.preparations).toHaveLength(3);
  const updates = [...completed.metrics.updates].sort((a, b) => a - b);
  const performancePath = info.outputPath('story-performance.json');
  await writeFile(
    performancePath,
    JSON.stringify(
      {
        ...completed.metrics,
        updates: undefined,
        updateSamples: updates.length,
        updateMedianMs: updates[Math.floor(updates.length / 2)],
        updateP95Ms: updates[Math.floor(updates.length * 0.95)],
        decodedBytes: completed.decoded,
        releasedBytes: completed.released,
      },
      null,
      2,
    ),
  );
  await info.attach('story-performance.json', { contentType: 'application/json', path: performancePath });
  await page.evaluate(() => window.storyConsumer.dispose());
  await expect.poll(() => snapshot(page)).toMatchObject({ status: 'disposed', voices: 0, objects: 0, textures: 0 });
  expect((await snapshot(page)).decoded).toBe((await snapshot(page)).released);
  await page.evaluate(() => window.storyConsumer.destroy());
  expect(errors).toEqual([]);
});

test('standalone viewer honors focus, consecutive lines, transitions, restart and repeated mount/cleanup', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page);
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ status: 'playing', index: 0, line: '01-first', waiting: true });
  await expect(page.getByRole('status')).toHaveText('Press Enter to continue');
  expect((await snapshot(page)).text).toContain('森は静かだった。');
  await page.screenshot({ path: info.outputPath('standalone-story.png') });
  const baselineListeners = (await snapshot(page)).updateListeners;
  await page.getByRole('textbox', { name: 'Outside editor field' }).fill('typing');
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Embedded editor field' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Host button' }).focus();
  await page.keyboard.press('Enter');
  expect((await snapshot(page)).line).toBe('01-first');
  await focus(page);
  for (const key of ['Shift+Enter', 'Control+Enter', 'Alt+Enter', 'Meta+Enter', 'Space'])
    await page.keyboard.press(key);
  await page.evaluate(() => {
    const host = document.querySelector('[aria-label="Standalone story"]')!;
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    const consumed = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    consumed.preventDefault();
    host.dispatchEvent(consumed);
  });
  expect((await snapshot(page)).line).toBe('01-first');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  expect((await snapshot(page)).line).toBe('02-second');
  await page.keyboard.up('Enter');
  await page.keyboard.down('Enter');
  await expect.poll(() => snapshot(page)).toMatchObject({ index: 1, line: '01-first' });
  await page.keyboard.down('Enter'); // Still held across scene load.
  expect((await snapshot(page)).line).toBe('01-first');
  await page.keyboard.up('Enter');
  await page.evaluate(() => {
    window.storyConsumer.advance();
    window.storyConsumer.advance();
  });
  await expect.poll(() => snapshot(page)).toMatchObject({ status: 'completed', objects: 0 });
  await expect(page.getByRole('status')).toHaveText('Story complete');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.storyConsumer.remount());
    expect((await snapshot(page)).updateListeners).toBe(baselineListeners);
    await page.keyboard.press('Enter');
    expect((await snapshot(page)).line).toBe('02-second');
  }
  await page.evaluate(() => window.storyConsumer.stop());
  expect((await snapshot(page)).objects).toBe(0);
  await page.keyboard.press('Enter');
  expect((await snapshot(page)).status).toBe('stopped');
  await page.evaluate(() => window.storyConsumer.restart());
  expect((await snapshot(page)).line).toBe('01-first');
  await page.evaluate(() => window.storyConsumer.dispose());
  await page.keyboard.press('Enter');
  expect(await snapshot(page)).toMatchObject({
    status: 'disposed',
    objects: 0,
    updateListeners: baselineListeners - 1,
  });
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.evaluate(() => window.storyConsumer.destroy());
  expect(errors).toEqual([]);
});

test('host-configured Space is the only keyboard advance action', async ({ page }) => {
  await mount(page, true);
  await expect(page.getByRole('status')).toHaveText('Press Space to continue');
  await page.keyboard.press('Enter');
  expect((await snapshot(page)).line).toBe('01-first');
  await page.keyboard.press('Space');
  expect((await snapshot(page)).line).toBe('02-second');
  await page.evaluate(() => window.storyConsumer.destroy());
});

test('audio unlock press preserves the first line and releases real browser voices/contexts', async ({ page }) => {
  await mount(page, false, true);
  await expect(page.getByRole('button', { name: 'Enable story audio' })).toBeVisible();
  await page.keyboard.down('Enter');
  await expect.poll(async () => (await snapshot(page)).audio).toBe('ready');
  await page.keyboard.down('Enter');
  expect((await snapshot(page)).line).toBe('01-first');
  expect((await snapshot(page)).voices).toBe(1);
  await page.keyboard.up('Enter');
  await expect(page.getByRole('status')).toHaveText('Press Enter to continue');
  await page.keyboard.press('Enter');
  expect((await snapshot(page)).line).toBe('02-second');
  await page.keyboard.press('Enter');
  await expect.poll(() => snapshot(page)).toMatchObject({ index: 1, line: '01-first', audio: 'locked' });
  await page.getByRole('button', { name: 'Enable story audio' }).click();
  await expect.poll(async () => (await snapshot(page)).audio).toBe('ready');
  expect((await snapshot(page)).line).toBe('01-first');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => snapshot(page)).toMatchObject({ status: 'completed', voices: 0, contextsClosed: 2 });
  const state = await snapshot(page);
  expect(state.decoded).toBeGreaterThan(0);
  expect(state.released).toBe(state.decoded);
  await page.evaluate(() => window.storyConsumer.restart());
  await page.getByRole('button', { name: 'Enable story audio' }).click();
  await expect.poll(async () => (await snapshot(page)).voices).toBe(1);
  const destroyed = await page.evaluate(() => window.storyConsumer.destroyGame());
  expect(destroyed).toMatchObject({ status: 'disposed', voices: 0, contextsClosed: 3 });
  expect(destroyed.released).toBe(destroyed.decoded);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('portable story ZIP shares rendered artwork and decoded audio through a fade and cleans up', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page, false, true, true);
  await expect.poll(() => snapshot(page)).toMatchObject({ index: 0, waiting: true });
  // Chromium may grant audio activation to the initial evaluate call; both permission states are valid.
  if ((await snapshot(page)).audio === 'locked') await page.getByRole('button', { name: 'Enable story audio' }).click();
  await expect.poll(() => snapshot(page)).toMatchObject({ audio: 'ready', voices: 1 });
  const first = await snapshot(page);
  expect(first.textures).toBeGreaterThan(1);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ status: 'playing', index: 1, line: '01-first', audio: 'ready', voices: 1 });
  const second = await snapshot(page);
  expect(second.textures).toBe(first.textures);
  expect(second.decoded).toBe(first.decoded);
  expect(second.contextsClosed).toBe(0);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => snapshot(page)).toMatchObject({ status: 'completed', voices: 0, textures: 0 });
  const completed = await snapshot(page);
  expect(completed.released).toBe(completed.decoded);
  await page.evaluate(() => window.storyConsumer.restart());
  await expect.poll(() => snapshot(page)).toMatchObject({ index: 0, waiting: true, audio: 'ready', voices: 1 });
  await page.evaluate(() => window.storyConsumer.dispose());
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ status: 'disposed', objects: 0, textures: 0, voices: 0, contextsClosed: 1 });
  await page.evaluate(() => window.storyConsumer.destroy());
  expect(errors).toEqual([]);
});
