import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { test } from './fixtures.js';

test('scene audio follows Play, pause, seek, speed, mute, restart and scene switching', async ({ page }) => {
  await page.addInitScript(() => {
    const observations: { offset: number; rate: number; loop: boolean; loopStart: number; manualStop: boolean }[] = [];
    Object.assign(window, { sceneAudioObservations: observations });
    // oxlint-disable-next-line typescript/unbound-method -- Deliberately borrowed below with the original node as this.
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      const observation = {
        offset,
        rate: this.playbackRate.value,
        loop: this.loop,
        loopStart: this.loopStart,
        manualStop: false,
      };
      observations.push(observation);
      const stop = this.stop.bind(this);
      this.stop = (time?: number) => {
        if (time === undefined) observation.manualStop = true;
        stop(time);
      };
      if (duration === undefined) original.call(this, when, offset);
      else original.call(this, when, offset, duration);
    };
  });
  const tone = await readFile(new URL('../fixtures/audio/tone.wav', import.meta.url));
  await page.route('**/audio/playback-tone.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: tone }));
  await page.goto('scene-editor/');
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'playback.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        id: 'audio-playback',
        name: 'Audio playback',
        duration: 6000,
        actors: [
          {
            id: 'hero',
            character: { manifest: '../characters/demo-puppet/character.json' },
            position: { x: 0, y: 0 },
            animation: 'idle',
          },
        ],
        actions: [
          { id: 'walk', actorId: 'hero', type: 'move', time: 1000, duration: 4000, destination: { x: 200, y: 0 } },
          {
            id: 'walk-animation',
            actorId: 'hero',
            type: 'animation',
            time: 1000,
            duration: 4000,
            animation: 'walk',
            speed: 1,
            loop: true,
          },
        ],
        cameraTracks: {
          zoom: [
            { id: 'zoom-start', time: 0, value: 1 },
            { id: 'zoom-end', time: 6000, value: 2 },
          ],
        },
        audioAssets: [{ id: 'tone', name: 'Tone', path: '../audio/playback-tone.wav', category: 'music' }],
        audioTracks: [{ id: 'mix', name: 'Mix', category: 'music' }],
        audioClips: [
          {
            id: 'music',
            assetId: 'tone',
            trackId: 'mix',
            time: 0,
            duration: 6000,
            sourceOffset: 250,
            volume: 0.2,
            loop: true,
            fadeIn: 500,
            fadeOut: 500,
          },
          {
            id: 'sword',
            assetId: 'tone',
            trackId: 'mix',
            time: 3000,
            duration: 500,
            sourceOffset: 0,
            volume: 0.8,
            loop: false,
          },
          {
            id: 'impact',
            assetId: 'tone',
            trackId: 'mix',
            time: 3400,
            duration: 500,
            sourceOffset: 500,
            volume: 1,
            loop: false,
          },
        ],
      }),
    ),
  });
  const status = page.getByLabel('Scene audio status', { exact: true });
  const time = page.getByLabel('Playhead (s)', { exact: true });
  const observations = () =>
    page.evaluate(
      () =>
        Reflect.get(window, 'sceneAudioObservations') as {
          offset: number;
          rate: number;
          loop: boolean;
          loopStart: number;
          manualStop: boolean;
        }[],
    );
  await expect(status).toHaveText('Audio: locked');
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await time.fill('3.2');
  await time.fill('3.45');
  await time.fill('0');
  expect(await observations()).toEqual([]);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(status).toHaveText('Audio: ready');
  await expect.poll(async () => (await observations()).length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const first = (await observations())[0]!;
  expect(first).toMatchObject({ loop: true, loopStart: 0.25, manualStop: true });
  await time.fill('3.45');
  const before = (await observations()).length;
  await page.getByLabel('Scene playback speed', { exact: true }).selectOption('0.5');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await observations()).length).toBeGreaterThanOrEqual(before + 3);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const resumed = (await observations()).slice(before, before + 3);
  expect(resumed.every((voice) => voice.rate === 0.5)).toBe(true);
  expect(resumed[0]!.offset).toBeCloseTo(1.95, 1);
  expect(resumed[1]!.offset).toBeCloseTo(0.45, 1);
  expect(resumed[2]!.offset).toBeCloseTo(0.55, 1);
  await time.fill('4.2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByLabel('Mute preview audio', { exact: true }).check();
  expect((await observations()).at(-1)!.manualStop).toBe(true);
  const muted = (await observations()).length;
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  expect((await observations()).length).toBe(muted);
  await page.getByLabel('Mute preview audio', { exact: true }).uncheck();
  await expect.poll(async () => (await observations()).length).toBeGreaterThan(muted);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(time).toHaveValue('0');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.screenshot({ path: '/tmp/paper-puppeteer-audio-playback.png', fullPage: true });
  const removal = page.waitForEvent('dialog').then(async (dialog) => {
    const message = dialog.message();
    await dialog.accept();
    expect(message).toContain('and its 3 clips');
  });
  await Promise.all([removal, page.getByRole('button', { name: 'Remove audio track Mix', exact: true }).click()]);
  await expect(status).toHaveText('Audio: disabled');
  await expect(page.locator('.scene-audio-clip')).toHaveCount(0);
  expect((await observations()).at(-1)!.manualStop).toBe(true);
  const beforeUndo = (await observations()).length;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.scene-audio-clip')).toHaveCount(3);
  await expect(status).toHaveText('Audio: ready');
  await expect.poll(async () => (await observations()).length).toBeGreaterThan(beforeUndo);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(status).toHaveText('Audio: disabled');
  expect((await observations()).at(-1)!.manualStop).toBe(true);
  await page.getByRole('button', { name: 'New Scene', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await dialog.getByLabel('Scene ID', { exact: true }).fill('silent-next');
  await dialog.getByRole('button', { name: 'Create scene', exact: true }).click();
  await expect(status).toHaveText('Audio: disabled');
  expect((await observations()).at(-1)!.manualStop).toBe(true);
});

test('blocked browser audio is visible and recovers through an explicit Enable audio gesture', async ({ page }) => {
  await page.addInitScript(() => {
    let denyResume = true;
    let starts = 0;
    Object.defineProperty(window, 'sceneAudioStarts', { get: () => starts });
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      override resume(): Promise<void> {
        if (denyResume) {
          denyResume = false;
          return Promise.reject(new Error('Browser blocked audio. Click Enable audio to retry.'));
        }
        return super.resume();
      }
      override createBufferSource(): AudioBufferSourceNode {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (when = 0, offset = 0, duration?: number) => {
          starts++;
          if (duration === undefined) start(when, offset);
          else start(when, offset, duration);
        };
        return source;
      }
    };
  });
  const tone = await readFile(new URL('../fixtures/audio/tone.wav', import.meta.url));
  await page.route('**/audio/locked-tone.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: tone }));
  await page.goto('scene-editor/');
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'locked.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        id: 'locked-audio',
        name: 'Locked audio',
        duration: 5000,
        actors: [],
        actions: [],
        audioAssets: [{ id: 'tone', name: 'Tone', path: '../audio/locked-tone.wav', category: 'sfx' }],
        audioTracks: [{ id: 'effects', name: 'Effects', category: 'sfx' }],
        audioClips: [
          {
            id: 'effect',
            assetId: 'tone',
            trackId: 'effects',
            time: 0,
            duration: 5000,
            sourceOffset: 0,
            volume: 0.5,
            loop: true,
          },
        ],
      }),
    ),
  });
  const status = page.getByLabel('Scene audio status', { exact: true });
  await expect(status).toHaveText('Audio: locked');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(status).toHaveText('Audio: error');
  await expect(page.getByRole('alert')).toContainText('Browser blocked audio');
  await expect(page.getByLabel('Scene playback status', { exact: true })).toContainText('stopped');
  expect(await page.evaluate(() => Reflect.get(window, 'sceneAudioStarts') as number)).toBe(0);
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await expect(status).toHaveText('Audio: ready');
  expect(await page.evaluate(() => Reflect.get(window, 'sceneAudioStarts') as number)).toBe(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'sceneAudioStarts') as number)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});
