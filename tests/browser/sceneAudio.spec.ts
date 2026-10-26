import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../../src/engine/ScenePackage.js';
import { sceneTimelineGroup, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

test('audio timeline authors finite clips, trims both ends, groups drag undo and exports portable audio', async ({
  page,
}) => {
  const tone = await readFile(new URL('../fixtures/audio/tone.wav', import.meta.url));
  await page.route('**/audio/timeline-tone.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: tone }));
  await page.goto('scene-editor/');
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'audio.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        id: 'audio-authoring',
        name: 'Audio authoring',
        duration: 10000,
        actors: [],
        actions: [],
        audioAssets: [{ id: 'tone', name: 'Tone', path: '../audio/timeline-tone.wav', category: 'sfx' }],
        audioTracks: [{ id: 'effects', name: 'Effects', category: 'sfx' }],
        audioClips: [
          {
            id: 'seed',
            assetId: 'tone',
            trackId: 'effects',
            time: 1000,
            duration: 1000,
            sourceOffset: 250,
            volume: 0.8,
            loop: false,
            fadeIn: 100,
            fadeOut: 100,
          },
        ],
      }),
    ),
  });
  const clips = page.locator('.scene-audio-clip');
  await expect(clips).toHaveCount(1);
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await clips.first().click();
  await page.locator('.scene-inspector summary').filter({ hasText: 'Audio clip · Tone' }).click();
  await expect(page.getByText('Media duration: 2.000 seconds', { exact: true })).toBeVisible();
  const start = page.getByLabel('Start (seconds)', { exact: true });
  const duration = page.locator('.scene-inspector details[open]').getByLabel('Duration (seconds)', { exact: true });
  const offset = page.getByLabel('Source offset (seconds)', { exact: true });
  const drag = async (edge: 'move' | 'start' | 'end', milliseconds: number) => {
    const button = clips.first();
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    const lane = (await page.getByLabel('Effects audio clips', { exact: true }).boundingBox())!;
    const x = edge === 'start' ? box.x + 3 : edge === 'end' ? box.x + box.width - 3 : box.x + box.width / 2;
    await page.keyboard.down('Alt');
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x + (milliseconds / 10000) * lane.width, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
  };
  await drag('move', 2000);
  expect(Number(await start.inputValue())).toBeCloseTo(3, 2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(start).toHaveValue('1');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(Number(await start.inputValue())).toBeCloseTo(3, 2);
  await drag('start', 200);
  expect(Number(await offset.inputValue())).toBeCloseTo(0.45, 2);
  expect(Number(await duration.inputValue())).toBeCloseTo(0.8, 2);
  await drag('end', -200);
  expect(Number(await duration.inputValue())).toBeCloseTo(0.6, 2);
  await page.getByLabel('Volume (%)', { exact: true }).fill('35');
  await page.getByLabel('Loop', { exact: true }).check();
  await duration.fill('4');
  await page.getByLabel('Fade in (seconds)', { exact: true }).fill('0.2');
  await page.getByLabel('Fade out (seconds)', { exact: true }).fill('0.4');
  await page.getByRole('button', { name: 'Apply audio clip properties', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate audio clip', exact: true }).click();
  await expect(clips).toHaveCount(2);
  // A new selected clip starts with its inspector collapsed.
  await page.locator('.scene-inspector summary').filter({ hasText: 'Audio clip · Tone' }).click();
  await page.getByRole('button', { name: 'Delete audio clip', exact: true }).click();
  await expect(clips).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(clips).toHaveCount(2);
  await sceneTimelineGroup(page, 'Audio');
  await page.getByRole('combobox', { name: 'Track category', exact: true }).selectOption('voice');
  await page.getByRole('button', { name: 'Add audio track', exact: true }).click();
  await sceneTimelineGroup(page, 'Audio');
  await page.getByLabel('Audio track', { exact: true }).selectOption('voice-1');
  await page.getByRole('button', { name: 'Add Audio Clip', exact: true }).click();
  await expect(clips).toHaveCount(3);
  await page.screenshot({ path: '/tmp/paper-puppeteer-audio-timeline.png', fullPage: true });
  const download = async (name: string) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    return readFile(await (await pending).path());
  };
  const authored = parseSceneJson((await download('Download scene JSON')).toString());
  expect(authored.duration).toBe(10000);
  expect(authored.audioClips).toHaveLength(3);
  expect(authored.audioClips![0]).toMatchObject({
    volume: 0.35,
    loop: true,
    duration: 4000,
    fadeIn: 200,
    fadeOut: 400,
  });
  expect(authored.audioTracks).toHaveLength(2);
  const files = decodePackageZip(new Uint8Array(await download('Download scene package')));
  const portable = await validateScenePackage(files);
  expect(portable.definition.audioClips).toEqual(authored.audioClips);
  expect(portable.audio!.get('tone')).toEqual(new Uint8Array(tone));
  const removeVoice = page.getByRole('button', { name: 'Remove audio track Voice 1', exact: true });
  const cancelRemoval = page.waitForEvent('dialog').then(async (dialog) => {
    const message = dialog.message();
    await dialog.dismiss();
    expect(message).toContain('and its 1 clip');
  });
  await Promise.all([cancelRemoval, removeVoice.click()]);
  await expect(clips).toHaveCount(3);
  await expect(page.getByLabel('Audio track', { exact: true }).locator('option')).toHaveCount(2);
  const confirmRemoval = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await Promise.all([confirmRemoval, removeVoice.click()]);
  await expect(clips).toHaveCount(2);
  await expect(removeVoice).toHaveCount(0);
  await expect(page.getByLabel('Audio asset', { exact: true })).toContainText('Tone');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(clips).toHaveCount(3);
  await expect(removeVoice).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(clips).toHaveCount(2);
  await sceneTimelineGroup(page, 'Audio');
  await page.getByRole('combobox', { name: 'Track category', exact: true }).selectOption('ambience');
  await page.getByRole('button', { name: 'Add audio track', exact: true }).click();
  const removeEmpty = page.getByRole('button', { name: 'Remove audio track Ambience 1', exact: true });
  await removeEmpty.click();
  await expect(removeEmpty).toHaveCount(0);
  await expect(clips).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(removeEmpty).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(removeEmpty).toHaveCount(0);
});

