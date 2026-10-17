import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { loadPackageDefinition } from '../../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip } from '../../src/devtools/shared/package/packageZip.js';
import { animationHierarchy, test, rigHierarchy, inspectorControl, selectRigEntry } from './fixtures.js';

test('build a new character, import and align artwork, animate, export and reload runtime playback', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('rig-editor/');
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new character', exact: true });
  await dialog.getByLabel('Character name', { exact: true }).fill('Branch Creature');
  await dialog.getByRole('button', { name: 'Create Character', exact: true }).click();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  const skeleton = page.getByRole('region', { name: 'Build skeleton', exact: true });
  await selectRigEntry(page, 'root');
  await skeleton.getByLabel('Bone ID / name', { exact: true }).fill('base');
  await skeleton.getByRole('button', { name: 'Rename bone', exact: true }).click();
  for (const id of ['trunk', 'branch']) {
    await skeleton.getByLabel('New bone ID', { exact: true }).fill(id);
    await skeleton.getByRole('button', { name: '+ Add Bone', exact: true }).click();
    await expect((await rigHierarchy(page)).getByRole('treeitem', { name: id, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
  const x = page.locator('#inspector [data-scope=bone][data-field=x]');
  await x.fill('35');
  await x.blur();
  page.once('dialog', (confirmation) => {
    void confirmation.dismiss();
  });
  await skeleton.getByLabel('Parent bone', { exact: true }).selectOption('base');
  await expect(skeleton.getByLabel('Parent bone', { exact: true })).toHaveValue('trunk');
  page.once('dialog', (confirmation) => {
    void confirmation.accept();
  });
  await skeleton.getByLabel('Parent bone', { exact: true }).selectOption('base');
  await expect(skeleton.getByLabel('Parent bone', { exact: true })).toHaveValue('base');
  await page.locator('#undo').click();
  await expect(skeleton.getByLabel('Parent bone', { exact: true })).toHaveValue('trunk');
  await page.locator('#redo').click();
  await expect(skeleton.getByLabel('Parent bone', { exact: true })).toHaveValue('base');
  await expect(x).toHaveValue('35');

  // Recover topology before importing images, which intentionally live only in this session.
  const accept = (confirmation: import('@playwright/test').Dialog) => {
    void confirmation.accept();
  };
  page.on('dialog', accept);
  await page.reload();
  await expect(page.locator('#hierarchy [role=treeitem]')).toHaveText(['base', 'trunk', 'branch']);
  page.off('dialog', accept);
  await selectRigEntry(page, 'branch');
  await expect(x).toHaveValue('35');
  await skeleton.getByLabel('New slot ID', { exact: true }).fill('branch-visual');
  await skeleton.getByRole('button', { name: '+ Add Slot', exact: true }).click();
  await expect(
    (await rigHierarchy(page)).getByRole('treeitem', { name: '◇ branch-visual', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  const artwork = page.locator('#editor-app #artwork-panel');
  await artwork.locator(':scope > summary').click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 48;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ac2345';
    context.fillRect(8, 4, 16, 40);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await artwork.getByLabel('Import new artwork', { exact: true }).setInputFiles({
    name: 'my-leaf.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(artwork).toContainText('Artwork added to the library.');
  const attachments = page.locator('#editor-app #attachment-panel');
  await inspectorControl(page, '#editor-app #attachment-panel select');
  await attachments.getByLabel('Attachment ID', { exact: true }).fill('leaf-appearance');
  await attachments.getByRole('button', { name: 'Create attachment', exact: true }).click();
  await attachments.getByLabel('Assigned attachment', { exact: true }).selectOption('leaf-appearance');
  await expect(page.locator('#inspector [data-scope=attachment][data-field=originX]').first()).toBeVisible();
  for (const [field, value] of [
    ['originX', '0.25'],
    ['originY', '0.1'],
    ['x', '-8'],
    ['y', '3'],
  ] as const) {
    const input = page.locator(`#inspector [data-scope=attachment][data-field=${field}]`).first();
    await input.fill(value);
    await input.blur();
  }
  await page.locator('#inspector [data-scope=slot][data-field=depth]').fill('12');
  await page.locator('#inspector [data-scope=slot][data-field=depth]').blur();
  await page.locator('#rig-facing').selectOption('left');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await selectRigEntry(page, 'branch');
  await skeleton.getByRole('button', { name: 'Remove bone', exact: true }).click();
  await expect(skeleton).toContainText('slot "branch-visual"');
  await expect((await rigHierarchy(page)).getByRole('treeitem', { name: 'branch', exact: true })).toBeVisible();
  await skeleton.getByLabel('New bone ID', { exact: true }).fill('bud');
  await skeleton.getByRole('button', { name: '+ Add Bone', exact: true }).click();
  await page.locator('#undo').click();
  await expect((await rigHierarchy(page)).getByRole('treeitem', { name: 'bud', exact: true })).toHaveCount(0);
  await page.locator('#redo').click();
  await expect((await rigHierarchy(page)).getByRole('treeitem', { name: 'bud', exact: true })).toBeVisible();
  await selectRigEntry(page, '◇ branch-visual');
  await expect(attachments.getByLabel('Assigned attachment', { exact: true })).toHaveValue('leaf-appearance');
  await expect(page.locator('#inspector [data-scope=attachment][data-field=originX]').first()).toHaveValue('0.25');
  await expect(artwork.getByLabel('Artwork asset', { exact: true })).toHaveValue('my-leaf');

  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#animation-selection')).toContainText('No animation');
  await expect(page.locator('#animation-new')).toBeEnabled();
  await page.locator('#animation-new').click();
  const animationDialog = page.getByRole('dialog', { name: 'Create new animation', exact: true });
  await animationDialog.getByLabel('Animation name / ID', { exact: true }).fill('idle');
  await animationDialog.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await expect(page.locator('.timeline-keyframe')).toHaveCount(0);
  await (await animationHierarchy(page)).getByRole('button', { name: 'branch', exact: true }).click();
  for (const [time, rotation] of [
    ['0', '0'],
    ['0.5', '90'],
    ['1', '0'],
  ]) {
    await page.locator('#timeline-time-input').fill(time!);
    await page.locator('#timeline-time-input').press('Enter');
    await page.locator('#animation-bone-fields input[data-property="rotation"]').fill(rotation!);
    await page.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  }
  await page.locator('#animation-undo').click();
  await page.locator('#animation-redo').click();
  await page.locator('#play-pause').click();
  await expect(page.locator('#play-pause')).toHaveAttribute('aria-label', 'Pause');
  await page.locator('#play-pause').click();
  await expect(page.locator('#animation-dirty')).toHaveText('New / Unsaved');
  const animationDownload = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const animationJson = JSON.parse(await readFile(await (await animationDownload).path(), 'utf8')) as unknown;
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(page.locator('#dirty-status')).toHaveText('Unsaved changes *');
  await expect(page.locator('#hierarchy [role=treeitem]')).toHaveText([
    'base',
    'trunk',
    'branch',
    '◇ branch-visual',
    'bud',
  ]);
  const packages = page.locator('#editor-app .package-tools');
  await packages.locator(':scope > summary').click();
  await expect(packages.getByLabel('Character readiness')).toContainText('Ready for export validation.');
  const downloading = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const download = await downloading;
  const files = decodePackageZip(new Uint8Array(await readFile(await download.path())));
  const definition = await loadPackageDefinition(files);
  expect(definition.rig.root).toBe('base');
  expect(definition.rig.getBone('branch').parent).toBe('base');
  expect(definition.rig.getBone('branch').x).toBe(35);
  expect(definition.rig.getBone('bud').parent).toBe('branch');
  expect(definition.rig.getSlot('branch-visual').depth).toBe(12);
  expect(definition.rig.getAttachment('leaf-appearance')).toMatchObject({
    texture: 'my-leaf',
    originX: 0.25,
    originY: 0.1,
    x: -8,
    y: 3,
  });
  expect(definition.rig.skins[0]!.slots['branch-visual']).toBe('leaf-appearance');
  expect(Buffer.from(files.get('images/my-leaf.png')!)).toEqual(Buffer.from(png, 'base64'));
  expect(definition.animations).toHaveLength(1);
  expect(definition.animations[0]!.tracks.branch?.map((key) => key.time)).toEqual([0, 500, 1000]);
  expect(JSON.parse(new TextDecoder().decode(files.get('animations/idle.json')))).toEqual(animationJson);
  for (const [path, bytes] of files) {
    if (path.endsWith('.json'))
      expect(new TextDecoder().decode(bytes)).not.toMatch(/demo-puppet|random-paperdoll-sketch|blob:|__paper_artwork_/);
  }
  const archive = Buffer.from(await readFile(await download.path()));
  // Exercise both exact exported bytes and a saved ZIP, with a fresh game and URL lease each time.
  for (const mode of ['reload', 'import', 'reload']) {
    if (mode === 'import')
      await packages
        .getByLabel('Import ZIP for runtime preview')
        .setInputFiles({ name: 'branch-creature.zip', mimeType: 'application/zip', buffer: archive });
    else await packages.getByRole('button', { name: 'Reload exported package', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Package runtime preview', exact: true });
    await expect(preview).toContainText('runtime playback ready');
    await expect(preview.getByLabel('Animation', { exact: true })).toHaveValue('idle');
    const canvas = preview.locator('canvas');
    const frame = await canvas.screenshot();
    await expect.poll(async () => (await canvas.screenshot()).equals(frame)).toBe(false);
    await preview.getByRole('button', { name: 'Close preview', exact: true }).click();
    await expect(page.locator('#package-runtime-stage')).toHaveCount(0);
  }
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeEnabled();
});
