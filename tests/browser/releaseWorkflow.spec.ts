import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { packageJson } from '../../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip } from '../../src/devtools/shared/package/packageZip.js';
import { animationFileSchema, characterManifestSchema, rigFileSchema } from '../../src/engine/schemas.js';
import {
  animationHierarchy,
  animationMenuControl,
  test,
  toggleAnimationToolPanel,
  animationIKInspector,
  inspectorControl,
  selectRigEntry,
} from './fixtures.js';

test('production authoring: sprites, rig, skin, motion, IK bake, onion, mirror, replacement and portable ZIP', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  // Configure the shipped skeleton; arbitrary new-bone creation is outside the editor's supported controls.
  await selectRigEntry(page, 'leftForearm');
  const joint = page.locator('#inspector input[data-scope="bone"][data-field="y"]');
  await joint.fill('76');
  await joint.press('Tab');
  const artwork = page.locator('#artwork-panel');
  await inspectorControl(page, '#artwork-panel');
  await artwork.getByLabel('Artwork asset', { exact: true }).selectOption('paper-left-forearm');
  const sprite = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 96;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#7b50e8';
    context.fillRect(8, 4, 24, 88);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  const importSprite = async () => {
    await artwork.getByLabel('Import sprite').setInputFiles({
      name: 'release-forearm.png',
      mimeType: 'image/png',
      buffer: Buffer.from(sprite, 'base64'),
    });
    await artwork.getByLabel('Alignment policy').selectOption('pixels');
    await artwork.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
    await artwork.getByRole('button', { name: 'Apply Replacement', exact: true }).click();
  };
  await importSprite();
  await page.locator('#edit-mode').selectOption('sprite');
  await selectRigEntry(page, '◇ leftForearmVisual');
  const offset = page.locator('#inspector input[data-scope="attachment"][data-field="x"]');
  await offset.fill('4');
  await offset.press('Tab');
  const attachments = page.locator('#attachment-panel');
  await inspectorControl(page, '#attachment-panel select');
  await attachments.getByLabel('Attachment slot', { exact: true }).selectOption('headVisual');
  await attachments.getByLabel('Skin name', { exact: true }).fill('release-alternate');
  await attachments.getByRole('button', { name: 'Create skin', exact: true }).click();
  await attachments.getByLabel('Assigned attachment', { exact: true }).selectOption('headArmored');

  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-new').click();
  const create = page.getByRole('dialog', { name: 'Create new animation', exact: true });
  await create.getByLabel('Animation name / ID', { exact: true }).fill('reach');
  await create.getByRole('button', { name: 'Create Animation', exact: true }).click();
  const time = page.locator('#timeline-time-input');
  const seek = async (value: string) => {
    await time.fill(value);
    await time.press('Enter');
  };
  await (await animationHierarchy(page)).getByRole('button', { name: 'leftUpperArm', exact: true }).click();
  for (const [at, rotation] of [
    ['0', '-20'],
    ['1', '25'],
  ]) {
    await seek(at!);
    await page.locator('#animation-bone-fields input[data-property="rotation"]').fill(rotation!);
    await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Expand leftUpperArm properties', exact: true }).click();
  const keys = page.locator(
    '.timeline-track-lane[data-bone-id="leftUpperArm"][data-property="rotation"] .timeline-keyframe',
  );
  await keys.first().click();
  await keys.last().click({ modifiers: ['Control'] });
  await toggleAnimationToolPanel(page, 'mirror');
  await page
    .getByRole('region', { name: 'Mirror tools', exact: true })
    .getByRole('button', { name: 'Mirror Selected Keys', exact: true })
    .click();
  await toggleAnimationToolPanel(page, 'mirror');
  await page.locator('#animation-undo').click();
  await page.locator('#animation-redo').click();
  await page.locator('#animation-onion-skinning').check();
  await seek('0.5');
  await page.getByRole('button', { name: 'Select IK target rightArmIK', exact: true }).click();
  await animationIKInspector(page);
  const ik = page.locator('#animation-ik-inspector');
  for (const [at, x, y] of [
    ['0', '22', '-42'],
    ['1', '-48', '-12'],
  ]) {
    await seek(at!);
    await ik.locator('[data-ik-property="x"]').fill(x!);
    await ik.getByRole('button', { name: 'Set IK x key', exact: true }).click();
    await ik.locator('[data-ik-property="y"]').fill(y!);
    await ik.getByRole('button', { name: 'Set IK y key', exact: true }).click();
  }
  await seek('0.5');
  await (await animationMenuControl(page, '#timeline-add-event')).click();
  await page.locator('#animation-event-name').fill('release-cue');
  await page.locator('#animation-event-name').press('Tab');
  await toggleAnimationToolPanel(page, 'bake');
  const bake = page.getByRole('region', { name: 'IK Baking', exact: true });
  // New clips use 12 FPS stepped playback; bake on that grid to preserve their authored poses.
  await bake.getByRole('spinbutton', { name: 'Sampling FPS', exact: true }).fill('12');
  await bake.getByRole('checkbox', { name: /^rightArmIK/ }).check();
  await expect(bake.getByRole('button', { name: 'Bake IK', exact: true })).toBeEnabled();
  await bake.getByRole('button', { name: 'Bake IK', exact: true }).click();
  await expect(bake.getByRole('status')).toContainText('IK baked');
  await toggleAnimationToolPanel(page, 'bake');

  // Replacing the same asset from the other editor retains its logical identity and prior alignment.
  await inspectorControl(page, '#artwork-panel');
  await artwork.getByLabel('Artwork asset', { exact: true }).selectOption('paper-left-forearm');
  await importSprite();
  await page.locator('#editor-mode').selectOption('rig-tweak');
  await selectRigEntry(page, 'leftForearm');
  const tweak = page.locator('#tweak-inspector input[data-scope="bone"][data-field="y"]');
  await expect(tweak).toHaveValue('76');
  await tweak.fill('77');
  await tweak.press('Tab');
  await page.locator('#editor-mode').selectOption('animation');
  await expect(time).toHaveValue('0.5');
  await page.locator('#animation-stage canvas').screenshot({ path: test.info().outputPath('authored.png') });

  await page.getByRole('tab', { name: 'Character package', exact: true }).click();
  const packages = page.locator('.package-tools');
  await packages.locator(':scope > summary').click();
  const downloading = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  if (!path) throw new Error('Missing release workflow ZIP.');
  await download.saveAs(test.info().outputPath('release-character.zip'));
  const files = decodePackageZip(await readFile(path));
  const manifest = characterManifestSchema.parse(packageJson(files, 'character.json'));
  const rig = rigFileSchema.parse(packageJson(files, manifest.rig));
  const clip = animationFileSchema.parse(packageJson(files, 'animations/reach.json'));
  expect(rig.bones.find((bone) => bone.id === 'leftForearm')!.y).toBe(77);
  expect(rig.attachments!.find((attachment) => attachment.id === 'leftForearmDefault')!.x).toBe(4);
  expect(clip.tracks.leftUpperArm).toBeDefined();
  expect(clip.tracks.rightUpperArm).toBeDefined();
  expect(clip.disabledIKConstraints).toContain('rightArmIK');
  expect(clip.events).toContainEqual({ time: 500, name: 'release-cue' });
  expect(Buffer.from(files.get(manifest.textures['paper-left-forearm']!)!)).toEqual(Buffer.from(sprite, 'base64'));
  await packages.getByRole('button', { name: 'Reload exported package', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Package runtime preview', exact: true });
  await expect(preview).toContainText('runtime playback ready');
  await preview.getByLabel('Animation', { exact: true }).selectOption('reach');
  await preview.getByLabel('Skin', { exact: true }).selectOption('release-alternate');
  const before = await preview.locator('canvas').screenshot();
  await expect.poll(async () => (await preview.locator('canvas').screenshot()).equals(before)).toBe(false);
  await preview.getByRole('button', { name: 'Close preview', exact: true }).click();
  await expect(page.locator('#package-runtime-stage')).toHaveCount(0);
});
