import { expect, type Page } from '@playwright/test';
import type { RigJsonDefinition } from '../../src/engine/externalData.js';
import {
  rigCanvasProjection,
  rigFileAction,
  test,
  inspectorControl,
  rigHierarchy,
  selectRigEntry,
  waitForPreviewPaint,
} from './fixtures.js';

const field = (page: Page, name: string) => page.locator(`#inspector input[data-scope="bone"][data-field="${name}"]`);

test('unsaved edits block navigation and refresh until exported', async ({ page }) => {
  await selectRigEntry(page, 'head');
  await field(page, 'x').fill('12');
  const originalUrl = page.url();
  const rejectNavigation = async () => {
    const dialog = await page.waitForEvent('dialog');
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
  };
  await Promise.all([rejectNavigation(), page.getByRole('link', { name: 'Project Workspace', exact: true }).click()]);
  expect(page.url()).toBe(originalUrl);
  await expect(field(page, 'x')).toHaveValue('12');
  await Promise.all([
    rejectNavigation(),
    page.evaluate(() => {
      setTimeout(() => window.location.reload(), 0);
    }),
  ]);
  await expect(field(page, 'x')).toHaveValue('12');
  await rigFileAction(page, '#log-json', (control) => control.click());
  await page.getByRole('link', { name: 'Project Workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project Workspace', exact: true })).toBeVisible();
});

test.beforeEach(async ({ page }) => {
  await page.goto('rig-editor/');
  await expect((await rigHierarchy(page)).getByRole('treeitem', { name: 'head', exact: true })).toBeVisible();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
});

for (const character of ['demo-puppet', 'random-paperdoll-sketch']) {
  for (const selection of ['none', 'head', '◇ headVisual']) {
    test(`Sprite mode drags ${character} artwork with ${selection} selected`, async ({ page }) => {
      if (character !== 'demo-puppet') {
        await page.goto(`rig-editor/?character=${character}`);
        await expect(page.locator('#validation')).toHaveText('Validation: OK');
      }
      const original = (await (await page.request.get(`characters/${character}/rig.json`)).json()) as RigJsonDefinition;
      const projection = await rigCanvasProjection(page);
      if (selection !== 'none') await selectRigEntry(page, selection);
      await page.locator('#edit-mode').selectOption('sprite');
      const box = await page.locator('#editor-stage canvas').boundingBox();
      if (!box) throw new Error('Missing editor canvas');
      const jointY = projection.head.y;
      const start = await projection.point(projection.head.x, jointY - (selection === 'none' ? 15 : 0));
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await expect(page.locator('#inspector h3')).toHaveText('Slot: headVisual');
      // Selecting artwork can reflow the session header and shift the canvas vertically.
      const selectedBox = await page.locator('#editor-stage canvas').boundingBox();
      if (!selectedBox) throw new Error('Missing editor canvas');
      const end = await projection.point(projection.head.x + 24, jointY - (selection === 'none' ? 15 : 0) + 12);
      await page.mouse.move(end.x, end.y, { steps: 4 });
      await page.mouse.up();
      await expect(page.locator('#inspector h3')).toHaveText('Slot: headVisual');
      const offset = (axis: string) => page.locator(`#inspector input[data-scope="attachment"][data-field="${axis}"]`);
      // Mouse events use whole CSS pixels, while the canvas can have fractional CSS dimensions.
      await expect.poll(async () => Math.abs(Number(await offset('x').inputValue()) - 24)).toBeLessThan(1);
      await expect.poll(async () => Math.abs(Number(await offset('y').inputValue()) - 12)).toBeLessThan(1);
      await expect(page.locator('#inspector input[data-scope="slot"][data-field="x"]')).toHaveValue('0');
      await expect(page.locator('#inspector input[data-scope="slot"][data-field="y"]')).toHaveValue('0');
      await page.locator('#undo').click();
      await expect(offset('x')).toHaveValue('0');
      await expect(offset('y')).toHaveValue('0');
      await expect(page.locator('#undo')).toBeDisabled();
      await page.locator('#redo').click();
      const logged = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
      await rigFileAction(page, '#log-json', (control) => control.click());
      const exported = JSON.parse((await logged).text()) as RigJsonDefinition;
      expect(exported.bones).toEqual(original.bones);
      expect(exported.slots).toEqual(original.slots);
      const attachment = exported.attachments?.find((entry) => entry.id === 'headDefault');
      expect(Math.abs(attachment!.x! - 24)).toBeLessThan(1);
      expect(Math.abs(attachment!.y! - 12)).toBeLessThan(1);
    });
  }
}

