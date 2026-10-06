import { expect, type Page } from '@playwright/test';
import type { RigJsonDefinition } from '../../src/engine/externalData.js';
import { test } from './fixtures.js';

const field = (page: Page, name: string) => page.locator(`#inspector input[data-scope="bone"][data-field="${name}"]`);

test('unsaved edits block navigation and refresh until exported', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'head', exact: true }).click();
  await field(page, 'x').fill('12');
  const originalUrl = page.url();
  const rejectNavigation = async () => {
    const dialog = await page.waitForEvent('dialog');
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
  };
  await Promise.all([rejectNavigation(), page.getByRole('link', { name: 'Engine demo' }).click()]);
  expect(page.url()).toBe(originalUrl);
  await expect(field(page, 'x')).toHaveValue('12');
  await Promise.all([
    rejectNavigation(),
    page.evaluate(() => {
      setTimeout(() => window.location.reload(), 0);
    }),
  ]);
  await expect(field(page, 'x')).toHaveValue('12');
  await page.locator('#log-json').click();
  await page.getByRole('link', { name: 'Engine demo' }).click();
  await expect(page.locator('#status-text')).toContainText('Current: idle');
});

test.beforeEach(async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.getByRole('treeitem', { name: 'head', exact: true })).toBeVisible();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
});

test('numeric inputs retain precision and clearing length removes the override', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'head', exact: true }).click();
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
  await page.locator('#log-json').click();
  const rig = JSON.parse((await logged).text()) as RigJsonDefinition;
  expect(rig.bones.find((bone) => bone.id === 'head')).not.toHaveProperty('length');
});

test('a canvas drag released outside commits one undo and stops moving', async ({ page }) => {
  const hierarchy = page.locator('#hierarchy');
  const originalEntries = await hierarchy.getByRole('treeitem').elementHandles();
  const canvas = page.locator('#editor-stage canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Missing editor canvas');
  // The sample head joint is at (380, 435 - 16 - 106) in the 760 × 640 scene.
  const start = { x: box.x + (380 / 760) * box.width, y: box.y + (313 / 640) * box.height };
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
  const start = { x: box.x + (380 / 760) * box.width, y: box.y + (313 / 640) * box.height };
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
    await page.getByRole('treeitem', { name: 'head', exact: true }).click();
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
    const head = point(380 + 45, 313 + 35);
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
  test(`a canvas drag interrupted by ${interruption} commits once and accepts the next drag`, async ({ page }) => {
    const box = await page.locator('#editor-stage canvas').boundingBox();
    if (!box) throw new Error('Missing editor canvas');
    const start = { x: box.x + (380 / 760) * box.width, y: box.y + (313 / 640) * box.height };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y + 10, { steps: 4 });
    await expect(page.locator('#validation')).toContainText('pending');
    const editedX = await field(page, 'x').inputValue();
    const editedY = await field(page, 'y').inputValue();
    await page.evaluate((reason) => {
      if (reason === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Reflect.deleteProperty(document, 'visibilityState');
      } else window.dispatchEvent(new Event('blur'));
    }, interruption);
    await expect(page.locator('#validation')).toHaveText('Validation: OK');
    await expect(page.locator('#undo')).toBeEnabled();
    await page.mouse.move(start.x + 50, start.y + 30, { steps: 4 });
    await page.mouse.up();
    await expect(field(page, 'x')).toHaveValue(editedX);
    await expect(field(page, 'y')).toHaveValue(editedY);
    // The second gesture begins at the first gesture's new head position.
    await page.mouse.move(start.x + 20, start.y + 10);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 20, { steps: 4 });
    await page.mouse.up();
    await expect(field(page, 'x')).not.toHaveValue(editedX);
    await page.locator('#undo').click();
    await expect(field(page, 'x')).toHaveValue(editedX);
    await expect(field(page, 'y')).toHaveValue(editedY);
    await page.locator('#undo').click();
    await expect(field(page, 'x')).toHaveValue('0');
    await expect(field(page, 'y')).toHaveValue('-106');
    await expect(page.locator('#undo')).toBeDisabled();
  });
}

