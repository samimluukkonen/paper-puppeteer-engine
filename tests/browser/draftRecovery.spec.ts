import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { animationFileSchema, rigFileSchema } from '../../src/engine/schemas.js';
import { selectAnimationBone, animationControl, rigFileAction, test, selectRigEntry } from './fixtures.js';

const draftKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('paper-puppeteer:draft:')));

test('new clips absent from the manifest recover after reload with their keys and unsaved status', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-new')).toBeEnabled();
  for (const [name, value] of [
    ['new-one', '42'],
    ['new-two', '84'],
  ]) {
    await page.locator('#animation-new').click();
    const dialog = page.locator('#animation-new-dialog');
    await dialog.getByLabel('Animation name / ID', { exact: true }).fill(name!);
    await dialog.getByRole('button', { name: 'Create Animation', exact: true }).click();
    await selectAnimationBone(page, 'head');
    await page.locator('#animation-bone-fields input[data-property="x"]').fill(value!);
    await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  }
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });
  await page.reload();
  await expect(page.locator('#animation-selection option[value="new-one"]')).toHaveCount(1);
  await expect(page.locator('#animation-selection option[value="new-two"]')).toHaveCount(1);
  await page.locator('#animation-selection').selectOption('new-one');
  await expect(page.locator('#animation-dirty')).toHaveText('New / Unsaved');
  await selectAnimationBone(page, 'head');
  await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveValue('42');
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveValue('0');
  await page.locator('#animation-redo').click();
  await page.locator('#animation-selection').selectOption('new-two');
  await selectAnimationBone(page, 'head');
  await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveValue('84');
});

for (const replacement of ['original', 'imported'] as const) {
  test(`explicit ${replacement} rig replacement discards its own draft without recovering another tab`, async ({
    page,
  }) => {
    await page.goto('rig-editor/');
    await selectRigEntry(page, 'head');
    const x = page.locator('#inspector input[data-scope="bone"][data-field="x"]');
    await x.fill('44');
    await x.press('Tab');
    await expect.poll(() => draftKeys(page)).toHaveLength(1);
    const otherDraft = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((entry) => entry.startsWith('paper-puppeteer:draft:'))!;
      const otherKey = key.replace(/:session:.*$/, ':session:other-tab');
      const text = localStorage.getItem(key)!;
      localStorage.setItem(otherKey, text);
      return { key: otherKey, text };
    });
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });
    if (replacement === 'original') await rigFileAction(page, '#reload-original', (control) => control.click());
    else {
      const json = await readFile(new URL('../../public/characters/demo-puppet/rig.json', import.meta.url), 'utf8');
      await rigFileAction(page, '#load-json', (control) =>
        control.setInputFiles({ name: 'rig.json', mimeType: 'application/json', buffer: Buffer.from(json) }),
      );
    }
    await selectRigEntry(page, 'head');
    await expect(x).toHaveValue('0');
    await expect(page.locator('#dirty-status')).toHaveText('No changes');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain('Discard unsaved rig edits');
    expect(await draftKeys(page)).toEqual([otherDraft.key]);
    expect(await page.evaluate((key) => localStorage.getItem(key), otherDraft.key)).toBe(otherDraft.text);
  });
}

test('two dirty tabs retain independent drafts and saving one preserves the other', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const other = await page.context().newPage();
  try {
    await other.goto(page.url());
    await expect(other.locator('#animation-status')).toHaveText('Validation: OK');
    for (const tab of [page, other]) await (await animationControl(tab, '#animation-mode')).selectOption('stepped');
    await expect.poll(() => draftKeys(page)).toHaveLength(2);
    for (const [tab, fps] of [
      [page, '17'],
      [other, '23'],
    ] as const) {
      const input = await animationControl(tab, '#animation-fps');
      await input.fill(fps);
      await input.press('Tab');
    }
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Object.values(localStorage).filter(
              (text: unknown) => typeof text === 'string' && (text.includes('"fps":17') || text.includes('"fps":23')),
            ).length,
        ),
      )
      .toBe(2);
    await Promise.all([page.waitForEvent('download'), (await animationControl(page, '#animation-download')).click()]);
    await expect.poll(() => draftKeys(page)).toHaveLength(1);
    await expect(other.locator('#animation-dirty')).toHaveText('Unsaved changes');
    other.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await other.reload();
    await expect(await animationControl(other, '#animation-fps')).toHaveValue('23');
    await expect(other.locator('#animation-draft-status')).toContainText('Draft restored');
    await expect.poll(() => draftKeys(page)).toHaveLength(1);
  } finally {
    other.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await other.close();
  }
});

test("navigating away from a clean tab preserves another tab's unsaved animation draft", async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const clean = await page.context().newPage();
  try {
    await clean.goto(page.url());
    await expect(clean.locator('#animation-status')).toHaveText('Validation: OK');
    await (await animationControl(page, '#animation-mode')).selectOption('stepped');
    await expect.poll(() => draftKeys(page)).toHaveLength(1);
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    await clean.goto(new URL('../', page.url()).href);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).toEqual(stored);
    await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  } finally {
    await clean.close();
  }
});