test('Project Workspace audio catalog feeds the retained Scene Editor and guards used asset removal', async ({
  page,
}) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const projectDialog = page.getByRole('dialog', { name: 'New Project', exact: true });
  await projectDialog.getByLabel('Project name').fill('Timeline film');
  await projectDialog.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.locator('.project-audio > summary').click();
  await page.getByLabel('Import Audio', { exact: true }).setInputFiles({
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: await readFile(new URL('../fixtures/audio/tone.wav', import.meta.url)),
  });
  await expect(page.getByRole('status')).toContainText('Audio imported.');
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const sceneDialog = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await sceneDialog.getByLabel('Scene name').fill('Opening');
  await sceneDialog.getByRole('button', { name: 'Create Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const frame = page.frameLocator('iframe:visible');
  await sceneTimelineGroup(frame, 'Audio');
  await frame.getByRole('combobox', { name: 'Track category', exact: true }).selectOption('ambience');
  await frame.getByRole('button', { name: 'Add audio track', exact: true }).click();
  await expect(frame.getByLabel('Audio asset', { exact: true })).toContainText('tone');
  await sceneTimelineGroup(frame, 'Audio');
  await frame.getByRole('button', { name: 'Add Audio Clip', exact: true }).click();
  await expect(frame.locator('.scene-audio-clip')).toHaveCount(1);
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  const music = page
    .locator('.project-audio .project-asset-group')
    .filter({ has: page.locator('summary', { hasText: /^Music/ }) });
  await music.locator(':scope > summary').click();
  await music.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Audio is in use:');
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  await expect(frame.locator('.scene-audio-clip')).toHaveCount(1);
  const pending = page.waitForEvent('download');
  await frame.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const files = decodePackageZip(new Uint8Array(await readFile(await (await pending).path())));
  expect((await validateScenePackage(files)).definition.audioClips).toHaveLength(1);
});