test('numeric inputs retain precision and clearing length removes the override', async ({ page }) => {
  await selectRigEntry(page, 'head');
  await field(page, 'x').fill('0.123456789');
  await page.getByRole('heading', { name: 'Rig Editor Bind Pose' }).click();
  await expect(field(page, 'x')).toHaveValue('0.123456789');
  const length = field(page, 'length');
  await expect(length).toHaveValue('');
  await expect(length).toHaveAttribute('placeholder', 'Auto');
  await length.fill('25');
  await length.press('Tab');
  await length.fill('');
  await length.press('Tab');
  await page.getByRole('heading', { name: 'Rig Editor Bind Pose' }).click();
  await expect(length).toHaveValue('');
  await page.locator('#undo').click();
  await expect(length).toHaveValue('25');
  await page.locator('#redo').click();
  await expect(length).toHaveValue('');
  const logged = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
  await rigFileAction(page, '#log-json', (control) => control.click());
  const rig = JSON.parse((await logged).text()) as RigJsonDefinition;
  expect(rig.bones.find((bone) => bone.id === 'head')).not.toHaveProperty('length');
});

test('a canvas drag released outside commits one undo and stops moving', async ({ page }) => {
  const hierarchy = await rigHierarchy(page);
  const originalEntries = await hierarchy.getByRole('treeitem').elementHandles();
  const canvas = page.locator('#editor-stage canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Missing editor canvas');
  const projection = await rigCanvasProjection(page);
  const start = await projection.point(projection.head.x, projection.head.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 20, { steps: 4 });
  await expect(page.locator('#inspector h3')).toHaveText('Bone: head');
  await expect(field(page, 'x')).not.toHaveValue('0');
  await page.mouse.move(box.x - 10, start.y + 20);
  await page.mouse.up();
  await expect(page.locator('#undo')).toBeEnabled();
  const editedX = await field(page, 'x').inputValue();
  const editedY = await field(page, 'y').inputValue();
  await page.mouse.move(start.x + 70, start.y + 40, { steps: 4 });
  await expect(field(page, 'x')).toHaveValue(editedX);
  await expect(field(page, 'y')).toHaveValue(editedY);
  await page.locator('#undo').click();
  await expect(field(page, 'x')).toHaveValue('0');
  await expect(field(page, 'y')).toHaveValue('-106');
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#redo').click();
  await expect(field(page, 'x')).toHaveValue(editedX);
  await expect(field(page, 'y')).toHaveValue(editedY);
  expect(
    await hierarchy.evaluate(
      (tree, entries) =>
        tree.children.length === entries.length && entries.every((entry, index) => tree.children[index] === entry),
      originalEntries,
    ),
  ).toBe(true);
});

