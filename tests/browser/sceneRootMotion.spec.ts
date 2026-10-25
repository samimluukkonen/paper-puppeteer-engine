import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { animationFileSchema } from '../../src/engine/schemas.js';

test('two-Actor root-motion authoring, playback, conflict rejection, scrubbing and export/reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/animations/combat-idle.json', async (route) => {
    const response = await route.fetch();
    const animation = animationFileSchema.parse(await response.json());
    await route.fulfill({
      json: {
        ...animation,
        duration: 1000,
        loop: false,
        tracks: {},
        events: [],
        rootMotion: {
          translationKeys: [
            { time: 0, x: 0, y: 0 },
            { time: 1000, x: 80, y: 0 },
          ],
        },
      },
    });
  });
  await page.goto('scene-editor/');
  const source = {
    version: 2,
    id: 'root-step',
    name: 'Root step',
    duration: 3000,
    actors: ['a', 'b'].map((id, index) => ({
      id,
      character: { manifest: '../characters/demo-puppet/character.json' },
      position: { x: 100 + index * 200, y: 100 },
      animation: 'idle',
    })),
    actions: [
      {
        id: 'step',
        actorId: 'a',
        type: 'animation',
        time: 0,
        duration: 1000,
        speed: 1,
        loop: false,
        animation: 'sword',
      },
      {
        id: 'idle',
        actorId: 'a',
        type: 'animation',
        time: 1000,
        duration: 2000,
        speed: 1,
        loop: true,
        animation: 'idle',
      },
    ],
  };
  const upload = async (json: string) =>
    page
      .getByLabel('Open scene JSON')
      .setInputFiles({ name: 'root.scene.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await upload(JSON.stringify(source));
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page.getByRole('button', { name: 'a: animation step', exact: true }).click();
  await page.getByText('Action properties · animation', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Movement source', exact: true })).toHaveValue('scene');
  await expect(page.getByText(/Root displacement \(animation-local/)).toContainText('X: +80; Y: 0');
  await page.getByRole('combobox', { name: 'Movement source', exact: true }).selectOption('rootMotion');
  await page.getByRole('button', { name: 'Apply action properties' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Movement source', exact: true })).toHaveValue('scene');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Movement source', exact: true })).toHaveValue('rootMotion');
  await page.getByText('Runtime preview', { exact: true }).click();
  const position = page.getByText('Position', { exact: true }).locator('+ dd');
  const time = page.getByRole('spinbutton', { name: 'Playhead (s)', exact: true });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await time.inputValue())).toBeGreaterThan(1.1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(position).toHaveText('180.000, 100.000');
  for (const [seconds, expected] of [
    ['0.5', '140.000, 100.000'],
    ['2', '180.000, 100.000'],
    ['0', '100.000, 100.000'],
    ['1', '180.000, 100.000'],
  ]) {
    await time.fill(seconds!);
    await expect(position).toHaveText(expected!);
  }
  await page.screenshot({ path: test.info().outputPath('scene-root-motion.png') });
  const tracks = page.getByLabel('Action tracks', { exact: true });
  await tracks.getByRole('button', { name: 'b', exact: true }).click();
  await expect(position).toHaveText('300.000, 100.000');
  await tracks.getByRole('button', { name: 'a', exact: true }).click();
  await time.fill('0.5');
  await page.getByRole('combobox', { name: 'Action type', exact: true }).selectOption('move');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Conflicting');
  await expect(page.getByRole('button', { name: /a: move action-/ })).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene JSON' }).click();
  const download = await downloading;
  const json = await readFile(await download.path(), 'utf8');
  expect(parseSceneJson(json).actions[0]).toMatchObject({ movementSource: 'rootMotion' });
  await upload(json);
  await page.getByLabel('Action tracks', { exact: true }).getByRole('button', { name: 'a', exact: true }).click();
  const runtime = page
    .locator('details')
    .filter({ has: page.locator('summary').getByText('Runtime preview', { exact: true }) });
  if (!(await runtime.evaluate((element) => (element as HTMLDetailsElement).open)))
    await runtime.locator('summary').click();
  await time.fill('2');
  await expect(position).toHaveText('180.000, 100.000');
  await page.getByRole('button', { name: 'a: animation idle', exact: true }).click();
  const properties = page
    .locator('details')
    .filter({ has: page.locator('summary').getByText('Action properties · animation', { exact: true }) });
  if (!(await properties.evaluate((element) => (element as HTMLDetailsElement).open)))
    await properties.locator('summary').click();
  await expect(
    page.getByRole('combobox', { name: 'Movement source', exact: true }).locator('option[value="rootMotion"]'),
  ).toHaveAttribute('disabled', '');
  await expect(page.getByText(/This animation has no root-motion translation keys/)).toBeVisible();
  expect(errors).toEqual([]);
});
