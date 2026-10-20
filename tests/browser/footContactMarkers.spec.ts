import { expect } from '@playwright/test';
import { composeAffine, localToWorld, transformToAffine, type Affine } from '../../src/engine/affineMath.js';
import { parseRigDefinition } from '../../src/engine/externalData.js';
import { Joint } from '../../src/engine/Joint.js';
import { inspectorControl, rigCanvasProjection, rigFileAction, selectRigEntry, test } from './fixtures.js';

test('author foot contacts through React and Phaser, cancel, undo, face, rotate, export and reload', async ({
  page,
}) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await expect(page.locator('#rig-inspector .foot-contact-panel')).not.toHaveAttribute('open');
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
  const projection = await rigCanvasProjection(page);
  const head = localToWorld({ x: 0, y: 0 }, matrices.get('head')!);
  const point = async (x: number, y: number, facing = 1) => {
    const local = localToWorld({ x, y }, matrices.get('rightFoot')!);
    return projection.point(projection.head.x - head.x + facing * local.x, projection.head.y - head.y + local.y);
  };
  await selectRigEntry(page, 'rightFoot');
  const panel = await inspectorControl(page, '#rig-inspector .foot-contact-panel section');
  await expect(panel.getByLabel('New contact bone')).toHaveValue('rightFoot');
  await panel.getByRole('button', { name: '+ Add Contact Marker', exact: true }).click();
  await expect(panel.getByLabel('Contact bone', { exact: true })).toHaveValue('rightFoot');
  const name = panel.getByLabel('Contact name');
  await name.fill('Right sole');
  await name.press('Enter');
  const x = panel.getByLabel('Local X', { exact: true });
  const y = panel.getByLabel('Local Y', { exact: true });
  for (const [field, value] of [
    [x, '12'],
    [y, '28'],
  ] as const) {
    await field.fill(value);
    await field.press('Enter');
  }
  const start = await point(12, 28);
  const end = await point(25, 34);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await expect.poll(async () => Math.abs(Number(await x.inputValue()) - 25)).toBeLessThan(1);
  await page.mouse.up();
  await page.locator('#undo').click();
  await expect(x).toHaveValue('12');
  await expect(y).toHaveValue('28');
  await page.locator('#redo').click();
  const committedX = await x.inputValue();
  const committedY = await y.inputValue();
  const committed = await point(Number(committedX), Number(committedY));
  await page.mouse.move(committed.x, committed.y);
  await page.mouse.down();
  await page.mouse.move(committed.x + 30, committed.y + 25, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(x).toHaveValue(committedX);
  await expect(y).toHaveValue(committedY);
  await x.fill('999');
  await x.press('Escape');
  await expect(x).toHaveValue(committedX);
  await page.locator('#rig-facing').selectOption('left');
  const flipped = await point(Number(committedX), Number(committedY), -1);
  const flippedEnd = await point(18, 40, -1);
  await page.mouse.move(flipped.x, flipped.y);
  await page.mouse.down();
  await page.mouse.move(flippedEnd.x, flippedEnd.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(Number(await x.inputValue()) - 18)).toBeLessThan(1);
  await expect.poll(async () => Math.abs(Number(await y.inputValue()) - 40)).toBeLessThan(1);
  await page.locator('#undo').click();
  await expect(x).toHaveValue(committedX);
  await panel.getByLabel('New contact bone').selectOption('leftFoot');
  await panel.getByRole('button', { name: '+ Add Contact Marker', exact: true }).click();
  await panel.getByLabel('Contact name').fill('Left sole');
  await panel.getByLabel('Contact name').press('Enter');
  await panel.getByRole('button', { name: 'Right sole', exact: true }).click();
  await expect(x).toHaveValue(committedX);
  const ground = await inspectorControl(page, '#rig-inspector .ground-guide-controls fieldset');
  await ground.getByRole('spinbutton', { name: 'Ground Y', exact: true }).fill('560');
  await ground.getByRole('spinbutton', { name: 'Ground Y', exact: true }).press('Enter');
  await ground.getByRole('checkbox', { name: 'Show ground guide' }).uncheck();
  const canvas = page.locator('#editor-stage canvas');
  const withoutGround = await canvas.screenshot();
  await ground.getByRole('checkbox', { name: 'Show ground guide' }).check();
  await expect.poll(async () => (await canvas.screenshot()).equals(withoutGround)).toBe(false);
  const groundY = ground.getByRole('spinbutton', { name: 'Ground Y', exact: true });
  const bounds = (await canvas.boundingBox())!;
  const pixel = bounds.width / (await canvas.evaluate((element) => (element as HTMLCanvasElement).width));
  const line = await projection.point(projection.head.x, 560);
  const tag = { x: bounds.x + 25 * pixel, y: line.y - 12 * pixel };
  await page.mouse.move(tag.x, tag.y);
  await page.mouse.down();
  await page.mouse.move(tag.x, tag.y + 30 * pixel, { steps: 4 });
  await expect.poll(async () => Number(await groundY.inputValue())).toBeGreaterThan(560);
  await page.mouse.up();
  await ground.getByRole('button', { name: 'Undo ground change', exact: true }).click();
  await expect(groundY).toHaveValue('560');
  await page.mouse.move(tag.x, tag.y);
  await page.mouse.down();
  await page.mouse.move(tag.x, tag.y + 25 * pixel, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(groundY).toHaveValue('560');
  await expect(x).toHaveValue(committedX);
  await expect(y).toHaveValue(committedY);
  await selectRigEntry(page, 'rightFoot');
  const rotation = await inspectorControl(page, '#inspector input[data-field="rotation"]');
  await rotation.fill('0.5');
  await rotation.press('Enter');
  await panel.getByRole('button', { name: 'Right sole', exact: true }).click();
  await expect(x).toHaveValue(committedX);
  const logged = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
  await rigFileAction(page, '#log-json', (control) => control.click());
  const exported = parseRigDefinition(JSON.parse((await logged).text()));
  expect(exported.footContactMarkers).toEqual([
    { id: 'contact', name: 'Right sole', boneId: 'rightFoot', localX: Number(committedX), localY: Number(committedY) },
    { id: 'contact-2', name: 'Left sole', boneId: 'leftFoot', localX: 0, localY: 0 },
  ]);
  await rigFileAction(page, '#reload-exported', (control) => control.click());
  await panel.getByRole('button', { name: 'Right sole', exact: true }).click();
  await expect(x).toHaveValue(committedX);
  await panel.getByLabel('Contact bone', { exact: true }).selectOption('leftFoot');
  await expect(panel.getByLabel('Contact bone', { exact: true })).toHaveValue('leftFoot');
  await page.locator('#undo').click();
  await expect(panel.getByLabel('Contact bone', { exact: true })).toHaveValue('rightFoot');
  await panel.getByRole('button', { name: 'Delete Marker', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Right sole', exact: true })).toHaveCount(0);
  await page.locator('#undo').click();
  await panel.getByRole('button', { name: 'Right sole', exact: true }).click();
  await expect(x).toHaveValue(committedX);
});

test('a new character can author arbitrary contacts without legs and retains its reference guide', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new character', exact: true });
  await dialog.getByLabel('Character name', { exact: true }).fill('Contact point');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await expect(page.locator('#rig-inspector details[open]')).toHaveCount(0);
  await expect(page.locator('#rig-inspector .ground-guide-controls')).not.toHaveAttribute('open');
  const panel = await inspectorControl(page, '#rig-inspector .foot-contact-panel section');
  await panel.getByRole('button', { name: '+ Add Contact Marker', exact: true }).click();
  await expect(panel.getByLabel('Contact bone', { exact: true })).toHaveValue('root');
  await expect(panel.getByLabel('Local X', { exact: true })).toHaveValue('0');
  await expect(panel.getByLabel('Local Y', { exact: true })).toHaveValue('0');
  await page.locator('#undo').click();
  await expect(panel).toContainText('No contact markers');
  await page.locator('#redo').click();
  await panel.getByRole('button', { name: 'root contact', exact: true }).click();
  const canvas = await page.locator('#editor-stage canvas').elementHandle();
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  expect(await page.locator('#editor-stage canvas').evaluate((element, original) => element === original, canvas)).toBe(
    true,
  );
  await inspectorControl(page, '#rig-inspector .foot-contact-panel section');
  await panel.getByRole('button', { name: 'root contact', exact: true }).click();
  await expect(panel.getByLabel('Local Y', { exact: true })).toHaveValue('0');
});
