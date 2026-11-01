import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { createEmptyScene, parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { validateStoryPackage } from '../../src/engine/StoryPackage.js';
import { sceneInspectorGroup, test } from './fixtures.js';

test('artist assembles, previews, advances, restarts and round trips a linear story', async ({ page }, info) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'New Project', exact: true });
  await project.getByLabel('Project name').fill('Story film');
  await project.getByRole('button', { name: 'Create Project', exact: true }).click();
  for (const id of ['forest', 'meeting']) {
    const scene = createEmptyScene({ id, name: id, duration: 400 });
    scene.dialogue = [
      { id: '01-first', text: `${id} first`, time: 0, duration: 0, progression: 'advance-required' },
      { id: '02-second', text: `${id} second`, time: 0, duration: 0, progression: 'advance-required' },
    ];
    await page
      .getByLabel('Import Scene JSON')
      .setInputFiles({ name: `${id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) });
    await expect(page.locator('[data-guide-id="project-scenes"]')).toContainText(id);
  }
  const panel = page.getByRole('region', { name: 'Story Sequence', exact: true });
  await panel.getByRole('button', { name: 'New Story', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Story', exact: true });
  await create.getByLabel('New story name').fill('The encounter');
  await create.getByRole('button', { name: 'Create Story', exact: true }).click();
  await panel.getByLabel('Story scene').selectOption('forest');
  await panel.getByRole('button', { name: 'Add Scene', exact: true }).click();
  await panel.getByLabel('Story scene').selectOption('meeting');
  await panel.getByRole('button', { name: 'Add Scene', exact: true }).click();
  const entries = panel.locator('.story-entries > li');
  await panel.getByRole('button', { name: 'Move entry 2 up', exact: true }).click();
  await expect(entries.first()).toContainText('meeting');
  await page.getByRole('button', { name: 'Undo Project', exact: true }).click();
  await expect(entries.first()).toContainText('forest');
  await entries.first().getByRole('button', { name: 'Duplicate entry', exact: true }).click();
  await expect(entries).toHaveCount(3);
  await entries.nth(1).getByRole('button', { name: 'Remove entry', exact: true }).click();
  await expect(entries).toHaveCount(2);
  await expect(page.locator('[data-guide-id="project-scenes"] .project-assets > li')).toHaveCount(2);
  await panel.getByLabel('Entry 2 transition', { exact: true }).selectOption('fade');
  await panel.getByLabel('Entry 2 fade color', { exact: true }).fill('#123456');
  const storyDownloading = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download story package', exact: true }).click();
  const storyDownload = await storyDownloading;
  const storyPath = info.outputPath('film.story.zip');
  await storyDownload.saveAs(storyPath);
  const portable = await validateStoryPackage(decodePackageZip(new Uint8Array(await readFile(storyPath))));
  expect(portable.definition.scenes[1]!.transition).toEqual({ type: 'fade', duration: 600, color: '#123456' });
  await panel.getByRole('button', { name: 'Preview Entire Story', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Entire story preview', exact: true });
  const status = preview.getByRole('status');
  await expect(status).toContainText('Scene 1 of 2: forest');
  await expect(status).toContainText('Wait for Enter');
  await expect(preview.locator('.story-preview-dialogue')).toHaveText('forest first');
  await preview.screenshot({ path: info.outputPath('story-preview.png') });
  await preview.getByRole('group', { name: 'Story preview canvas' }).focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter'); // A repeated keydown must not consume the next line.
  await expect(preview.locator('.story-preview-dialogue')).toHaveText('forest second');
  await page.keyboard.up('Enter');
  await page.keyboard.press('Enter');
  await expect(status).toContainText('Scene 2 of 2: meeting');
  await expect(preview.locator('.story-preview-dialogue')).toHaveText('meeting first');
  await preview.getByRole('button', { name: 'Advance dialogue (Enter)', exact: true }).click();
  await expect(preview.locator('.story-preview-dialogue')).toHaveText('meeting second');
  await preview.getByRole('button', { name: 'Advance dialogue (Enter)', exact: true }).click();
  await expect(status).toContainText('completed');
  await preview.getByRole('button', { name: 'Restart story', exact: true }).click();
  await expect(preview.locator('.story-preview-dialogue')).toHaveText('forest first');
  await preview.getByRole('button', { name: 'Stop story', exact: true }).click();
  await expect(status).toContainText('stopped');
  await expect(preview.locator('canvas')).toHaveCount(1);
  await preview.getByRole('button', { name: 'Close preview', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.story-preview-canvas canvas')).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const download = await downloading;
  const path = info.outputPath('story.project.zip');
  await download.saveAs(path);
  await page.getByLabel('Import Project', { exact: true }).setInputFiles(path);
  await expect(page.getByLabel('Select project')).toHaveValue(/.+/);
  await expect(panel.getByLabel('Select story')).toContainText('The encounter');
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText('forest');
  await expect(panel.getByLabel('Entry 2 transition', { exact: true })).toHaveValue('fade');
});

test('dialogue inspector authors progression and idle with Enter markers and passive scrubbing', async ({ page }) => {
  const scene = parseSceneJson(
    await readFile(new URL('../../public/scenes/dialogue.scene.json', import.meta.url), 'utf8'),
  );
  scene.dialogue = [{ id: 'hold', actorId: scene.actors[0]!.id, text: 'Wait here', time: 0, duration: 1000 }];
  await page.goto('scene-editor/');
  await page
    .getByLabel('Open scene JSON')
    .setInputFiles({ name: 'hold.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^Dialogue hold:/ }).click();
  await sceneInspectorGroup(page, 'Dialogue');
  await page.getByText('Dialogue line · hold', { exact: true }).click();
  await page.getByLabel('Dialogue progression').selectOption('advance-required');
  const idle = page.getByLabel('Actor idle during holds', { exact: true });
  await expect(idle).toBeEnabled();
  await idle.selectOption('idle');
  await page.getByRole('button', { name: 'Apply dialogue properties', exact: true }).click();
  await expect(page.getByRole('button', { name: /Dialogue hold:.*Wait for Enter/ })).toContainText('Enter · 1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance dialogue', exact: true })).toBeVisible();
  await page.locator('#scene-stage-canvas canvas').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Advance dialogue', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  // The ordinary playhead remains usable after leaving an interactive hold.
  await page.getByLabel('Playhead (s)', { exact: true }).fill('0');
  await expect(page.getByRole('button', { name: 'Advance dialogue', exact: true })).toHaveCount(0);
});
