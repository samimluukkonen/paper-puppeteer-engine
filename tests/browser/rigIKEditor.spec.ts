import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { loadPackageDefinition } from '../../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip } from '../../src/devtools/shared/package/packageZip.js';
import { composeAffine, localToWorld, transformToAffine, type Affine } from '../../src/engine/affineMath.js';
import { parseRigDefinition } from '../../src/engine/externalData.js';
import { Joint } from '../../src/engine/Joint.js';
import {
  rigCanvasProjection,
  rigFileAction,
  test,
  animationIKInspector,
  inspectorControl,
  selectRigEntry,
} from './fixtures.js';

test.setTimeout(90_000);

test('create, drag, cancel, configure and reload a visual rig IK constraint through React and Phaser', async ({
  page,
}) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  const source = parseRigDefinition(await (await page.request.get('characters/demo-puppet/rig.json')).json());
  const matrices = new Map<string, Affine>();
  for (const bone of source.bones)
    matrices.set(
      bone.id,
      composeAffine(
        transformToAffine(new Joint(bone.id, bone).pose, {} as Affine),
        bone.parent ? matrices.get(bone.parent) : undefined,
        {} as Affine,
      ),
    );
  const localHead = localToWorld({ x: 0, y: 0 }, matrices.get('head')!);
  const projection = await rigCanvasProjection(page);
  const point = (x: number, y: number) =>
    projection.point(projection.head.x - localHead.x + x, projection.head.y - localHead.y + y);
  const panel = await inspectorControl(page, '#rig-inspector .rig-ik-panel section');
  await panel.getByRole('button', { name: '+ Add IK Constraint', exact: true }).click();
  const form = panel.getByRole('form', { name: 'Create IK constraint' });
  await expect(form.getByRole('button', { name: 'Create IK Constraint', exact: true })).toBeDisabled();
  await form.getByLabel('Start bone', { exact: true }).selectOption('rightUpperArm');
  await expect(form.getByLabel('Middle bone', { exact: true })).toHaveValue('rightForearm');
  await expect(form.getByLabel('End bone', { exact: true })).toHaveValue('rightHand');
  await form.getByLabel('Constraint name', { exact: true }).fill('visualArmIK');
  await form.getByLabel('Initialize target at current end effector', { exact: true }).uncheck();
  for (const [axis, value] of [
    ['X', '-80'],
    ['Y', '-90'],
  ]) {
    await form.getByLabel(`Target ${axis}`, { exact: true }).fill(value!);
    await form.getByLabel(`Target ${axis}`, { exact: true }).blur();
  }
  await form.getByRole('button', { name: 'Create IK Constraint', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'visualArmIK', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByLabel('Live solver preview', { exact: true })).toBeChecked();
  const x = panel.getByLabel('Target X', { exact: true });
  const y = panel.getByLabel('Target Y', { exact: true });
  const start = await point(-80, -90);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const end = await point(-60, -70);
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await expect.poll(async () => Math.abs(Number(await x.inputValue()) + 60)).toBeLessThan(1);
  await page.mouse.up();
  await expect.poll(async () => Math.abs(Number(await y.inputValue()) + 70)).toBeLessThan(1);
  await page.locator('#undo').click();
  await expect(x).toHaveValue('-80');
  await expect(y).toHaveValue('-90');
  await page.locator('#redo').click();
  const committedX = await x.inputValue();
  const committedY = await y.inputValue();
  const dragStart = await point(Number(committedX), Number(committedY));
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 20, dragStart.y + 20, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(x).toHaveValue(committedX);
  await expect(y).toHaveValue(committedY);
  await x.fill('999');
  await x.press('Escape');
  await expect(x).toHaveValue(committedX);
  const canvas = page.locator('#editor-stage canvas');
  const solved = await canvas.screenshot();
  await panel.getByLabel('Influence', { exact: true }).fill('0');
  await panel.getByLabel('Influence', { exact: true }).blur();
  expect((await canvas.screenshot()).equals(solved)).toBe(false);
  await panel.getByLabel('Influence', { exact: true }).fill('1');
  await panel.getByLabel('Influence', { exact: true }).blur();
  await panel.getByLabel('Bend direction', { exact: true }).selectOption('-1');
  const logged = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
  await rigFileAction(page, '#log-json', (control) => control.click());
  const exported = parseRigDefinition(JSON.parse((await logged).text()));
  expect(exported.ik?.find((entry) => entry.name === 'visualArmIK')).toMatchObject({
    rootBone: 'rightUpperArm',
    middleBone: 'rightForearm',
    endBone: 'rightHand',
    target: { x: Number(committedX), y: Number(committedY) },
    mix: 1,
    bendDirection: -1,
  });
  await rigFileAction(page, '#reload-exported', (control) => control.click());
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await panel.getByRole('button', { name: 'visualArmIK', exact: true }).click();
  await expect(x).toHaveValue(committedX);
  await expect(y).toHaveValue(committedY);
  await panel.getByLabel('Live solver preview', { exact: true }).check();
  await expect(panel.getByLabel('Bend direction', { exact: true })).toHaveValue('-1');
  await panel.getByRole('button', { name: 'rightArmIK', exact: true }).click();
  await expect(panel.getByLabel('Start bone', { exact: true })).toHaveValue('rightUpperArm');
  await expect(panel).toContainText('Resolve these dependencies before deleting or changing the chain');
  await expect(panel.getByRole('button', { name: 'Delete Constraint', exact: true })).toBeDisabled();
});

