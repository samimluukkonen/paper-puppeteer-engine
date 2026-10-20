import { expect, test } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';

test('scene catalog gates empty selections and all eight tours resolve real controls without authoring', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('scene-editor/');
  const open = page.getByRole('button', { name: 'Feature Guide', exact: true });
  const catalog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await open.click();
  await expect(catalog.getByRole('button', { name: 'Start Guide: Creating a Scene', exact: true })).toBeEnabled();
  await expect(catalog.getByRole('button', { name: 'Start Guide: Adding an Actor', exact: true })).toBeDisabled();
  await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  const data = {
    version: 2,
    id: 'guided-scene',
    name: 'Guided scene',
    duration: 10000,
    actors: [
      {
        id: 'actor',
        character: { manifest: '../characters/demo-puppet/character.json' },
        position: { x: 0, y: 0 },
        animation: 'idle',
      },
    ],
    actions: [{ id: 'move', actorId: 'actor', type: 'move', time: 0, duration: 1000, destination: { x: 100, y: 0 } }],
  };
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'guide.scene.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByRole('button', { name: 'actor: move move', exact: true }).click();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  for (const guide of guideRegistry.getGuidesForEditor('scene')) {
    await open.click();
    await catalog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
    const tour = page.getByRole('dialog', { name: guide.title, exact: true });
    for (let index = 0; index < guide.steps.length; index++) {
      await expect(tour).toContainText(`Step ${index + 1} of ${guide.steps.length}`);
      await expect(tour.getByRole('heading', { name: guide.steps[index]!.title, exact: true })).toBeVisible();
      await expect(page.locator('.guide-spotlight-hole')).toBeVisible();
      await expect(tour).not.toContainText('Target unavailable');
      if (index + 1 < guide.steps.length) await tour.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await tour.getByRole('button', { name: 'Exit', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Scene playback status')).toContainText('stopped');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
  const download = await waiting;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual(data);
  expect(errors).toEqual([]);
});
