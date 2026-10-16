import { expect } from '@playwright/test';
import { composeAffine, localToWorld, transformToAffine, type Affine } from '../../src/engine/affineMath.js';
import { parseRigDefinition } from '../../src/engine/externalData.js';
import { Joint } from '../../src/engine/Joint.js';
import { rigCanvasProjection, rigFileAction, test } from './fixtures.js';

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
  const panel = page.getByRole('region', { name: 'IK constraints', exact: true });
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
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new character', exact: true });
  await dialog.getByLabel('Character name', { exact: true }).fill('Tentacle');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  const panel = page.getByRole('region', { name: 'IK constraints', exact: true });
  await expect(panel).toContainText('No IK constraints');
  await panel.getByRole('button', { name: '+ Add IK Constraint', exact: true }).click();
  await expect(panel).toContainText('Add a chain of three connected bones before creating IK.');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('treeitem', { name: 'root', exact: true }).click();
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
});
