import { readFile } from 'node:fs/promises';
import { expect, type Frame, type Page } from '@playwright/test';
import { importProjectPackage } from '../../src/devtools/project/projectPackage.js';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationFileAction, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

async function editor(page: Page, name = 'Animation Editor') {
  await page.getByRole('button', { name, exact: true }).click();
  const frame = await (await page.locator('iframe:visible').elementHandle())?.contentFrame();
  if (!frame) throw new Error('Missing project editor');
  await expect(frame.locator('canvas').first()).toBeVisible();
  return frame;
}
async function reveal(frame: Frame, selector: string) {
  const control = frame.locator(selector).first();
  for (const details of await control.locator('xpath=ancestor::details').all()) {
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
      await details.locator(':scope > summary').click();
  }
  if (await control.evaluate((node) => node instanceof HTMLDetailsElement && !node.open))
    await control.locator(':scope > summary').click();
  return control;
}
async function selectBone(frame: Frame, id: string) {
  await reveal(frame, '#animation-bones');
  const bone = frame.locator('#animation-bones').getByRole('button', { name: id, exact: true });
  if ((await bone.getAttribute('aria-pressed')) !== 'true') await bone.click();
}
async function key(frame: Frame, time: string, value: string) {
  await frame.locator('#timeline-time-input').fill(time);
  await frame.locator('#timeline-time-input').press('Enter');
  await frame.locator('#animation-bone-fields input[data-property="x"]').fill(value);
  await frame.getByRole('button', { name: 'Set X key', exact: true }).click();
}
async function tool(frame: Frame, title: string) {
  await frame.locator('#animation-authoring-tools > summary').click();
  await frame.getByRole('button', { name: `${title}…`, exact: true }).click();
  return frame.getByRole('region', { name: title, exact: true });
}
async function json(page: Page, frame: Frame) {
  const log = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
  await frame.locator('#animation-tools-open').click();
  await frame.locator('#animation-log-json').click();
  const clip = animationFileSchema.parse(JSON.parse((await log).text()));
  await frame.locator('#animation-tools-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  return clip;
}

test('complete v1.1 React workflow: project, poses, graph, variation, cleanup, recovery, export and scene', async ({
  page,
}) => {
  test.setTimeout(240_000);
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'New Project', exact: true });
  await project.getByLabel('Project name').fill('Advanced authoring');
  await project.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.getByRole('combobox', { name: 'Existing character', exact: true }).selectOption('demo-puppet');
  await page.getByRole('button', { name: 'Add Existing Character', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Existing character registered');
  let frame = await editor(page);
  await expect(frame.locator('#animation-inspector details[open]')).toHaveCount(0);
  await frame.locator('#animation-new').click();
  const create = frame.getByRole('dialog', { name: 'Create new animation', exact: true });
  await create.getByLabel('Animation name / ID').fill('wave');
  await create.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await selectBone(frame, 'head');
  await key(frame, '0', '0');
  await key(frame, '0.5', '5');
  let poses = await tool(frame, 'Pose Library');
  await poses.getByLabel('Pose name', { exact: true }).fill('Middle head');
  await poses.getByLabel('Save scope').selectOption('selected');
  await poses.getByRole('button', { name: 'Save Current Pose', exact: true }).click();
  await poses.getByRole('button', { name: 'Close', exact: true }).click();
  await key(frame, '1', '10');
  await frame.locator('#timeline-time-input').fill('0.75');
  await frame.locator('#timeline-time-input').press('Enter');
  poses = await tool(frame, 'Pose Library');
  await poses.getByRole('button', { name: 'Preview', exact: true }).click();
  await poses.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  await poses.getByRole('button', { name: 'Apply Pose', exact: true }).click();
  await poses.getByRole('button', { name: 'Close', exact: true }).click();
  await key(frame, '0.75', '7.5');
  await selectBone(frame, 'root');
  await key(frame, '0', '0');
  await key(frame, '1', '20');
  await frame.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await frame.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).click();
  await frame.locator('#graph-toggle').click();
  await frame.locator('#graph-interpolation').selectOption('bezier');
  await expect(frame.locator('.graph-handle')).toHaveCount(2);
  await frame.locator('.graph-tangent-details > summary').click();
  await frame.getByLabel('Outgoing progress', { exact: true }).fill('0.2');
  await frame.getByRole('button', { name: 'Apply handles', exact: true }).click();
  const source = await json(page, frame);
  await frame.locator('#play-pause').click();
  await expect(frame.locator('#play-pause')).toHaveAttribute('aria-label', 'Pause');
  await frame.locator('#play-pause').click();
  await frame.locator('#animation-variation').click();
  let variation = frame.locator('#animation-variation-dialog');
  await variation.getByLabel('Time scale', { exact: true }).fill('2');
  await variation.getByLabel('Preview position').fill('0.75');
  await frame.locator('body').press('Escape');
  expect(await json(page, frame)).toEqual(source);
  await frame.locator('#animation-variation').click();
  variation = frame.locator('#animation-variation-dialog');
  await variation.getByLabel('New name / ID').fill('wave-soft');
  await variation.getByLabel('Time scale', { exact: true }).fill('2');
  await variation.getByRole('button', { name: 'Create Variation', exact: true }).click();
  await expect(frame.locator('#animation-selection')).toHaveValue('wave-soft');
  await expect(frame.locator('#animation-undo')).toBeDisabled();
  // Variations clear shared selection; explicitly select the source property in the retained graph.
  await selectBone(frame, 'root');
  await frame.locator('#graph-property').selectOption('x');
  await frame.locator('.graph-key').first().click();
  await frame.locator('#graph-key-value').fill('2');
  await frame.locator('#graph-apply').click();
  const before = await json(page, frame);
  let diagnostics = await tool(frame, 'Motion Diagnostics');
  await diagnostics.getByRole('button', { name: 'Run diagnostics', exact: true }).click();
  await expect(diagnostics).toContainText('Potentially redundant property keys (2)');
  await diagnostics.getByRole('button', { name: 'Preview Cleanup', exact: true }).click();
  await diagnostics.getByLabel('Comparison time (s)').fill('1.5');
  await diagnostics.getByRole('button', { name: 'Before', exact: true }).click();
  await diagnostics.getByRole('button', { name: 'After', exact: true }).click();
  await diagnostics.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  await diagnostics.getByRole('button', { name: 'Close Motion Diagnostics', exact: true }).click();
  expect(await json(page, frame)).toEqual(before);
  diagnostics = await tool(frame, 'Motion Diagnostics');
  await diagnostics.getByRole('button', { name: 'Preview Cleanup', exact: true }).click();
  await diagnostics.getByRole('button', { name: 'Apply Cleanup', exact: true }).click();
  await diagnostics.getByRole('button', { name: 'Close Motion Diagnostics', exact: true }).click();
  const cleaned = await json(page, frame);
  expect(cleaned.tracks.head!.filter((entry) => entry.x !== undefined)).toHaveLength(2);
  await frame.locator('#animation-undo').click();
  expect(await json(page, frame)).toEqual(before);
  await frame.locator('#animation-redo').click();
  expect(await json(page, frame)).toEqual(cleaned);
  await frame.locator('#animation-selection').selectOption('wave');
  expect(await json(page, frame)).toEqual(source);
  await frame.locator('#animation-selection').selectOption('wave-soft');
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await recovery.getByRole('button', { name: 'Recover Draft', exact: true }).click();
  frame = await editor(page);
  await frame.locator('#animation-selection').selectOption('wave-soft');
  expect(await json(page, frame)).toEqual(cleaned);
  poses = await tool(frame, 'Pose Library');
  await expect(poses.getByRole('button', { name: 'Middle head 1 bones', exact: true })).toBeVisible();
  await poses.getByRole('button', { name: 'Close', exact: true }).click();
  const download = page.waitForEvent('download');
  await frame.locator('#animation-download').click();
  const bytes = await readFile(await (await download).path());
  await frame.locator('#animation-tools-open').click();
  await frame
    .locator('#animation-import-file')
    .setInputFiles({ name: 'wave-soft.json', mimeType: 'application/json', buffer: bytes });
  await frame.locator('#animation-tools-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  expect(await json(page, frame)).toEqual(cleaned);
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const scene = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await scene.getByLabel('Scene name').fill('Wave scene');
  await scene.getByRole('button', { name: 'Create Scene', exact: true }).click();
  frame = await editor(page, 'Scene Editor');
  await frame.getByRole('button', { name: '+ Add Actor', exact: true }).click();
  await frame
    .getByRole('dialog', { name: 'Add Actor', exact: true })
    .getByRole('button', { name: 'Add actor', exact: true })
    .click();
  await frame.getByRole('combobox', { name: 'Action type', exact: true }).selectOption('animation');
  await frame.getByRole('button', { name: 'Add action', exact: true }).click();
  await reveal(frame, '[data-guide-id="scene-action-properties"]');
  await frame.getByRole('combobox', { name: 'Animation ID', exact: true }).selectOption('wave-soft');
  await frame.getByLabel('Action duration (seconds)', { exact: true }).fill('2');
  await frame.getByRole('button', { name: 'Apply action properties', exact: true }).click();
  await frame.getByLabel('Playhead (s)', { exact: true }).fill('0.5');
  await frame.getByRole('button', { name: 'Play', exact: true }).click();
  await frame.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('advanced-authoring-scene.png') });
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const restored = await importProjectPackage(decodePackageZip(await readFile(await (await projectDownload).path())));
  expect(
    restored.character('demo-puppet').definition.animations.find(({ name }) => name === 'wave-soft'),
  ).toMatchObject({ name: 'wave-soft', tracks: cleaned.tracks });
  expect(restored.scenes.scene(restored.scenes.sceneIds[0]!)!.actions[0]).toMatchObject({
    type: 'animation',
    animation: 'wave-soft',
    duration: 2000,
  });
});

for (const id of ['animation-bezier-handles', 'animation-motion-diagnostics', 'animation-motion-cleanup']) {
  test(`read-only real-control guide: ${id}`, async ({ page }) => {
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    const readJson = async () => {
      const log = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
      await animationFileAction(page, '#animation-log-json', (button) => button.click());
      return (await log).text();
    };
    const before = await readJson();
    const guide = guideRegistry.getGuideById(id)!;
    await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
    await page.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
    const tour = page.getByRole('dialog', { name: guide.title, exact: true });
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour).toContainText(`Step ${index + 1} of ${guide.steps.length}`);
      await expect(page.locator(`[data-guide-id="${step.targetId}"]`)).toBeVisible();
      await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
      await expect(tour.getByRole('status')).toHaveCount(0);
      if (index === 1) {
        await tour.getByRole('button', { name: 'Back', exact: true }).click();
        await tour.getByRole('button', { name: 'Next', exact: true }).click();
      }
      await tour
        .getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true })
        .click();
    }
    await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
    await expect(page.locator('#animation-undo')).toBeDisabled();
    await expect(page.getByRole('heading', { name: /^Potentially redundant/ })).toHaveCount(0);
    expect(await readJson()).toBe(before);
  });
}