test('a new non-humanoid skeleton has an empty IK state and can create a chain without JSON', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new character', exact: true });
  await dialog.getByLabel('Character name', { exact: true }).fill('Tentacle');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await expect.poll(() => page.locator('#rig-inspector details[open]').count()).toBe(0);
  // Measure the visible collapsed cards; the guidance content is inside a closed disclosure.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const guidance = document.querySelector('#rig-inspector .rig-selection-details')!.getBoundingClientRect();
        const collapsedIK = document.querySelector('#rig-inspector .rig-ik-panel')!.getBoundingClientRect();
        return collapsedIK.top - guidance.bottom;
      }),
    )
    .toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: test.info().outputPath('collapsed-inspector.png') });
  const panel = await inspectorControl(page, '#rig-inspector .rig-ik-panel section');
  await expect(panel).toContainText('No IK constraints');
  await panel.getByRole('button', { name: '+ Add IK Constraint', exact: true }).click();
  await expect(panel).toContainText('Add a chain of three connected bones before creating IK.');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await selectRigEntry(page, 'root');
  const skeleton = page.getByRole('region', { name: 'Build skeleton', exact: true });
  for (const id of ['segment', 'tip']) {
    await skeleton.getByLabel('New bone ID', { exact: true }).fill(id);
    await skeleton.getByRole('button', { name: '+ Add Bone', exact: true }).click();
  }
  await panel.getByRole('button', { name: '+ Add IK Constraint', exact: true }).click();
  await panel.getByLabel('Constraint name', { exact: true }).fill('tentacleIK');
  await panel.getByRole('button', { name: 'Create IK Constraint', exact: true }).click();
  await expect(panel.getByLabel('Start bone', { exact: true })).toHaveValue('root');
  await expect(panel.getByLabel('Middle bone', { exact: true })).toHaveValue('segment');
  await expect(panel.getByLabel('End bone', { exact: true })).toHaveValue('tip');
  await expect(panel.getByLabel('Target Y', { exact: true })).toHaveValue('80');
  await panel.getByRole('button', { name: 'Delete Constraint', exact: true }).click();
  await expect(panel).toContainText('No IK constraints');
  await page.locator('#undo').click();
  await panel.getByRole('button', { name: 'tentacleIK', exact: true }).click();
  await expect(panel.getByLabel('Target Y', { exact: true })).toHaveValue('80');
  const downloadingRig = page.waitForEvent('download');
  await page.locator('#download-json').click();
  await downloadingRig;
  await rigFileAction(page, '#reload-exported', (control) => control.click());
  const canvas = await page.locator('#editor-stage canvas').elementHandle();
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await page.locator('#animation-new').click();
  const animationDialog = page.getByRole('dialog', { name: 'Create new animation', exact: true });
  await animationDialog.getByLabel('Animation name / ID', { exact: true }).fill('reach');
  await animationDialog.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await page.getByRole('button', { name: 'Select IK target tentacleIK', exact: true }).click();
  await expect(page.locator('#animation-ik-inspector > details')).not.toHaveAttribute('open');
  await animationIKInspector(page);
  const inspector = page.locator('#animation-ik-inspector');
  await inspector.locator('[data-ik-property="x"]').fill('17');
  await inspector.locator('summary').first().click();
  await expect(inspector.locator('[data-ik-property="x"]')).toBeHidden();
  await inspector.locator('summary').first().click();
  await expect(inspector.locator('[data-ik-property="x"]')).toHaveValue('17');
  for (const [time, value] of [
    ['0', '20'],
    ['1', '-20'],
  ]) {
    await page.locator('#timeline-time-input').fill(time!);
    await page.locator('#timeline-time-input').press('Enter');
    await inspector.locator('[data-ik-property="x"]').fill(value!);
    await inspector.locator('[data-ik-property="y"]').fill('60');
    await inspector.getByRole('button', { name: 'Set Target Key', exact: true }).click();
  }
  await inspector.locator('[data-ik-property="mix"]').fill('0.75');
  await inspector.getByRole('button', { name: 'Set IK mix key', exact: true }).click();
  const downloadingAnimation = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const animationJson = await readFile(await (await downloadingAnimation).path(), 'utf8');
  const animationHistory = page.locator('#animation-undo');
  await expect(animationHistory).toBeEnabled();
  await page.locator('#editor-mode').selectOption('rig-tweak');
  const tweakIK = await inspectorControl(page, '#animation-inspector .rig-ik-panel section');
  await tweakIK.getByRole('button', { name: 'tentacleIK', exact: true }).click();
  await expect(tweakIK).toContainText('animation "reach" IK track');
  await expect(tweakIK.getByRole('button', { name: 'Delete Constraint', exact: true })).toBeDisabled();
  await expect(tweakIK.getByLabel('Start bone', { exact: true })).toBeDisabled();
  const targetX = tweakIK.getByLabel('Target X', { exact: true });
  await targetX.fill('15');
  await targetX.blur();
  await page.locator('#tweak-undo').click();
  await expect(targetX).toHaveValue('0');
  await page.locator('#tweak-redo').click();
  await expect(targetX).toHaveValue('15');
  await tweakIK.getByLabel('Enabled', { exact: true }).uncheck();
  await tweakIK.getByLabel('Enabled', { exact: true }).check();
  await page.locator('#editor-mode').selectOption('animation');
  const downloadingAgain = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  expect(await readFile(await (await downloadingAgain).path(), 'utf8')).toBe(animationJson);
  await page.locator('#animation-undo').click();
  await page.locator('#animation-redo').click();
  await page.locator('#timeline-time-input').fill('0.5');
  await page.locator('#timeline-time-input').press('Enter');
  expect(
    await page.locator('#animation-stage canvas').evaluate((element, original) => element === original, canvas),
  ).toBe(true);
  const packages = page.locator('.package-tools');
  await packages.locator('summary').click();
  const downloadingPackage = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const files = decodePackageZip(await readFile(await (await downloadingPackage).path()));
  const definition = await loadPackageDefinition(files);
  expect(definition.rig.ik?.[0]).toMatchObject({ name: 'tentacleIK', target: { x: 15, y: 80 }, enabled: true });
  expect(definition.animations[0]?.ikTracks?.tentacleIK).toEqual([
    { time: 0, x: 20, y: 60 },
    { time: 1000, x: -20, y: 60, mix: 0.75 },
  ]);
  await packages.getByRole('button', { name: 'Reload exported package', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Package runtime preview' });
  await expect(preview).toContainText('runtime playback ready', { timeout: 30_000 });
  await preview.getByRole('button', { name: 'Close preview' }).click();
});
