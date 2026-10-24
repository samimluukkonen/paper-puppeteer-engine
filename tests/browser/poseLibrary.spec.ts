import { readFile } from 'node:fs/promises';
import { expect, type Frame, type Page } from '@playwright/test';
import { buildProjectPackage } from '../../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../../src/devtools/project/ProjectWorkspace.js';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { packageJson } from '../../src/devtools/shared/package/characterPackage.js';
import { encodePackageZip, decodePackageZip } from '../../src/engine/packageZip.js';
import { characterManifestSchema, poseDefinitionSchema, animationFileSchema } from '../../src/engine/schemas.js';
import { selectAnimationBone, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

async function openLibrary(page: Page | Frame) {
  const panel = page.locator('#animation-pose-library-panel');
  if (!(await panel.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('#animation-authoring-tools > summary').click();
    await page.locator('#animation-pose-library-open').click();
  }
  return panel.getByRole('region', { name: 'Pose Library', exact: true });
}

async function createAnimation(page: Page, name: string) {
  await page.locator('#animation-new').click();
  const dialog = page.getByRole('dialog', { name: 'Create new animation', exact: true });
  await dialog.getByLabel('Animation name / ID', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await expect(page.locator('#animation-selection')).toHaveValue(name);
}

test('artist saves full and partial poses, searches, previews/cancels, applies across clips, undoes and reloads a project', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toBeEnabled();
  await expect(page.locator('#animation-pose-library-panel')).not.toHaveAttribute('open');
  await createAnimation(page, 'pose-source');
  await selectAnimationBone(page, 'head');
  await page.locator('#animation-bone-fields input[data-property="rotation"]').fill('35');
  await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  let library = await openLibrary(page);
  await library.getByLabel('Pose name', { exact: true }).fill('Sword ready');
  await library.getByRole('button', { name: 'Save Current Pose', exact: true }).click();
  await expect(library.getByRole('status')).toHaveText('Pose saved to the character library.');
  await expect(page.getByLabel('Package document status')).toContainText('Poses: Modified');
  await library.getByLabel('Save scope').selectOption('selected');
  await library.getByLabel('Pose name', { exact: true }).fill('Head only');
  await library.getByRole('button', { name: 'Save Current Pose', exact: true }).click();
  await expect(library.getByRole('button', { name: 'Head only 1 bones', exact: true })).toBeVisible();
  await library.getByLabel('Search poses').fill('sword');
  await expect(library.getByRole('list', { name: 'Saved poses' }).getByRole('button')).toHaveCount(1);
  await library.getByLabel('Search poses').fill('');
  await library.getByRole('button', { name: 'Rename', exact: true }).click();
  await library.getByLabel('New pose name').fill('Head tilt');
  await library.getByRole('button', { name: 'Save name', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await library.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(library.getByRole('button', { name: 'Head tilt 1 bones', exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await library.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(library.getByRole('button', { name: 'Head tilt 1 bones', exact: true })).toHaveCount(0);
  await library.getByRole('button', { name: 'Undo library edit', exact: true }).click();
  await expect(library.getByRole('button', { name: 'Head tilt 1 bones', exact: true })).toBeVisible();
  await library.getByRole('button', { name: 'Close', exact: true }).click();
  await createAnimation(page, 'pose-destination');
  await page.locator('#timeline-time-input').fill('0.375');
  await page.locator('#timeline-time-input').press('Enter');
  await page.locator('#animation-show-bones').uncheck();
  const canvas = page.locator('#animation-stage canvas');
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const baseline = await canvas.screenshot({ style: '.animation-pose-content { visibility: hidden !important; }' });
  const count = await page.locator('.timeline-keyframe').count();
  library = await openLibrary(page);
  await library.getByRole('button', { name: 'Head tilt 1 bones', exact: true }).click();
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await library.getByRole('button', { name: 'Preview', exact: true }).click();
  expect(
    (await canvas.screenshot({ style: '.animation-pose-content { visibility: hidden !important; }' })).equals(baseline),
  ).toBe(false);
  expect(await page.locator('.timeline-keyframe').count()).toBe(count);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await library.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  await expect
    .poll(async () =>
      (await canvas.screenshot({ style: '.animation-pose-content { visibility: hidden !important; }' })).equals(
        baseline,
      ),
    )
    .toBe(true);
  await library.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(library.getByRole('button', { name: 'Cancel preview', exact: true })).toBeDisabled();
  await library.getByRole('button', { name: 'Preview', exact: true }).click();
  await library.getByRole('button', { name: 'Apply Pose', exact: true }).click();
  await expect(library.getByRole('status')).toHaveText('Pose applied at the playhead as one animation edit.');
  await library.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#animation-undo')).toBeEnabled();
  await page.locator('#animation-undo').click();
  expect(await page.locator('.timeline-keyframe').count()).toBe(count);
  await page.locator('#animation-redo').click();
  const animationDownload = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const clip = animationFileSchema.parse(JSON.parse(await readFile(await (await animationDownload).path(), 'utf8')));
  expect(Object.keys(clip.tracks)).toEqual(['head']);
  expect(clip.tracks.head).toHaveLength(1);
  expect(clip.tracks.head![0]!.time).toBe(375);
  expect(clip.tracks.head![0]!.rotation).toBeCloseTo((35 * Math.PI) / 180);
  await page.getByRole('tab', { name: 'Character package', exact: true }).click();
  const packages = page.locator('.package-tools');
  await packages.locator(':scope > summary').click();
  const download = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const bytes = await readFile(await (await download).path());
  await expect(page.getByLabel('Package document status')).toContainText('Poses: Clean');
  const files = decodePackageZip(bytes);
  const manifest = characterManifestSchema.parse(packageJson(files, 'character.json'));
  const poses = manifest.poses!.map((path) => poseDefinitionSchema.parse(packageJson(files, path)));
  const saved = poses.find((pose) => pose.name === 'Head tilt')!;
  expect(Object.keys(saved.bones)).toEqual(['head']);
  expect(saved.library?.space).toBe('fk-local');
  expect(poses.some((pose) => pose.name === 'Sword ready')).toBe(true);
  await page.goto('project/');
  await page.getByRole('button', { name: 'Close recovery', exact: true }).click();
  const project = new ProjectWorkspace('Pose project');
  await project.addCharacter(files);
  const input = encodePackageZip((await buildProjectPackage(project)).files);
  await page
    .getByLabel('Import Project', { exact: true })
    .setInputFiles({ name: 'poses.zip', mimeType: 'application/zip', buffer: Buffer.from(input) });
  await expect(page.getByRole('button', { name: 'Animation Editor', exact: true })).toBeVisible();
  const inventory = page.locator('.project-asset-library').first();
  await inventory.locator(':scope > summary').click();
  const poseGroup = inventory
    .locator('.project-asset-group')
    .filter({ has: page.locator('summary').filter({ hasText: /^Poses/ }) });
  await poseGroup.locator(':scope > summary').click();
  await expect(poseGroup).toContainText('Head tilt');
  await expect(poseGroup.locator(':scope > summary')).toContainText(String(poses.length));
  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const projectBytes = await readFile(await (await projectDownload).path());
  await page.reload();
  await page.getByRole('button', { name: 'Close recovery', exact: true }).click();
  await page
    .getByLabel('Import Project', { exact: true })
    .setInputFiles({ name: 'poses.zip', mimeType: 'application/zip', buffer: projectBytes });
  await page.getByRole('button', { name: 'Animation Editor', exact: true }).click();
  const frame = await (await page.locator('iframe:visible').elementHandle()).contentFrame();
  if (!frame) throw new Error('Missing project editor frame.');
  await expect(frame.locator('#animation-selection')).toBeEnabled();
  library = await openLibrary(frame);
  await expect(library.getByRole('button', { name: 'Head tilt 1 bones', exact: true })).toBeVisible();
});

for (const emptyLibrary of [true, false]) {
  test(`Pose Library Feature Guide reveals real controls without editing; empty library=${emptyLibrary}`, async ({
    page,
  }) => {
    if (emptyLibrary)
      await page.route('**/characters/demo-puppet/character.json', async (route) => {
        const response = await route.fetch();
        const manifest = characterManifestSchema.parse(await response.json());
        await route.fulfill({ response, json: { ...manifest, poses: [] } });
      });
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    await expect(page.locator('#animation-pose-library-panel')).not.toHaveAttribute('open');
    const snapshot = async () => {
      await page.getByRole('tab', { name: 'Character package', exact: true }).click();
      const packages = page.locator('.package-tools');
      if (!(await packages.evaluate((element) => (element as HTMLDetailsElement).open)))
        await packages.locator(':scope > summary').click();
      const waiting = page.waitForEvent('download');
      await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
      const files = decodePackageZip(await readFile(await (await waiting).path()));
      await packages.locator(':scope > summary').click();
      await page.getByRole('tab', { name: 'Edit', exact: true }).click();
      return [...files].map(([path, bytes]) => [path, Buffer.from(bytes).toString('base64')]);
    };
    const before = await snapshot();
    const undo = await page.locator('#animation-undo').isEnabled();
    const dirty = await page.locator('#animation-dirty').textContent();
    const time = await page.locator('#current-time').textContent();
    let downloads = 0;
    page.on('download', () => downloads++);
    const guide = guideRegistry.getGuideById('animation-pose-library')!;
    await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
    await page.getByRole('button', { name: 'Start Guide: Pose Library', exact: true }).click();
    const tour = page.getByRole('dialog', { name: 'Pose Library', exact: true });
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour).toContainText(`Step ${index + 1} of ${guide.steps.length}`);
      const target = page.locator(`[data-guide-id="${step.targetId}"]`);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
      await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
      await expect
        .poll(async () => {
          const bounds = await target.boundingBox();
          const hole = await tour.locator('.guide-spotlight-hole').boundingBox();
          if (!bounds || !hole) return false;
          const x = hole.x + hole.width / 2,
            y = hole.y + hole.height / 2;
          return (
            x >= bounds.x - 4 &&
            x <= bounds.x + bounds.width + 4 &&
            y >= bounds.y - 4 &&
            y <= bounds.y + bounds.height + 4
          );
        })
        .toBe(true);
      await expect(tour.getByRole('status')).toHaveCount(0);
      if (index === 1) {
        await tour.getByRole('button', { name: 'Back', exact: true }).click();
        await tour.getByRole('button', { name: 'Next', exact: true }).click();
      }
      await tour
        .getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true })
        .click();
    }
    await expect(tour).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
    await expect(page.locator('#animation-dirty')).toHaveText(dirty!);
    await expect(page.locator('#current-time')).toHaveText(time!);
    expect(await page.locator('#animation-undo').isEnabled()).toBe(undo);
    expect(downloads).toBe(0);
    await openLibrary(page);
    await expect(page.getByRole('button', { name: 'Cancel preview', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Undo library edit', exact: true })).toBeDisabled();
    expect(await snapshot()).toEqual(before);
    await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
    await page.getByRole('button', { name: 'Start Guide: Pose Library', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(tour).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
  });
}
