import { expect } from '@playwright/test';
import { parseRigDefinition } from '../../src/engine/externalData.js';
import { rigFileAction, test, rigHierarchy, selectRigEntry } from './fixtures.js';

test('sketch loads all parts, exports edits, and stays selected across views', async ({ page }) => {
  await page.goto('rig-editor/?character=random-paperdoll-sketch');
  await expect(page.locator('#session-status')).toContainText('Character: random-paperdoll-sketch');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await expect((await rigHierarchy(page)).getByRole('treeitem')).toHaveCount(34);
  const rig = parseRigDefinition(await (await page.request.get('characters/random-paperdoll-sketch/rig.json')).json());
  expect(rig.attachments.find((attachment) => attachment.id === 'headDefault')!.scaleX).toBe(-0.3);
  for (const side of ['left', 'right']) {
    const depth = (id: string): number => {
      const slot = rig.slots.find((slot) => slot.id === id);
      if (slot?.depth === undefined) throw new Error(`Missing authored depth for slot "${id}".`);
      return slot.depth;
    };
    expect(depth(`${side}HandVisual`)).toBeLessThan(depth(`${side}ForearmVisual`));
  }
  for (const [bone, side] of [
    ['leftUpperArm', 1],
    ['rightUpperArm', -1],
    ['leftThigh', 1],
    ['rightThigh', -1],
  ] as const) {
    await selectRigEntry(page, bone);
    const offset = Number(await page.locator('#inspector input[data-scope="bone"][data-field="x"]').inputValue());
    expect(offset * side).toBeGreaterThan(0);
  }
  await selectRigEntry(page, 'head');
  const x = page.locator('#inspector input[data-scope="bone"][data-field="x"]');
  await x.fill('4');
  await x.press('Tab');
  const download = page.waitForEvent('download');
  await page.locator('#download-json').click();
  expect((await download).suggestedFilename()).toBe('rig.json');
  await rigFileAction(page, '#reload-exported', (control) => control.click());
  await selectRigEntry(page, 'head');
  await expect(x).toHaveValue('4');
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#character-status')).toHaveText('Character: random-paperdoll-sketch');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(page.locator('#character-selection')).toHaveValue('random-paperdoll-sketch');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
});

test('character selection protects unsaved rig edits and can return to the demo puppet', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('combobox', { name: 'Character', exact: true }).selectOption('random-paperdoll-sketch');
  await expect(page.locator('#session-status')).toContainText('Character: random-paperdoll-sketch');
  await selectRigEntry(page, 'head');
  const x = page.locator('#inspector input[data-scope="bone"][data-field="x"]');
  await x.fill('8');
  await x.press('Tab');
  const rejectNavigation = async () => {
    const dialog = await page.waitForEvent('dialog');
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
  };
  await Promise.all([
    rejectNavigation(),
    page.getByRole('combobox', { name: 'Character', exact: true }).selectOption('demo-puppet'),
  ]);
  await expect(x).toHaveValue('8');
  await expect(page.locator('#character-selection')).toHaveValue('random-paperdoll-sketch');
  await rigFileAction(page, '#log-json', (control) => control.click());
  await page.getByRole('combobox', { name: 'Character', exact: true }).selectOption('demo-puppet');
  await expect(page.locator('#session-status')).toContainText('Character: demo-puppet');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
});
