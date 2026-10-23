import { readFile, writeFile } from 'node:fs/promises';
import { expect, type Frame, type Page } from '@playwright/test';
import { buildProjectPackage, importProjectPackage } from '../../src/devtools/project/projectPackage.js';
import { loadPackageDefinition } from '../../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

async function editor(page: Page, name: string): Promise<Frame> {
  await page.getByRole('button', { name, exact: true }).click();
  const frame = await (await page.locator('iframe:visible').elementHandle())?.contentFrame();
  if (!frame) throw new Error('Missing project editor frame.');
  await expect(frame.locator('canvas').first()).toBeVisible();
  return frame;
}

async function reveal(frame: Frame, selector: string) {
  const control = frame.locator(selector).first();
  await control.waitFor({ state: 'attached' });
  for (const details of await control.locator('xpath=ancestor::details').all()) {
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
      await details.locator(':scope > summary').click();
  }
  return control;
}

async function selectBone(frame: Frame, id: string) {
  await reveal(frame, '#hierarchy');
  const bone = frame.getByRole('treeitem', { name: id, exact: true });
  if ((await bone.getAttribute('aria-selected')) !== 'true') await bone.click();
}

async function recover(page: Page) {
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await dialog.getByRole('button', { name: 'Recover Draft', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('personal production: new project and artwork → rig/IK/keys → scene → recovery → portable round trip', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'New Project', exact: true });
  await project.getByLabel('Project name').fill('Production Film');
  await project.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const character = page.getByRole('dialog', { name: 'New Character', exact: true });
  await character.getByLabel('Character name').fill('Paper Arm');
  await character.getByRole('button', { name: 'Create Character', exact: true }).click();

  let frame = await editor(page, 'Rig Editor');
  await expect(frame.locator('#rig-inspector details[open]')).toHaveCount(0);
  await selectBone(frame, 'root');
  const skeleton = frame.getByRole('region', { name: 'Build skeleton', exact: true });
  for (const id of ['segment', 'tip']) {
    await skeleton.getByLabel('New bone ID', { exact: true }).fill(id);
    await skeleton.getByRole('button', { name: '+ Add Bone', exact: true }).click();
    const y = await reveal(frame, '#inspector [data-scope=bone][data-field=y]');
    await y.fill('40');
    await y.blur();
  }
  await recover(page); // Refresh during committed rig editing.
  frame = await editor(page, 'Rig Editor');
  await selectBone(frame, 'segment');
  await expect(await reveal(frame, '#inspector [data-scope=bone][data-field=y]')).toHaveValue('40');
  const build = frame.getByRole('region', { name: 'Build skeleton', exact: true });
  await build.getByLabel('New slot ID', { exact: true }).fill('arm-visual');
  await build.getByRole('button', { name: '+ Add Slot', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 48;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ac2345';
    context.fillRect(8, 4, 16, 40);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  const artwork = frame.locator('#editor-app #artwork-panel');
  await reveal(frame, '#editor-app #artwork-panel input[type=file]');
  await artwork.getByLabel('Import new artwork', { exact: true }).setInputFiles({
    name: 'arm.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(artwork).toContainText('Artwork added to the library.');
  await reveal(frame, '#editor-app #attachment-panel select');
  const attachments = frame.locator('#editor-app #attachment-panel');
  await attachments.getByLabel('Attachment ID', { exact: true }).fill('arm-art');
  await attachments.getByRole('button', { name: 'Create attachment', exact: true }).click();
  await attachments.getByLabel('Assigned attachment', { exact: true }).selectOption('arm-art');
  const origin = frame.locator('#inspector [data-scope=attachment][data-field=originY]').first();
  await origin.fill('0.1');
  await origin.blur();
  await recover(page); // Applied binary artwork and skin assignment must survive.
  frame = await editor(page, 'Rig Editor');
  await selectBone(frame, '◇ arm-visual');
  await expect(await reveal(frame, '#inspector [data-scope=attachment][data-field=originY]')).toHaveValue('0.1');
  const ik = await reveal(frame, '#rig-inspector section[aria-label="IK constraints"]');
  await ik.getByRole('button', { name: '+ Add IK Constraint', exact: true }).click();
  await ik.getByLabel('Constraint name', { exact: true }).fill('armIK');
  await ik.getByRole('button', { name: 'Create IK Constraint', exact: true }).click();
  await expect(ik.getByLabel('End bone', { exact: true })).toHaveValue('tip');
  await frame.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await frame.locator('#animation-new').click();
  const animation = frame.getByRole('dialog', { name: 'Create new animation', exact: true });
  await animation.getByLabel('Animation name / ID').fill('reach');
  await animation.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await reveal(frame, '#animation-bones');
  await frame.locator('#animation-bones').getByRole('button', { name: 'tip', exact: true }).click();
  for (const [time, rotation] of [
    ['0', '0'],
    ['0.5', '30'],
    ['1', '0'],
  ]) {
    await frame.locator('#timeline-time-input').fill(time!);
    await frame.locator('#timeline-time-input').press('Enter');
    await (await reveal(frame, '#animation-bone-fields input[data-property=rotation]')).fill(rotation!);
    await frame.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  }
  await frame.getByRole('button', { name: 'Select IK target armIK', exact: true }).click();
  await reveal(frame, '#animation-ik-inspector fieldset');
  const target = frame.locator('#animation-ik-inspector');
  for (const [time, x] of [
    ['0', '20'],
    ['1', '-20'],
  ]) {
    await frame.locator('#timeline-time-input').fill(time!);
    await frame.locator('#timeline-time-input').press('Enter');
    await target.locator('[data-ik-property=x]').fill(x!);
    await target.locator('[data-ik-property=y]').fill('60');
    await target.getByRole('button', { name: 'Set Target Key', exact: true }).click();
  }
  await frame.locator('#animation-undo').click();
  await frame.locator('#animation-redo').click();
  await frame.locator('#play-pause').click();
  await expect(frame.locator('#play-pause')).toHaveAttribute('aria-label', 'Pause');
  await frame.locator('#play-pause').click();
  await recover(page); // Refresh after bone and IK key authoring.
  frame = await editor(page, 'Animation Editor');
  await expect(frame.locator('#animation-selection')).toHaveValue('reach');
  const packages = frame.locator('.package-tools:visible');
  await packages.locator(':scope > summary').click();
  const characterDownload = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const characterFiles = decodePackageZip(await readFile(await (await characterDownload).path()));
  const definition = await loadPackageDefinition(characterFiles);
  expect(definition.rig.ik?.[0]?.name).toBe('armIK');
  expect(definition.animations[0]?.ikTracks?.armIK).toHaveLength(2);
  expect(definition.animations[0]?.tracks.tip).toHaveLength(3);
  expect(definition.rig.skins[0]?.slots['arm-visual']).toBe('arm-art');
  expect(Buffer.from(characterFiles.get('images/arm.png')!)).toEqual(Buffer.from(png, 'base64'));
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await page.getByRole('combobox', { name: 'Existing character', exact: true }).selectOption('demo-puppet');
  await page.getByRole('button', { name: 'Add Existing Character', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Existing character registered');
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const scene = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await scene.getByLabel('Scene name').fill('Production Opening');
  await scene.getByRole('button', { name: 'Create Scene', exact: true }).click();
  frame = await editor(page, 'Scene Editor');
  await expect(frame.locator('.scene-inspector details[open]')).toHaveCount(0);
  await frame.getByRole('button', { name: '+ Add Actor', exact: true }).click();
  await frame
    .getByRole('dialog', { name: 'Add Actor', exact: true })
    .getByRole('button', { name: 'Add actor', exact: true })
    .click();
  const properties = frame.locator('[data-guide-id="scene-action-properties"]');
  const addAction = async (kind: string, time: string) => {
    await frame.getByLabel('Playhead (s)', { exact: true }).fill(time);
    await frame.getByRole('combobox', { name: 'Action type', exact: true }).selectOption(kind);
    await frame.getByRole('button', { name: 'Add action', exact: true }).click();
    if (!(await properties.evaluate((node) => (node as HTMLDetailsElement).open)))
      await properties.locator('summary').click();
  };
  await addAction('move', '0');
  await frame.getByLabel('Destination X', { exact: true }).fill('120');
  await frame.getByLabel('Action duration (seconds)', { exact: true }).fill('1');
  await frame.getByRole('button', { name: 'Apply action properties', exact: true }).click();
  await addAction('animation', '0');
  await frame.getByRole('combobox', { name: 'Animation ID', exact: true }).selectOption('reach');
  await frame.getByLabel('Action duration (seconds)', { exact: true }).fill('1');
  await frame.getByRole('button', { name: 'Apply action properties', exact: true }).click();
  await addAction('cue', '1.5');
  await frame.getByLabel('Cue name', { exact: true }).fill('production-arrived');
  await frame.getByRole('button', { name: 'Apply action properties', exact: true }).click();
  await frame.getByLabel('Playhead (s)', { exact: true }).fill('0.5');
  await frame.getByRole('button', { name: 'Play', exact: true }).click();
  await frame.getByRole('button', { name: 'Stop', exact: true }).click();
  await recover(page); // Refresh during scene editing preserves action times and dependencies.
  frame = await editor(page, 'Scene Editor');
  await expect(frame.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  const sceneDownload = page.waitForEvent('download');
  await frame.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const sceneBytes = await readFile(await (await sceneDownload).path());
  const exportedScene = parseSceneJson(new TextDecoder().decode(decodePackageZip(sceneBytes).get('scene.json')));
  expect(exportedScene.actions.map(({ time }) => time)).toEqual([0, 0, 1500]);
  expect(exportedScene.actors[0]?.character.manifest).toContain('characters/');
  await writeFile(info.outputPath('production.scene.zip'), sceneBytes);
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const projectBytes = await readFile(await (await projectDownload).path());
  await writeFile(info.outputPath('production.project.zip'), projectBytes);
  const imported = await importProjectPackage(decodePackageZip(projectBytes));
  const again = await importProjectPackage((await buildProjectPackage(imported)).files);
  expect(again.definition).toEqual(imported.definition);
  expect(again.scenes.scene(exportedScene.id)).toEqual(exportedScene);
  for (const { id } of imported.definition.characters) {
    const before = imported.captureCharacter(id),
      after = again.captureCharacter(id);
    expect(after.rig).toEqual(before.rig);
    expect(after.skins).toEqual(before.skins);
    expect(after.animations).toEqual(before.animations);
    for (const path of Object.values(imported.character(id).definition.textures))
      expect(again.character(id).files.get(path)).toEqual(imported.character(id).files.get(path));
  }
  await page.getByLabel('Import Project', { exact: true }).setInputFiles({
    name: 'production.project.zip',
    mimeType: 'application/zip',
    buffer: projectBytes,
  });
  await expect(page.getByText('Project metadata: Exported', { exact: true })).toBeVisible();
  frame = await editor(page, 'Scene Editor');
  await expect(frame.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
