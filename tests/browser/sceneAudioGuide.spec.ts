import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { sceneTimelineGroup, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

declare global {
  interface Window {
    sceneAudioGuideStarts: number;
    sceneAudioGuideResumes: number;
  }
}

for (const guideId of [
  'scene-audio-timeline',
  'scene-audio-synchronization',
  'scene-importing-audio',
  'scene-audio-timeline-basics',
  'scene-audio-scene-timing',
] as const) {
  for (const populated of [false, true]) {
    test(`${guideId} reveals all controls and preserves ${populated ? 'selected clips, history, clock and preview' : 'an empty scene'}`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(() => {
        window.sceneAudioGuideStarts = 0;
        window.sceneAudioGuideResumes = 0;
        const NativeContext = window.AudioContext;
        window.AudioContext = class extends NativeContext {
          override resume(): Promise<void> {
            window.sceneAudioGuideResumes++;
            return super.resume();
          }
          override createBufferSource(): AudioBufferSourceNode {
            const node = super.createBufferSource();
            const start = node.start.bind(node);
            node.start = (...args: Parameters<AudioBufferSourceNode['start']>) => {
              window.sceneAudioGuideStarts++;
              start(...args);
            };
            return node;
          }
        };
      });
      await page.goto('scene-editor/');
      const open = page.getByRole('button', { name: 'Feature Guide', exact: true });
      const guide = guideRegistry.getGuideById(guideId)!;
      await open.click();
      const catalog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
      await expect(catalog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true })).toBeDisabled();
      await catalog.getByRole('button', { name: 'Close', exact: true }).click();
      const tone = await readFile(new URL('../fixtures/audio/tone.wav', import.meta.url));
      await page.route('**/audio/guide-tone.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: tone }));
      const source = {
        version: 2,
        id: 'audio-guide',
        name: 'Audio guide',
        duration: 4000,
        actors: [],
        actions: [],
        ...(populated
          ? {
              audioAssets: [{ id: 'tone', name: 'Tone', path: '../audio/guide-tone.wav', category: 'voice' }],
              audioTracks: [{ id: 'voice', name: 'Voice', category: 'voice' }],
              audioClips: [
                {
                  id: 'voice-clip',
                  assetId: 'tone',
                  trackId: 'voice',
                  time: 500,
                  duration: 3000,
                  sourceOffset: 100,
                  volume: 0.4,
                  loop: true,
                  fadeIn: 200,
                  fadeOut: 300,
                },
              ],
            }
          : {}),
      };
      await page.getByLabel('Open scene JSON').setInputFiles({
        name: 'audio-guide.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(source)),
      });
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
      await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
      const selected = page.getByRole('button', { name: 'Audio clip Tone voice-clip', exact: true });
      const toolbar = page.locator('.scene-stage-toolbar');
      if (populated) {
        await selected.click();
        await sceneTimelineGroup(page, 'View');
        await page.getByLabel('Scene playback speed', { exact: true }).selectOption('0.5');
        await sceneTimelineGroup(page, 'Audio');
        await page.getByLabel('Mute preview audio', { exact: true }).check();
        await page.locator('.scene-inspector summary').filter({ hasText: 'Audio clip · Tone' }).click();
        await page.getByLabel('Volume (%)', { exact: true }).fill('60');
        await page.getByRole('button', { name: 'Apply audio clip properties', exact: true }).click();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.getByLabel('Playhead (s)', { exact: true }).fill('1');
        await toolbar.getByRole('button', { name: 'Preview Through Camera', exact: true }).click();
        await page.getByLabel('Editor overlays', { exact: true }).check();
        await selected.click();
      }
      const downloadScene = async () => {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
        return JSON.parse(await readFile(await (await pending).path(), 'utf8')) as unknown;
      };
      const before = await downloadScene();
      await page.getByRole('tab', { name: 'Local draft', exact: true }).click();
      await open.click();
      await catalog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
      const tour = page.getByRole('dialog', { name: guide.title, exact: true });
      await tour.getByRole('button', { name: 'Next', exact: true }).click();
      await tour.getByRole('button', { name: 'Back', exact: true }).click();
      await tour.getByRole('button', { name: 'Restart guide', exact: true }).click();
      for (const [index, step] of guide.steps.entries()) {
        await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
        const target = page.locator(`[data-guide-id="${step.targetId}"]`);
        await expect(target).toHaveCount(1);
        await expect(target).toBeVisible();
        await expect(page.locator('.guide-spotlight-hole')).toBeVisible();
        await expect(tour).not.toContainText('Target unavailable');
        if ((step.id === 'add' || step.id === 'return') && !populated) await expect(target).toBeDisabled();
        if (step.id === 'trim' && !populated) await expect(target).toContainText('No clips yet?');
        if (step.id === 'unlock') await expect(target).toContainText(populated ? 'locked' : 'disabled');
        if (step.id === 'mute') {
          await expect(target.getByRole('checkbox')).toBeChecked({ checked: populated });
          await page.screenshot({ path: testInfo.outputPath(`audio-playback-guide-${populated}.png`) });
        }
        if (step.id === 'fades') {
          if (populated) await expect(target.getByLabel('Fade out (seconds)', { exact: true })).toHaveValue('0.3');
          await page.screenshot({ path: testInfo.outputPath(`audio-timeline-guide-${populated}.png`) });
        }
        if (index + 1 < guide.steps.length) await tour.getByRole('button', { name: 'Next', exact: true }).click();
      }
      await tour.getByRole('button', { name: 'Finish', exact: true }).click();
      await expect(tour).not.toBeVisible();
      const edit = page.getByRole('tab', { name: 'Edit', exact: true });
      // Only tours that visit document commands reveal Edit; other tours retain Local draft.
      await expect(edit).toHaveAttribute(
        'aria-selected',
        String(guide.steps.some((step) => step.targetId === 'scene-package')),
      );
      await edit.click();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await expect(page.getByLabel('Playhead (s)', { exact: true })).toHaveValue(populated ? '1' : '0');
      await expect(page.getByLabel('Scene playback status')).toContainText(populated ? 'paused' : 'stopped');
      await expect(page.getByLabel('Scene playback speed', { exact: true })).toHaveValue(populated ? '0.5' : '1');
      await expect(page.getByLabel('Mute preview audio', { exact: true })).toBeChecked({ checked: populated });
      if (populated) {
        await expect(selected).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByLabel('Volume (%)', { exact: true })).toHaveValue('40');
        await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
        await expect(toolbar.getByRole('button', { name: 'Exit Camera Preview', exact: true })).toBeVisible();
        await expect(page.getByLabel('Editor overlays', { exact: true })).toBeChecked();
      } else {
        await expect(page.locator('.scene-audio-clip')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
        await expect(toolbar.getByRole('button', { name: 'Preview Through Camera', exact: true })).toBeVisible();
      }
      expect(await downloadScene()).toEqual(before);
      expect(await page.evaluate(() => window.sceneAudioGuideStarts)).toBe(0);
      expect(await page.evaluate(() => window.sceneAudioGuideResumes)).toBe(0);
    });
  }
}