test('undo during a held canvas drag ends the gesture and preserves redo', async ({ page }) => {
  const box = await page.locator('#editor-stage canvas').boundingBox();
  if (!box) throw new Error('Missing editor canvas');
  const projection = await rigCanvasProjection(page);
  const start = await projection.point(projection.head.x, projection.head.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 20, { steps: 4 });
  await expect(field(page, 'x')).not.toHaveValue('0');
  const editedX = await field(page, 'x').inputValue();
  const editedY = await field(page, 'y').inputValue();
  await page.keyboard.press('Control+z');
  await expect(field(page, 'x')).toHaveValue('0');
  await expect(field(page, 'y')).toHaveValue('-106');
  await page.mouse.move(start.x + 60, start.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect(field(page, 'x')).toHaveValue('0');
  await expect(field(page, 'y')).toHaveValue('-106');
  await expect(page.locator('#redo')).toBeEnabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(field(page, 'x')).toHaveValue(editedX);
  await expect(field(page, 'y')).toHaveValue(editedY);
});

for (const mode of ['joint', 'sprite']) {
  test(`background dragging repositions the character without editing the rig in ${mode} mode`, async ({ page }) => {
    const projection = await rigCanvasProjection(page);
    const initialHead = await projection.point(projection.head.x, projection.head.y);
    await selectRigEntry(page, 'head');
    await page.locator('#edit-mode').selectOption(mode);
    const canvas = page.locator('#editor-stage canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Missing editor canvas');
    const point = (x: number, y: number) => ({ x: box.x + (x / 760) * box.width, y: box.y + (y / 640) * box.height });
    const start = point(50, 50);
    const end = point(95, 85);
    const before = await canvas.screenshot();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
    await expect(page.locator('#inspector h3')).toHaveText('Bone: head');
    await expect(field(page, 'x')).toHaveValue('0');
    await expect(field(page, 'y')).toHaveValue('-106');
    await expect(page.locator('#dirty-status')).toHaveText('No changes');
    await expect(page.locator('#undo')).toBeDisabled();
    // Hit testing and joint editing follow the character to its new position.
    await page.locator('#edit-mode').selectOption('joint');
    await page.mouse.click(start.x, start.y);
    await expect(page.locator('#session-status')).toContainText('Selected: none');
    const head = { x: initialHead.x + end.x - start.x, y: initialHead.y + end.y - start.y };
    await page.mouse.move(head.x, head.y);
    await page.mouse.down();
    await page.mouse.move(head.x + 20, head.y + 10, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#inspector h3')).toHaveText('Bone: head');
    await expect(field(page, 'x')).not.toHaveValue('0');
    await page.locator('#undo').click();
    await expect(field(page, 'x')).toHaveValue('0');
    await expect(field(page, 'y')).toHaveValue('-106');
    await expect(page.locator('#undo')).toBeDisabled();
  });
}

for (const interruption of ['blur', 'hidden'] as const) {
  test(`a canvas drag interrupted by ${interruption} cancels and accepts the next drag`, async ({ page }) => {
    const box = await page.locator('#editor-stage canvas').boundingBox();
    if (!box) throw new Error('Missing editor canvas');
    const projection = await rigCanvasProjection(page);
    const start = await projection.point(projection.head.x, projection.head.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y + 10, { steps: 4 });
    await expect(page.locator('#validation')).toContainText('pending');
    await page.evaluate((reason) => {
      if (reason === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Reflect.deleteProperty(document, 'visibilityState');
      } else window.dispatchEvent(new Event('blur'));
    }, interruption);
    await expect(page.locator('#validation')).toHaveText('Validation: OK');
    await expect(page.locator('#undo')).toBeDisabled();
    await page.mouse.move(start.x + 50, start.y + 30, { steps: 4 });
    await page.mouse.up();
    await expect(field(page, 'x')).toHaveValue('0');
    await expect(field(page, 'y')).toHaveValue('-106');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y + 10, { steps: 4 });
    await page.mouse.up();
    await expect(field(page, 'x')).not.toHaveValue('0');
    await page.locator('#undo').click();
    await expect(field(page, 'x')).toHaveValue('0');
    await expect(field(page, 'y')).toHaveValue('-106');
    await expect(page.locator('#undo')).toBeDisabled();
  });
}

test('hierarchy selection retains focus, rejects incompatible imports and rebuilds for another character', async ({
  page,
}) => {
  const head = (await rigHierarchy(page)).getByRole('treeitem', { name: 'head', exact: true });
  const slot = (await rigHierarchy(page)).getByRole('treeitem', { name: '◇ headVisual', exact: true });
  await head.click();
  await expect(head).toBeFocused();
  await expect(head).toHaveAttribute('aria-selected', 'true');
  await head.click();
  await expect(head).toBeFocused();
  await expect(head).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#inspector')).toContainText('Select a bone or slot');
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
  await expect(page.locator('#undo')).toBeDisabled();
  await head.click();
  await expect(head).toHaveAttribute('aria-selected', 'true');
  await slot.click();
  await expect(slot).toBeFocused();
  await expect(slot).toHaveAttribute('aria-selected', 'true');
  await expect(head).toHaveAttribute('aria-selected', 'false');
  const original = (await (await page.request.get('characters/demo-puppet/rig.json')).json()) as RigJsonDefinition;
  const imported: RigJsonDefinition = {
    ...original,
    bones: [
      ...original.bones,
      { id: 'importedRoot', parent: original.root },
      { id: 'importedChild', parent: 'importedRoot', y: 20 },
    ],
    slots: [...(original.slots ?? []), { id: 'importedVisual', bone: 'importedChild' }],
  };
  await rigFileAction(page, '#load-json', (control) =>
    control.setInputFiles({
      name: 'different.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported)),
    }),
  );
  const hierarchy = await rigHierarchy(page);
  await expect(page.locator('#action-feedback')).toContainText('same hierarchy');
  await expect(hierarchy.getByRole('treeitem')).toHaveCount(original.bones.length + original.slots!.length);
  await expect(slot).toHaveAttribute('aria-selected', 'true');
  await page.locator('#character-selection').selectOption('random-paperdoll-sketch');
  await expect(page).toHaveURL(/character=random-paperdoll-sketch/);
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  const nextRig = (await (
    await page.request.get('characters/random-paperdoll-sketch/rig.json')
  ).json()) as RigJsonDefinition;
  await rigHierarchy(page);
  await expect(hierarchy.getByRole('treeitem')).toHaveCount(nextRig.bones.length + nextRig.slots!.length);
  await expect(hierarchy.locator('[aria-selected="true"]')).toHaveCount(0);
  await selectRigEntry(page, 'head');
  await expect(page.locator('#inspector h3')).toHaveText('Bone: head');
});

test('hierarchy keyboard navigation selects entries without authoring joint changes', async ({ page }) => {
  const hierarchy = await rigHierarchy(page);
  const head = (await rigHierarchy(page)).getByRole('treeitem', { name: 'head', exact: true });
  const headSlot = (await rigHierarchy(page)).getByRole('treeitem', { name: '◇ headVisual', exact: true });
  await head.click();
  const before = await field(page, 'y').inputValue();
  await head.press('ArrowDown');
  await expect(headSlot).toBeFocused();
  await expect(headSlot).toHaveAttribute('aria-selected', 'true');
  await headSlot.press('ArrowUp');
  await expect(head).toBeFocused();
  await expect(field(page, 'y')).toHaveValue(before);
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
  await expect(page.locator('#undo')).toBeDisabled();
  await head.press('ArrowRight');
  await expect(headSlot).toBeFocused();
  await headSlot.press('ArrowLeft');
  await expect(head).toBeFocused();
  await head.press('Home');
  await expect(hierarchy.getByRole('treeitem').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(hierarchy.getByRole('treeitem').last()).toBeFocused();
  await expect(hierarchy.locator('[tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
});

test('inspector typing keeps focus and Tab groups each field into one undo', async ({ page }) => {
  await selectRigEntry(page, 'head');
  const x = field(page, 'x');
  const y = field(page, 'y');
  await x.click();
  await expect(x).toBeFocused();
  await x.fill('12');
  await x.fill('123');
  await expect(page.locator('#validation')).toHaveText('Validation: pending until editing finishes.');
  await expect(x).toBeFocused();
  await x.press('ArrowUp');
  await expect(x).toHaveValue('124');
  await expect(y).toHaveValue('-106');
  await x.press('Tab');
  await expect(y).toBeFocused();
  await y.fill('-100');
  await y.fill('-90');
  await page.getByRole('heading', { name: 'Rig Editor Bind Pose' }).click();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.locator('#undo').click();
  await expect(x).toHaveValue('124');
  await expect(y).toHaveValue('-106');
  await page.locator('#undo').click();
  await expect(x).toHaveValue('0');
  await expect(page.locator('#undo')).toBeDisabled();
});

for (const name of ['head', '◇ headVisual']) {
  test(`${name} degree readout updates while typing and tabbing without replacing inputs`, async ({ page }) => {
    await selectRigEntry(page, name);
    const rotation = page.locator('#inspector input[data-field="rotation"]');
    const scaleX = page.locator('#inspector input[data-field="scaleX"]');
    const degrees = page.locator('#inspector [data-derived="rotation-degrees"]');
    const originalRotation = await rotation.elementHandle();
    const originalScaleX = await scaleX.elementHandle();
    await expect(degrees).toHaveText('0°');
    await rotation.fill('0.5');
    await expect(rotation).toBeFocused();
    await expect(degrees).toHaveText('28.6479°');
    await rotation.press('Tab');
    await expect(scaleX).toBeFocused();
    await expect(degrees).toHaveText('28.6479°');
    expect(
      await originalRotation.evaluate(
        (input) => input === document.querySelector('#inspector input[data-field="rotation"]'),
      ),
    ).toBe(true);
    expect(
      await originalScaleX.evaluate(
        (input) => input === document.querySelector('#inspector input[data-field="scaleX"]'),
      ),
    ).toBe(true);
    await page.locator('#undo').click();
    await expect(rotation).toHaveValue('0');
    await expect(degrees).toHaveText('0°');
    await page.locator('#redo').click();
    await expect(rotation).toHaveValue('0.5');
    await expect(degrees).toHaveText('28.6479°');
    await (await inspectorControl(page, 'input[data-visibility="artwork"]')).uncheck();
    expect(
      await originalRotation.evaluate(
        (input) => input === document.querySelector('#inspector input[data-field="rotation"]'),
      ),
    ).toBe(true);
    expect(
      await originalScaleX.evaluate(
        (input) => input === document.querySelector('#inspector input[data-field="scaleX"]'),
      ),
    ).toBe(true);
  });
}

test('compatible reloads retain view preferences and keep history controls attached to the active editor', async ({
  page,
}) => {
  const original = await (await page.request.get('characters/demo-puppet/rig.json')).text();
  await selectRigEntry(page, 'head');
  await field(page, 'x').fill('12');
  await rigFileAction(page, '#log-json', (control) => control.click());
  await expect(page.locator('#dirty-status')).toHaveText('No changes');

  for (const source of ['exported', 'original', 'imported'] as const) {
    await page.locator('#edit-mode').selectOption('sprite');
    await page.locator('#grid-snap').selectOption('5');
    await page.locator('#dim-selection').check();
    await (await inspectorControl(page, '#opacity')).selectOption('0.25');
    await (await inspectorControl(page, 'input[data-visibility="artwork"]')).uncheck();
    if (source === 'imported') {
      await rigFileAction(page, '#load-json', (control) =>
        control.setInputFiles({
          name: 'imported.json',
          mimeType: 'application/json',
          buffer: Buffer.from(original),
        }),
      );
      await expect(page.locator('#action-feedback')).toHaveText('imported.json loaded and validated.');
    } else {
      await rigFileAction(page, `#reload-${source}`, (control) => control.click());
      await expect(page.locator('#action-feedback')).toHaveText(
        source === 'exported' ? 'Exported rig reloaded and validated.' : 'Original rig reloaded.',
      );
    }
    await expect(page.locator('#session-status')).toContainText('Selected: head');
    await expect(page.locator('#dirty-status')).toHaveText('No changes');
    await expect(page.locator('#edit-mode')).toHaveValue('sprite');
    await expect(page.locator('#grid-snap')).toHaveValue('5');
    await expect(page.locator('#dim-selection')).toBeChecked();
    await expect(await inspectorControl(page, '#opacity')).toHaveValue('0.25');
    await page.locator('#edit-mode').selectOption('joint');
    await page.locator('#grid-snap').selectOption('0');
    await page.locator('#dim-selection').uncheck();
    await (await inspectorControl(page, '#opacity')).selectOption('1');
    const undoEnabled = await page.locator('#undo').isEnabled();
    const artwork = await inspectorControl(page, 'input[data-visibility="artwork"]');
    await expect(artwork).not.toBeChecked();
    await artwork.check();
    const canvas = page.locator('#editor-stage canvas');
    await waitForPreviewPaint(page);
    const visible = await canvas.screenshot();
    await artwork.uncheck();
    await expect.poll(async () => (await canvas.screenshot()).equals(visible)).toBe(false);
    await artwork.check();
    await expect.poll(async () => (await canvas.screenshot()).equals(visible)).toBe(true);

    await selectRigEntry(page, 'head');
    const expectedX = source === 'exported' ? 12 : 0;
    await expect(field(page, 'x')).toHaveValue(String(expectedX));
    await page.getByRole('heading', { name: 'Rig Editor Bind Pose' }).click();
    await page.keyboard.press('ArrowRight');
    await expect(field(page, 'x')).toHaveValue(String(expectedX + 1));
    await page.locator('#undo').click();
    await expect(field(page, 'x')).toHaveValue(String(expectedX));
    expect(await page.locator('#undo').isEnabled()).toBe(undoEnabled);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Close recovery', exact: true }).click();
  await selectRigEntry(page, 'head');
  await expect(field(page, 'x')).toHaveValue('0');
  await expect(page.locator('#undo')).toBeDisabled();
});
