import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { parseSceneReuseLibrary } from '../../src/devtools/shared/sceneReuse.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { sceneInspectorGroup } from './fixtures.js';

test('desktop multi-Actor choreography, detached preview, atomic insertion and independent scene templates', async ({
  page,
}) => {
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/audio/reuse-tone.wav', async (route) =>
    route.fulfill({
      body: await readFile(new URL('../fixtures/audio/tone.wav', import.meta.url)),
      contentType: 'audio/wav',
    }),
  );
  await page.goto('scene-editor/');
  const source = {
    version: 2,
    id: 'samurai-meeting',
    name: 'Samurai meeting',
    duration: 10000,
    camera: { x: 500, y: 350, zoom: 1 },
    actors: ['a', 'b'].map((id, index) => ({
      id,
      character: { manifest: '../characters/demo-puppet/character.json' },
      position: { x: 200 + index * 400, y: 300 },
    })),
    audioAssets: [{ id: 'voice', name: 'Greeting', category: 'voice', path: '../audio/reuse-tone.wav' }],
    audioTracks: [{ id: 'voice-track', name: 'Voice', category: 'voice' }],
    audioClips: [
      {
        id: 'greeting',
        assetId: 'voice',
        trackId: 'voice-track',
        time: 1500,
        duration: 300,
        sourceOffset: 0,
        volume: 1,
        loop: false,
      },
    ],
    dialogue: [
      { id: 'greeting-line', actorId: 'a', time: 1500, duration: 300, text: 'Welcome', voiceClipId: 'greeting' },
    ],
    actions: ['a', 'b'].flatMap((actorId, index) => [
      {
        id: `walk-${actorId}`,
        actorId,
        type: 'animation',
        time: 1000,
        duration: 1000,
        animation: 'walk',
        speed: 1,
        loop: true,
      },
      {
        id: `move-${actorId}`,
        actorId,
        type: 'move',
        time: 1000,
        duration: 1000,
        destination: { x: 300 + index * 200, y: 300 },
      },
      {
        id: `face-${actorId}`,
        actorId,
        type: 'face',
        time: 2000,
        target: { type: 'actor', actorId: index ? 'a' : 'b' },
      },
      {
        id: `bow-${actorId}`,
        actorId,
        type: 'animation',
        time: 2200,
        duration: 800,
        animation: 'idle',
        speed: 1,
        loop: false,
      },
    ]),
  };
  const upload = async (data: unknown) =>
    page
      .getByLabel('Open scene JSON')
      .setInputFiles({ name: 'meeting.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  const download = async () => {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
    return parseSceneJson(await readFile(await (await waiting).path(), 'utf8'));
  };
  await upload(source);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  for (const action of source.actions)
    await page
      .getByRole('button', { name: `${action.actorId}: ${action.type} ${action.id}`, exact: true })
      .click({ modifiers: ['ControlOrMeta'] });
  await page.getByRole('button', { name: 'Choreography & templates', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choreography and scene templates' });
  await expect(dialog.locator('details[open]')).toHaveCount(0);
  await dialog.getByText('Save selected actions as choreography (8)', { exact: true }).click();
  await dialog.getByLabel('Preset name', { exact: true }).fill('Two Samurai Bow');
  await dialog.getByLabel('Role for a', { exact: true }).fill('Samurai A');
  await dialog.getByLabel('Role for b', { exact: true }).fill('Samurai B');
  await dialog.getByRole('checkbox', { name: 'Include audio and dialogue', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save Selected Actions as Choreography', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved choreography');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const destination = {
    ...source,
    id: 'second-meeting',
    name: 'Second meeting',
    actors: source.actors.map((actor, index) => ({
      ...actor,
      id: `actor-${17 + index * 6}`,
      position: { x: 300 + index * 400, y: 300 },
    })),
    actions: [],
    audioAssets: [],
    audioTracks: [],
    audioClips: [],
    dialogue: [],
  };
  await upload(destination);
  const before = await download();
  await page.getByRole('button', { name: 'Choreography & templates', exact: true }).click();
  await dialog.getByText('Insert choreography (1)', { exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Samurai A', exact: true }).selectOption('actor-17');
  await dialog.getByRole('combobox', { name: 'Samurai B', exact: true }).selectOption('actor-23');
  await dialog.getByLabel('Insertion time (seconds)', { exact: true }).fill('4');
  await dialog.getByRole('button', { name: 'Preview choreography', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Preview is valid');
  await expect(page.locator('#scene-stage-canvas canvas')).toHaveCount(1);
  await expect(dialog.locator('#scene-reuse-stage-canvas canvas')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(async () => Number(await dialog.getByRole('spinbutton', { name: 'Playhead (s)', exact: true }).inputValue()))
    .toBeGreaterThan(0.1);
  await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: 'Playhead (s)', exact: true }).fill('5.5');
  await page.screenshot({ path: test.info().outputPath('choreography-preview.png') });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await download()).toEqual(before);
  await page.getByRole('button', { name: 'Choreography & templates', exact: true }).click();
  await dialog.getByText('Insert choreography (1)', { exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Samurai A', exact: true }).selectOption('actor-17');
  await dialog.getByRole('combobox', { name: 'Samurai B', exact: true }).selectOption('actor-23');
  await dialog.getByLabel('Insertion time (seconds)', { exact: true }).fill('4');
  await dialog.getByRole('button', { name: 'Preview choreography', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Confirm insertion', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Confirm insertion', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Choreography inserted');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const inserted = await download();
  expect(inserted.actions).toHaveLength(8);
  expect(inserted.dialogue![0]).toMatchObject({
    actorId: 'actor-17',
    time: 4500,
    voiceClipId: inserted.audioClips![0]!.id,
  });
  expect(inserted.audioClips![0]!.time).toBe(4500);
  expect(inserted.actions[0]!.time).toBe(4000);
  expect(inserted.actions.filter((action) => action.type === 'move').map((action) => action.destination.x)).toEqual([
    400, 600,
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await download()).actions).toHaveLength(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await download()).actions).toHaveLength(8);
  await page.getByRole('button', { name: 'Choreography & templates', exact: true }).click();
  await dialog.getByText('Scene templates (0)', { exact: true }).click();
  await dialog.getByLabel('Template name', { exact: true }).fill('Dojo meeting');
  await dialog.getByLabel('Include action, camera and fade timeline').check();
  await dialog.getByRole('checkbox', { name: 'Include audio and dialogue', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save Scene as Template', exact: true }).click();
  await dialog.getByLabel('New scene ID', { exact: true }).fill('second-meeting');
  await dialog.getByRole('button', { name: 'Preview template', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('already exists');
  await dialog.getByLabel('New scene ID', { exact: true }).fill('template-copy');
  await dialog.getByLabel('New scene name', { exact: true }).fill('Template copy');
  await dialog.getByRole('button', { name: 'Preview template', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Create Scene from Template', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Create Scene from Template', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Created an independent scene');
  await dialog.getByText('Transfer library JSON', { exact: true }).click();
  const saving = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download library JSON', exact: true }).click();
  const library = parseSceneReuseLibrary(JSON.parse(await readFile(await (await saving).path(), 'utf8')) as unknown);
  expect(library.templates[0]!.scene.id).toBe('second-meeting');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const copy = await download();
  expect(copy.id).toBe('template-copy');
  expect(copy.actions).toHaveLength(8);
  expect(copy.actors[0]!.id).not.toBe('actor-17');
  await sceneInspectorGroup(page, 'Scene');
  await page.getByText('Scene properties', { exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Scene inspector' })
    .getByLabel('Name', { exact: true })
    .fill('Edited template copy');
  await page.getByRole('button', { name: 'Apply properties', exact: true }).click();
  const edited = await download();
  expect(edited.name).toBe('Edited template copy');
  expect(library.templates[0]!.scene.name).toBe('Second meeting');
  await page.getByLabel('Select scene').selectOption('second-meeting');
  expect(await download()).toEqual(inserted);
  await page.getByLabel('Select scene').selectOption('samurai-meeting');
  expect((await download()).actions).toEqual(source.actions);
  await upload(edited);
  expect(await download()).toEqual(edited);
  expect(errors).toEqual([]);
});
