import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { sceneInspectorGroup, test, waitForPreviewPaint } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

test('dialogue hold preview animates idle pixels, freezes scene time and supports authored hold audio', async ({
  page,
}) => {
  const scene = parseSceneJson(
    await readFile(new URL('../../public/scenes/dialogue.scene.json', import.meta.url), 'utf8'),
  );
  scene.dialogue = [
    { id: 'hold', text: 'Read at your own pace.', time: 0, duration: 0, progression: 'advance-required' },
  ];
  await page.goto('scene-editor/');
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'hold-presentation.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(scene)),
  });
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await sceneInspectorGroup(page, 'Actors');
  await page.getByText('Scene actors (2)', { exact: true }).click();
  await page.locator('.scene-actor-list button').first().click();
  await page.getByText('Actor properties', { exact: true }).click();
  await page.getByLabel('Dialogue hold idle').selectOption('idle');
  await page.getByText('Runtime preview', { exact: true }).click();
  await sceneInspectorGroup(page, 'Audio');
  await page.getByRole('button', { name: 'Audio clip Preview chord music-bed', exact: true }).click();
  await page.getByText('Audio clip · Preview chord', { exact: true }).click();
  await page.getByLabel('Audio playback', { exact: true }).selectOption('dialogue-hold');
  await expect(page.getByLabel('Loop', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Apply audio clip properties', exact: true }).click();
  await sceneInspectorGroup(page, 'Actors');
  await page.locator('.scene-actor-list button').first().click();
  await play.click();
  await expect(page.getByRole('button', { name: 'Advance dialogue', exact: true })).toBeVisible();
  const time = page.getByLabel('Playhead (s)', { exact: true });
  await expect(time).toHaveValue('0');
  const observation = page
    .locator('details')
    .filter({ has: page.locator(':scope > summary', { hasText: 'Runtime preview' }) });
  await expect(observation).toContainText('Hold elapsed');
  const canvas = page.locator('#scene-stage-canvas canvas');
  await waitForPreviewPaint(page);
  const moving = await canvas.screenshot();
  await page.waitForTimeout(300);
  expect(Buffer.compare(moving, await canvas.screenshot())).not.toBe(0);
  await expect(time).toHaveValue('0');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await waitForPreviewPaint(page);
  const paused = await canvas.screenshot();
  await page.waitForTimeout(150);
  expect(Buffer.compare(paused, await canvas.screenshot())).toBe(0);
  await play.click();
  await page.getByRole('button', { name: 'Advance dialogue', exact: true }).click();
  await expect.poll(async () => Number(await time.inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(observation).not.toContainText('Hold elapsed');
  await time.fill('0.1');
  await time.fill('0'); // Passive point-hold sampling never starts a local session.
  await expect(page.getByRole('button', { name: 'Advance dialogue', exact: true })).toHaveCount(0);
  await expect(observation).not.toContainText('Hold elapsed');
});
