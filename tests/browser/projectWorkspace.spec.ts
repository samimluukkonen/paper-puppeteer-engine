import { readFile } from 'node:fs/promises';
import { expect, type Frame, type Page } from '@playwright/test';
import { sceneInspectorGroup, inspectorControl, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

async function activeEditor(page: Page): Promise<Frame> {
  const host = page.locator('iframe:visible');
  await expect(host).toHaveCount(1);
  const element = await host.elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error('Editor host has no frame.');
  await frame.waitForURL(/projectSession=/);
  return frame;
}

async function reveal(frame: Frame, selector: string) {
  return (await inspectorControl(frame, selector)).first();
}

test('project scene authoring rejects missing animation dependencies atomically and keeps project exports valid', async ({
  page,
}) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name').fill('Validation Film');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const character = page.getByRole('dialog', { name: 'New Character', exact: true });
  await character.getByLabel('Character name').fill('Hero');
  await character.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(character).not.toBeVisible();
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const scene = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await scene.getByLabel('Scene name').fill('Training');
  await scene.getByRole('button', { name: 'Create Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const frame = await activeEditor(page);
  await (await inspectorControl(frame, '[data-guide-id="scene-add-actor"]')).click();
  await frame
    .getByRole('dialog', { name: 'Add Actor', exact: true })
    .getByRole('button', { name: 'Add actor', exact: true })
    .click();
  await expect(frame.locator('#scene-stage-canvas canvas')).toBeVisible();
  // Public authoring commands now reject unavailable dependencies before they enter history.
  const token = new URL(frame.url()).searchParams.get('projectSession')!;
  await page.evaluate((token) => {
    const document = window.paperProjectEditor?.(token)?.scenes;
    if (!document) throw new Error('Scene document is unavailable.');
    const before = document.workingScene;
    const history = [document.canUndo, document.canRedo];
    if (document.setActorAppearance('actor-1', 'animation', 'missing-wave'))
      throw new Error('An unavailable animation was accepted.');
    if (document.workingScene !== before || document.canUndo !== history[0] || document.canRedo !== history[1])
      throw new Error('Rejected dependency changed the scene or its history.');
  }, token);
  await expect(frame.getByRole('alert')).toContainText('Unknown animation "missing-wave"');
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await page.getByRole('button', { name: 'Validate Project', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Project validation', exact: true });
  await expect(panel).toContainText('No problems found');
  await expect(panel).toContainText('0 Errors');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.zip$/);
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const reopened = await activeEditor(page);
  const reopenedToken = new URL(reopened.url()).searchParams.get('projectSession')!;
  await page.evaluate((token) => {
    if (!window.paperProjectEditor?.(token)?.scenes?.undo()) throw new Error('Undo failed.');
  }, reopenedToken);
  await reopened.getByRole('button', { name: '← Project', exact: true }).click();
  await expect(panel).toContainText('No problems found');
  await panel.getByRole('button', { name: 'Revalidate', exact: true }).click();
  await expect(panel).toContainText('0 Errors');
});

test('project authoring retains editor owners, switches projects and round trips the exported ZIP', async ({
  page,
}) => {
  const zipWorkers: string[] = [];
  page.on('worker', (worker) => {
    if (worker.url().includes('packageZip.worker')) zipWorkers.push(worker.url());
  });
  await page.goto('project/');
  const createProject = async (name: string) => {
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
    await dialog.getByLabel('Project name').fill(name);
    await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
  };
  await createProject('First Film');
  await expect(
    page.getByText('No characters. Create an empty character or register an existing package.'),
  ).toBeVisible();
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const character = page.getByRole('dialog', { name: 'New Character', exact: true });
  await character.getByLabel('Character name').fill('Hero');
  await character.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(character).not.toBeVisible();
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  await expect(page.locator('iframe:visible')).toHaveCount(1);
  const frame = await activeEditor(page);
  await expect(frame.locator('#validation')).toHaveText('Validation: OK');
  await expect(frame.locator('#rig-inspector details[open]')).toHaveCount(0);
  await reveal(frame, '#hierarchy');
  const root = frame.getByRole('treeitem', { name: 'root', exact: true });
  if ((await root.getAttribute('aria-selected')) !== 'true') await root.click();
  const x = await reveal(frame, '#inspector [data-scope=bone][data-field=x]');
  await x.fill('42');
  await x.blur();
  await frame.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await frame.getByRole('button', { name: '+ New Animation', exact: true }).click();
  const animation = frame.getByRole('dialog', { name: 'Create new animation', exact: true });
  await animation.getByLabel('Animation name / ID').fill('wave');
  await animation.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await expect(page.getByText('hero · Document modified')).toBeVisible();
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const scene = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await scene.getByLabel('Scene name').fill('Opening');
  await scene.getByRole('button', { name: 'Create Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  await expect(page.locator('iframe:visible')).toHaveCount(1);
  const sceneFrame = await activeEditor(page);
  await expect(sceneFrame.locator('.scene-inspector details[open]')).toHaveCount(0);
  await (await inspectorControl(sceneFrame, '[data-guide-id="scene-add-actor"]')).click();
  await sceneFrame
    .getByRole('dialog', { name: 'Add Actor', exact: true })
    .getByRole('button', { name: 'Add actor', exact: true })
    .click();
  await expect(sceneFrame.locator('#scene-stage-canvas canvas')).toBeVisible();
  await sceneFrame.getByText('Actor properties', { exact: true }).click();
  await expect(sceneFrame.getByRole('combobox', { name: 'Initial animation', exact: true })).toContainText('wave');
  await expect(sceneFrame.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await sceneFrame.getByRole('button', { name: '← Project', exact: true }).click();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const reopened = await activeEditor(page);
  await expect(reopened.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await sceneInspectorGroup(reopened, 'Actors');
  await reopened.getByText('Scene actors (1)', { exact: true }).click();
  await expect(reopened.getByRole('button', { name: /^actor-1 →/ })).toBeVisible();
  await reopened.getByRole('button', { name: '← Project', exact: true }).click();
  await page
    .locator('.project-assets li')
    .filter({ has: page.getByText('Hero', { exact: true }) })
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Character is used by scenes');
  await createProject('Other Film');
  await expect(
    page.getByText('No characters. Create an empty character or register an existing package.'),
  ).toBeVisible();
  await page.getByLabel('Select project').selectOption({ label: 'First Film' });
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  await expect(frame.locator('#inspector [data-scope=bone][data-field=x]')).toHaveValue('42');
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const download = await downloadPromise;
  expect(zipWorkers.length).toBeGreaterThanOrEqual(1);
  const bytes = await readFile(await download.path());
  await page
    .getByLabel('Import Project', { exact: true })
    .setInputFiles({ name: 'film.project.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.getByLabel('Select project').locator('option')).toHaveCount(4);
  await expect(page.getByText('Project metadata: Exported', { exact: true })).toBeVisible();
  expect(zipWorkers.length).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  const imported = await activeEditor(page);
  await expect(imported.locator('#validation')).toHaveText('Validation: OK');
  await reveal(imported, '#hierarchy');
  const importedRoot = imported.getByRole('treeitem', { name: 'root', exact: true });
  if ((await importedRoot.getAttribute('aria-selected')) !== 'true') await importedRoot.click();
  await expect(await reveal(imported, '#inspector [data-scope=bone][data-field=x]')).toHaveValue('42');
});

test('shipped artwork loads from project packages and imported scene dependencies map explicitly', async ({ page }) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name').fill('Artwork Film');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.getByRole('combobox', { name: 'Existing character', exact: true }).selectOption('demo-puppet');
  await page.getByRole('button', { name: 'Add Existing Character', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Existing character registered');
  await page.getByRole('button', { name: 'Add Existing Character', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Duplicate characters ID');
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  const character = await activeEditor(page);
  await expect(character.locator('#validation')).toHaveText('Validation: OK');
  await expect(character.locator('#editor-stage canvas')).toBeVisible();
  await character.getByRole('link', { name: 'Paper Puppeteer Engine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Artwork Film', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Existing character', exact: true }).selectOption('random-paperdoll-sketch');
  await page.getByRole('button', { name: 'Add Existing Character', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Existing character registered');
  const scene = {
    version: 2,
    id: 'encounter',
    name: 'Encounter',
    duration: 1000,
    actors: [
      { id: 'hero', character: { manifest: 'external/hero/character.json' }, position: { x: -100, y: 0 } },
      { id: 'friend', character: { manifest: 'external/friend/character.json' }, position: { x: 100, y: 0 } },
    ],
    actions: [],
  };
  await page.getByLabel('Import Scene JSON', { exact: true }).setInputFiles({
    name: 'encounter.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(scene)),
  });
  const mapping = page.getByRole('dialog', { name: 'Register scene dependencies', exact: true });
  await mapping
    .getByRole('combobox', { name: 'external/hero/character.json', exact: true })
    .selectOption('demo-puppet');
  await mapping
    .getByRole('combobox', { name: 'external/friend/character.json', exact: true })
    .selectOption('random-paperdoll-sketch');
  await mapping.getByRole('button', { name: 'Import Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const editor = await activeEditor(page);
  await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: 'Play', exact: true }).click();
  await editor.getByRole('button', { name: 'Stop', exact: true }).click();
  await editor.getByRole('button', { name: '← Project', exact: true }).click();
  await expect(page.getByText('Encounter', { exact: true })).toBeVisible();
});
