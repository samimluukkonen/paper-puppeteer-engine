import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { sceneTimelineGroup, inspectorControl } from './fixtures.js';

test('artist creates two-package scene visually, previews, retimes, reloads and exports a portable runtime artifact', async ({
  page,
}, info) => {
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedAssets.push(response.url());
  });
  await page.goto('scene-editor/');
  await page.getByRole('button', { name: 'New Scene', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await create.getByLabel('Scene ID', { exact: true }).fill('first-scene');
  await create.getByLabel('Duration (seconds)', { exact: true }).fill('5');
  await create.getByRole('button', { name: 'Create scene', exact: true }).click();
  const tracks = page.getByLabel('Action tracks', { exact: true });
  const time = page.getByLabel('Playhead (s)', { exact: true });
  const actionProperties = page.locator('[data-guide-id="scene-action-properties"]');
  const openProperties = async () => {
    if (!(await actionProperties.evaluate((element) => (element as HTMLDetailsElement).open)))
      await actionProperties.locator('summary').click();
  };
  const addAction = async (kind: string, at: number) => {
    await time.fill(String(at));
    await sceneTimelineGroup(page, 'Actions');
    await page.getByRole('combobox', { name: 'Action type', exact: true }).selectOption(kind);
    await page.getByRole('button', { name: 'Add action', exact: true }).click();
    await openProperties();
  };
  for (const [index, character] of ['demo-puppet', 'random-paperdoll-sketch'].entries()) {
    await (await inspectorControl(page, '[data-guide-id="scene-add-actor"]')).click();
    const add = page.getByRole('dialog', { name: 'Add Actor', exact: true });
    await add.getByLabel('Workspace character').selectOption(`../characters/${character}/character.json`);
    await add.getByRole('button', { name: 'Add actor', exact: true }).click();
    await expect(add).not.toBeVisible();
    await page.getByText('Actor properties', { exact: true }).click();
    await page.getByLabel('Initial X', { exact: true }).fill(String(index ? 180 : -180));
    await page.getByRole('button', { name: 'Apply actor properties', exact: true }).click();
    await page.getByRole('combobox', { name: 'Initial animation', exact: true }).selectOption('idle');
  }
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  for (let index = 0; index < 2; index++) {
    await tracks.getByRole('button', { name: `actor-${index + 1}`, exact: true }).click();
    await addAction('move', 1);
    await page.getByLabel('Destination X', { exact: true }).fill(String(index ? 40 : -40));
    await page.getByLabel('Action duration (seconds)', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Apply action properties', exact: true }).click();
    await addAction('animation', 1);
    await page.getByRole('combobox', { name: 'Animation ID', exact: true }).selectOption('walk');
    await page.getByLabel('Action duration (seconds)', { exact: true }).fill('2');
    await page.getByLabel('Loop within duration', { exact: true }).check();
    await page.getByRole('button', { name: 'Apply action properties', exact: true }).click();
    await addAction('face', 0);
    await page.getByRole('combobox', { name: 'Facing target', exact: true }).selectOption('actor');
    await page.getByRole('button', { name: 'Apply action properties', exact: true }).click();
  }
  await addAction('cue', 3.5);
  await page.getByLabel('Cue name', { exact: true }).fill('arrived');
  await page.getByRole('button', { name: 'Apply action properties', exact: true }).click();
  await page.getByText('Runtime preview', { exact: true }).click();
  await time.fill('2');
  const runtime = page.locator('details').filter({ has: page.getByText('Runtime preview', { exact: true }) });
  const expectedPosition = (await runtime.locator('dd').nth(2).textContent()) ?? '';
  expect(expectedPosition).toBe('110.000, 0.000');
  await time.fill('4');
  await time.fill('0.5');
  await time.fill('2');
  await expect(runtime.locator('dd').nth(2)).toHaveText(expectedPosition);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(page.getByLabel('Scene playback status')).toContainText('playing');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  // Retime the cue using the same real inspector and verify Undo/Redo independently of playback.
  await tracks.getByRole('button', { name: 'actor-2: cue action-7', exact: true }).click();
  await openProperties();
  await page.getByLabel('Start (seconds)', { exact: true }).fill('3.75');
  await page.getByRole('button', { name: 'Apply action properties', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Start (seconds)', { exact: true })).toHaveValue('3.5');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Start (seconds)', { exact: true })).toHaveValue('3.75');
  const jsonWaiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
  const jsonFile = await (await jsonWaiting).path();
  const json = await readFile(jsonFile, 'utf8');
  const authored = parseSceneJson(json);
  expect(authored.actors.map(({ position }) => position.x)).toEqual([-180, 180]);
  expect(authored.actions).toHaveLength(7);
  await page
    .getByLabel('Open scene JSON')
    .setInputFiles({ name: 'first.scene.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await sceneTimelineGroup(page, 'View');
  await page.getByLabel('Scene playback speed').selectOption('2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('Scene playback status')).toContainText('completed', { timeout: 15000 });
  const zipWaiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const zipFile = await (await zipWaiting).path();
  const bytes = await readFile(zipFile);
  const files = decodePackageZip(bytes);
  const packaged = parseSceneJson(new TextDecoder().decode(files.get('scene.json')));
  expect(packaged.actors.map(({ character }) => character.manifest)).toEqual([
    'characters/character-1/character.json',
    'characters/character-2/character.json',
  ]);
  expect(packaged.actions).toEqual(authored.actions);
  // Retain the exact editor export for the optional independently packed consumer handoff.
  await writeFile(info.outputPath('first-scene.zip'), bytes);
  expect(errors).toEqual([]);
  expect(failedAssets).toEqual([]);
});