test('rig draft recovery restores unsaved numeric edits as one undoable operation after reload', async ({ page }) => {
  await page.goto('rig-editor/');
  await selectRigEntry(page, 'head');
  const x = page.locator('#inspector input[data-scope="bone"][data-field="x"]');
  await x.fill('44');
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  // Autosave must not end the field's history group while it remains focused.
  await x.fill('45');
  await page.getByRole('heading', { name: 'Rig Editor Bind Pose' }).click();
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.accept();
  });
  await page.reload();
  await expect(page.locator('#rig-draft-status')).toContainText('Draft restored');
  await expect(page.locator('#dirty-status')).toContainText('Unsaved changes');
  await selectRigEntry(page, 'head');
  await expect(x).toHaveValue('45');
  expect(dialogs).toEqual(['beforeunload', 'confirm']);
  await page.locator('#undo').click();
  await expect(x).toHaveValue('0');
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
  await expect.poll(() => draftKeys(page)).toHaveLength(0);
  await page.locator('#redo').click();
  await expect(x).toHaveValue('45');
});

test('animation drafts recover committed settings, exclude temporary fields and clear after download', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await (await animationControl(page, '#animation-mode')).selectOption('stepped');
  await (await animationControl(page, '#animation-fps')).fill('17');
  await (await animationControl(page, '#animation-fps')).press('Tab');
  await selectAnimationBone(page, 'head');
  const x = page.locator('#animation-bone-fields input[data-property="x"]');
  await x.fill('123');
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });
  // Reload immediately: the unload flush must preserve the last edit before the debounce fires.
  await page.reload();
  await expect(page.locator('#animation-draft-status')).toContainText('Draft restored');
  await expect(await animationControl(page, '#animation-mode')).toHaveValue('stepped');
  await expect(await animationControl(page, '#animation-fps')).toHaveValue('17');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await selectAnimationBone(page, 'head');
  await expect(x).toHaveValue('0');
  await page.locator('#animation-undo').click();
  await expect(await animationControl(page, '#animation-mode')).toHaveValue('smooth');
  await expect.poll(() => draftKeys(page)).toHaveLength(0);
  await page.locator('#animation-redo').click();
  await expect(await animationControl(page, '#animation-fps')).toHaveValue('17');
  await Promise.all([page.waitForEvent('download'), (await animationControl(page, '#animation-download')).click()]);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect.poll(() => draftKeys(page)).toHaveLength(0);
});

test("rig recovery retains a child's direction when its parent length was collapsed to zero", async ({ page }) => {
  await page.goto('rig-editor/');
  const field = (name: string) => page.locator(`#inspector input[data-scope="bone"][data-field="${name}"]`);
  await selectRigEntry(page, 'rightForearm');
  await field('x').fill('20');
  await field('y').fill('0');
  await selectRigEntry(page, 'rightUpperArm');
  await field('length').fill('0');
  await field('length').press('Tab');
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });
  await page.reload();
  await expect(page.locator('#rig-draft-status')).toContainText('Draft restored');
  await selectRigEntry(page, 'rightUpperArm');
  await field('length').fill('20');
  await field('length').press('Tab');
  await selectRigEntry(page, 'rightForearm');
  await expect(field('x')).toHaveValue('20');
  await expect(field('y')).toHaveValue('0');
});

test('animation recovery ignores reordered tracks and retains changed-source drafts for download', async ({ page }) => {
  let reordered = false;
  let changed = false;
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    const animation = animationFileSchema.parse(await response.json());
    await route.fulfill({
      json: {
        ...animation,
        tracks: reordered ? Object.fromEntries(Object.entries(animation.tracks).reverse()) : animation.tracks,
        duration: animation.duration + (changed ? 100 : 0),
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await (await animationControl(page, '#animation-mode')).selectOption('stepped');
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });
  reordered = true;
  await page.reload();
  await expect(page.locator('#animation-draft-status')).toContainText('Draft restored');
  await expect(await animationControl(page, '#animation-mode')).toHaveValue('stepped');
  changed = true;
  await page.reload();
  await expect(page.locator('#animation-draft-status')).toContainText('retained');
  await expect(await animationControl(page, '#animation-mode')).toHaveValue('smooth');
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#animation-download-retained-drafts').click(),
  ]);
  const json = await readFile(await download.path(), 'utf8');
  expect(json).toContain('"stepped"');
  expect(download.suggestedFilename()).toBe('retained-editor-drafts.json');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(stored);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('declining animation draft recovery keeps the loaded source and preserves the stored draft', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await (await animationControl(page, '#animation-mode')).selectOption('stepped');
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'beforeunload') await dialog.accept();
    else await dialog.dismiss();
  });
  await page.reload();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(await animationControl(page, '#animation-mode')).toHaveValue('smooth');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
});

test('rig source changes retain unsaved edits for manual download', async ({ page }) => {
  let changed = false;
  await page.route('**/demo-puppet/rig.json', async (route) => {
    const response = await route.fetch();
    const rig = rigFileSchema.parse(await response.json());
    await route.fulfill({ json: { ...rig, ...(changed ? { name: 'Updated source' } : {}) } });
  });
  await page.goto('rig-editor/');
  await selectRigEntry(page, 'head');
  const x = page.locator('#inspector input[data-scope="bone"][data-field="x"]');
  await x.fill('44');
  await x.press('Tab');
  await expect.poll(() => draftKeys(page)).toHaveLength(1);
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });
  changed = true;
  await page.reload();
  await expect(page.locator('#rig-draft-status')).toContainText('retained');
  await selectRigEntry(page, 'head');
  await expect(x).toHaveValue('0');
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#rig-download-retained-drafts').click(),
  ]);
  const json = await readFile(await download.path(), 'utf8');
  expect(json).toContain('"x":44');
  expect(json).toContain('"directions"');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(stored);
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
});
