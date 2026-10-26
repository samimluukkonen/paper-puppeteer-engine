import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../../src/engine/ScenePackage.js';
import { sceneTimelineGroup, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

test('dialogue authors multiline Unicode and instance speakers, rejects overlaps, uses history and survives portable reload', async ({
  page,
}) => {
  await page.goto('scene-editor/');
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'dialogue.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        id: 'dialogue-test',
        name: 'Dialogue test',
        duration: 10000,
        actors: ['hero', 'twin'].map((id) => ({
          id,
          character: { manifest: '../characters/demo-puppet/character.json' },
          position: { x: 0, y: 0 },
        })),
        actions: [],
      }),
    ),
  });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await sceneTimelineGroup(page, 'Dialogue');
  await page.getByRole('button', { name: 'Add Dialogue Line', exact: true }).click();
  const track = page.getByLabel('Dialogue lines', { exact: true });
  await expect(track.getByRole('button')).toHaveCount(1);
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page.getByText('Dialogue line · dialogue-1', { exact: true }).click();
  const text = '森は静かだった。\n  Prepare yourself. 👋\n';
  await page.getByLabel('Dialogue text', { exact: true }).fill(text);
  await page.getByLabel('Speaker Actor', { exact: true }).selectOption('twin');
  await page.getByLabel('Speaker label', { exact: true }).fill('双子');
  await page.getByLabel('Dialogue start (seconds)', { exact: true }).fill('0.5');
  await page.getByLabel('Dialogue duration (seconds)', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: 'Apply dialogue properties', exact: true }).click();
  await expect(track.getByRole('button', { name: 'Dialogue dialogue-1: 双子', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Dialogue text', { exact: true })).toHaveValue(text);
  await page.getByRole('button', { name: 'Duplicate dialogue line', exact: true }).click();
  await expect(track.getByRole('button')).toHaveCount(2);
  await page.getByText('Dialogue line · dialogue-2', { exact: true }).click();
  await expect(page.getByLabel('Dialogue start (seconds)', { exact: true })).toHaveValue('2');
  await page.getByLabel('Dialogue start (seconds)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply dialogue properties', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Dialogue intervals must not overlap. Move or shorten this line.' }),
  ).toBeVisible();
  await page.getByLabel('Dialogue start (seconds)', { exact: true }).fill('3');
  await page.getByLabel('Speaker Actor', { exact: true }).selectOption('');
  await page.getByLabel('Speaker label', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Apply dialogue properties', exact: true }).click();
  await expect(track.getByRole('button', { name: 'Dialogue dialogue-2: Narrator', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Dialogue start (seconds)', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Dialogue start (seconds)', { exact: true })).toHaveValue('3');
  const download = async (name: string) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    return readFile(await (await pending).path());
  };
  const authored = parseSceneJson((await download('Download scene JSON')).toString());
  expect(authored.dialogue).toEqual([
    { id: 'dialogue-1', actorId: 'twin', speakerName: '双子', text, time: 500, duration: 1500 },
    { id: 'dialogue-2', text, time: 3000, duration: 1500 },
  ]);
  const portable = await validateScenePackage(
    decodePackageZip(new Uint8Array(await download('Download scene package'))),
  );
  expect(portable.definition.dialogue).toEqual(authored.dialogue);
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'reloaded.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...authored, id: 'reloaded' })),
  });
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await track.getByRole('button', { name: 'Dialogue dialogue-1: 双子', exact: true }).click();
  await page.getByText('Dialogue line · dialogue-1', { exact: true }).click();
  await expect(page.getByLabel('Dialogue text', { exact: true })).toHaveValue(text);
  await page.getByRole('button', { name: 'Delete dialogue line', exact: true }).click();
  await expect(track.getByRole('button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(track.getByRole('button')).toHaveCount(2);
});