test('hierarchy selection retains button focus and rebuilds for a different imported rig', async ({ page }) => {
  const head = page.getByRole('treeitem', { name: 'head', exact: true });
  const slot = page.getByRole('treeitem', { name: '◇ headVisual', exact: true });
  await head.click();
  await expect(head).toBeFocused();
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
  await page.locator('#load-json').setInputFiles({
    name: 'different.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  const hierarchy = page.locator('#hierarchy');
  await expect(page.locator('#action-feedback')).toHaveText('different.json loaded and validated.');
  await expect(hierarchy.getByRole('treeitem')).toHaveCount(imported.bones.length + imported.slots!.length);
  await expect(hierarchy.locator('[aria-selected="true"]')).toHaveCount(0);
  await page.getByRole('treeitem', { name: 'importedChild', exact: true }).click();
  await expect(page.locator('#inspector h3')).toHaveText('Bone: importedChild');
  await expect(field(page, 'y')).toHaveValue('20');
  await page.getByRole('treeitem', { name: '◇ importedVisual', exact: true }).click();
  await expect(page.locator('#inspector h3')).toHaveText('Slot: importedVisual');
  await expect(hierarchy.locator('[aria-selected="true"]')).toHaveText('◇ importedVisual');
});

test('hierarchy keyboard navigation selects entries without authoring joint changes', async ({ page }) => {
  const hierarchy = page.locator('#hierarchy');
  const head = page.getByRole('treeitem', { name: 'head', exact: true });
  const headSlot = page.getByRole('treeitem', { name: '◇ headVisual', exact: true });
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
  await page.getByRole('treeitem', { name: 'head', exact: true }).click();
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
    await page.getByRole('treeitem', { name, exact: true }).click();
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
  });
}

test('exported, original and imported reloads keep controls attached to the active editor', async ({ page }) => {
  const original = await (await page.request.get('characters/demo-puppet/rig.json')).text();
  await page.getByRole('treeitem', { name: 'head', exact: true }).click();
  await field(page, 'x').fill('12');
  await page.locator('#log-json').click();
  await expect(page.locator('#dirty-status')).toHaveText('No changes');

  for (const source of ['exported', 'original', 'imported'] as const) {
    await page.locator('#edit-mode').selectOption('sprite');
    await page.locator('#grid-snap').selectOption('5');
    await page.locator('#dim-selection').check();
    await page.locator('#opacity').selectOption('0.25');
    await page.locator('input[data-visibility="artwork"]').uncheck();
    if (source === 'imported') {
      await page.locator('#load-json').setInputFiles({
        name: 'imported.json',
        mimeType: 'application/json',
        buffer: Buffer.from(original),
      });
      await expect(page.locator('#action-feedback')).toHaveText('imported.json loaded and validated.');
    } else {
      await page.locator(`#reload-${source}`).click();
      await expect(page.locator('#action-feedback')).toHaveText(
        source === 'exported' ? 'Exported rig reloaded and validated.' : 'Original rig reloaded.',
      );
    }
    await expect(page.locator('#session-status')).toContainText('Selected: none');
    await expect(page.locator('#dirty-status')).toHaveText('No changes');
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#redo')).toBeDisabled();
    await expect(page.locator('#edit-mode')).toHaveValue('joint');
    await expect(page.locator('#grid-snap')).toHaveValue('0');
    await expect(page.locator('#dim-selection')).not.toBeChecked();
    await expect(page.locator('#opacity')).toHaveValue('1');
    const artwork = page.locator('input[data-visibility="artwork"]');
    await expect(artwork).toBeChecked();
    const canvas = page.locator('#editor-stage canvas');
    const visible = await canvas.screenshot();
    await artwork.uncheck();
    await expect.poll(async () => (await canvas.screenshot()).equals(visible)).toBe(false);
    await artwork.check();
    await expect.poll(async () => (await canvas.screenshot()).equals(visible)).toBe(true);

    await page.getByRole('treeitem', { name: 'head', exact: true }).click();
    const expectedX = source === 'exported' ? 12 : 0;
    await expect(field(page, 'x')).toHaveValue(String(expectedX));
    await page.getByRole('heading', { name: 'Rig Editor Bind Pose' }).click();
    await page.keyboard.press('ArrowRight');
    await expect(field(page, 'x')).toHaveValue(String(expectedX + 1));
    await page.locator('#undo').click();
    await expect(field(page, 'x')).toHaveValue(String(expectedX));
    await expect(page.locator('#undo')).toBeDisabled();
  }
  await page.reload();
  await page.getByRole('treeitem', { name: 'head', exact: true }).click();
  await expect(field(page, 'x')).toHaveValue('0');
  await expect(page.locator('#undo')).toBeDisabled();
});
