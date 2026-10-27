import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { sceneTimelineGroup, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

declare global {
  interface Window {
    sceneDialogueGuideAudioStarts: number;
    sceneDialogueGuideAudioResumes: number;
  }
}

for (const guideId of ['scene-dialogue-authoring', 'scene-creating-dialogue']) {
  for (const populated of [false, true]) {
    test(`${guideId} reveals all steps and preserves ${populated ? 'instance speakers, voice metadata, history and preview' : 'an empty scene'}`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(() => {
        window.sceneDialogueGuideAudioStarts = 0;
        window.sceneDialogueGuideAudioResumes = 0;
        const NativeContext = window.AudioContext;
        window.AudioContext = class extends NativeContext {
          override resume(): Promise<void> {
            window.sceneDialogueGuideAudioResumes++;
            return super.resume();
          }
          override createBufferSource(): AudioBufferSourceNode {
            window.sceneDialogueGuideAudioStarts++;
            return super.createBufferSource();
          }
        };
      });
      await page.goto('scene-editor/');
      const open = page.getByRole('button', { name: 'Feature Guide', exact: true });
      const guide = guideRegistry.getGuideById(guideId)!;
      const catalog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
      await open.click();
      await expect(catalog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true })).toBeDisabled();
      await catalog.getByRole('button', { name: 'Close', exact: true }).click();
      const tone = await readFile(new URL('../fixtures/audio/tone.wav', import.meta.url));
      await page.route('**/audio/dialogue-guide.wav', (route) =>
        route.fulfill({ contentType: 'audio/wav', body: tone }),
      );
      const text = '森は静かだった。\n  Prepare yourself. 👋\n';
      const source = {
        version: 2,
        id: 'dialogue-guide',
        name: 'Dialogue guide',
        duration: 5000,
        actors: [],
        actions: [],
        ...(populated
          ? {
              actors: ['hero', 'twin'].map((id) => ({
                id,
                character: { manifest: '../characters/demo-puppet/character.json' },
                position: { x: 0, y: 0 },
              })),
              audioAssets: [{ id: 'voice', name: 'Voice', path: '../audio/dialogue-guide.wav', category: 'voice' }],
              audioTracks: [{ id: 'voice', name: 'Voice', category: 'voice' }],
              audioClips: [
                {
                  id: 'voice-clip',
                  assetId: 'voice',
                  trackId: 'voice',
                  time: 500,
                  duration: 1000,
                  sourceOffset: 0,
                  volume: 1,
                  loop: false,
                },
              ],
              dialogue: [
                {
                  id: 'line',
                  actorId: 'twin',
                  speakerName: '双子',
                  text,
                  time: 500,
                  duration: 1500,
                  voiceClipId: 'voice-clip',
                },
              ],
            }
          : {}),
      };
      await page.getByLabel('Open scene JSON').setInputFiles({
        name: 'dialogue-guide.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(source)),
      });
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
      await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
      const line = page.getByRole('button', { name: 'Dialogue line: 双子', exact: true });
      const toolbar = page.locator('.scene-stage-toolbar');
      if (populated) {
        await line.click();
        await page.getByText('Dialogue line · line', { exact: true }).click();
        await page.getByLabel('Speaker label', { exact: true }).fill('Temporary label');
        await page.getByRole('button', { name: 'Apply dialogue properties', exact: true }).click();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.getByLabel('Playhead (s)', { exact: true }).fill('1.25');
        await sceneTimelineGroup(page, 'View');
        await page.getByLabel('Scene playback speed', { exact: true }).selectOption('0.5');
        await sceneTimelineGroup(page, 'Audio');
        await page.getByLabel('Mute preview audio', { exact: true }).check();
        await toolbar.getByRole('button', { name: 'Preview Through Camera', exact: true }).click();
        await page.getByLabel('Editor overlays', { exact: true }).check();
        await line.click();
      }
      const download = async () => {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
        return JSON.parse(await readFile(await (await pending).path(), 'utf8')) as unknown;
      };
      const before = await download();
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
        if (step.id === 'text') {
          if (populated) await expect(target.getByLabel('Dialogue text', { exact: true })).toHaveValue(text);
          else await expect(target).toContainText('No lines yet?');
          await page.screenshot({ path: testInfo.outputPath(`dialogue-guide-${populated}.png`) });
        }
        if (step.id === 'speaker' && populated)
          await expect(target.getByLabel('Speaker Actor', { exact: true })).toHaveValue('twin');
        if (step.id === 'voice' && populated)
          await expect(target.getByLabel('Voice reference', { exact: true })).toHaveValue('voice-clip');
        if (index + 1 < guide.steps.length) await tour.getByRole('button', { name: 'Next', exact: true }).click();
      }
      await tour.getByRole('button', { name: 'Finish', exact: true }).click();
      await expect(tour).not.toBeVisible();
      const edit = page.getByRole('tab', { name: 'Edit', exact: true });
      await expect(edit).toHaveAttribute(
        'aria-selected',
        String(guide.steps.some((step) => step.targetId === 'scene-package')),
      );
      await edit.click();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled({ enabled: populated });
      await expect(page.getByLabel('Playhead (s)', { exact: true })).toHaveValue(populated ? '1.25' : '0');
      await expect(page.getByLabel('Scene playback status')).toContainText(populated ? 'paused' : 'stopped');
      await expect(page.getByLabel('Scene playback speed', { exact: true })).toHaveValue(populated ? '0.5' : '1');
      await expect(page.getByLabel('Mute preview audio', { exact: true })).toBeChecked({ checked: populated });
      if (populated) {
        await expect(line).toHaveAttribute('aria-pressed', 'true');
        await expect(toolbar.getByRole('button', { name: 'Exit Camera Preview', exact: true })).toBeVisible();
        await expect(page.getByLabel('Editor overlays', { exact: true })).toBeChecked();
      } else await expect(page.locator('.scene-dialogue-line')).toHaveCount(0);
      expect(await download()).toEqual(before);
      expect(await page.evaluate(() => window.sceneDialogueGuideAudioStarts)).toBe(0);
      expect(await page.evaluate(() => window.sceneDialogueGuideAudioResumes)).toBe(0);
    });
  }
}
