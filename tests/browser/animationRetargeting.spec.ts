import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { buildProjectPackage, importProjectPackage } from '../../src/devtools/project/projectPackage.js';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { decodePackageZip, encodePackageZip } from '../../src/engine/packageZip.js';
import { retargetFixture } from '../helpers/retargetFixture.js';
import { inspectorControl, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

test('visual retargeting compares real mesh/rigid characters, repairs maps, creates an editable target and survives recovery/export', async ({
  page,
}, info) => {
  const { project, sourceClip } = await retargetFixture();
  const files = (await buildProjectPackage(project)).files;
  await page.goto('project/');
  await page
    .getByLabel('Import Project', { exact: true })
    .setInputFiles({ name: 'samurai.zip', mimeType: 'application/zip', buffer: Buffer.from(encodePackageZip(files)) });
  await expect(page.getByRole('heading', { name: 'Samurai comparison', exact: true })).toBeVisible();
  const library = page.getByRole('region', { name: 'Project animation library', exact: true });
  await library.locator('.animation-library > summary').click();
  await library.getByRole('button', { name: 'Retarget to Another Character', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Retarget Animation', exact: true });
  await expect(dialog.getByRole('button', { name: 'Preview Result', exact: true })).toBeDisabled();
  await dialog.getByLabel('Target character', { exact: true }).selectOption('target');
  await dialog.getByLabel('Bone mapping', { exact: true }).selectOption('samurai-map');
  await expect(dialog).toContainText('Validated mapping');
  await dialog.getByRole('button', { name: 'Preview Result', exact: true }).click();
  await expect(dialog).toContainText('Comparison ready.');
  await expect(dialog).toContainText('mesh-omitted');
  await expect(dialog).toContainText('Bake source IK');
  const canvas = dialog.locator('canvas');
  const start = await canvas.screenshot();
  await dialog.getByLabel('Comparison time', { exact: true }).press('End');
  await expect(dialog.getByLabel('Shared preview time')).toHaveText('1000 / 1000 ms');
  expect((await canvas.screenshot()).equals(start)).toBe(false);
  await dialog.getByLabel('Show ground reference', { exact: true }).check();
  await dialog.getByLabel('Ground Y', { exact: true }).fill('20');
  await dialog.getByLabel('Show foot contact markers', { exact: true }).check();
  await dialog.getByLabel('Playback speed', { exact: true }).selectOption('0.5');
  await dialog.getByRole('button', { name: 'Play', exact: true }).click();
  await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.screenshot({ path: info.outputPath('retarget-comparison.png') });
  await dialog.getByLabel('Root motion', { exact: true }).selectOption('scale-by-character');
  await expect(dialog.getByRole('button', { name: 'Create Animation', exact: true })).toBeDisabled();
  await expect(canvas).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Review / adjust bone mapping', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove correspondence for lower', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Save Mapping', exact: true })).toBeDisabled();
  await dialog.getByLabel('Target for lower', { exact: true }).selectOption('lower');
  await dialog.getByRole('button', { name: 'Validate', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save Mapping', exact: true }).click();
  await expect(dialog).toContainText('Comparison ready.');
  await expect(dialog.getByRole('button', { name: 'Create Animation', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const frame = await (await page.locator('iframe:visible').elementHandle())?.contentFrame();
  if (!frame) throw new Error('Target Animation Editor did not open');
  await expect(frame.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(frame.locator('#animation-selection')).toHaveValue(/^retarget-/);
  const id = await frame.locator('#animation-selection').inputValue();
  await inspectorControl(frame, '#animation-bones');
  await frame.locator('#animation-bones').getByRole('button', { name: 'lower', exact: true }).click();
  const x = await inspectorControl(frame, '#animation-bone-fields input[data-property="x"]');
  await x.fill('43');
  await x.press('Tab');
  await frame.getByRole('button', { name: 'Set X key', exact: true }).click();
  await expect(frame.locator('#animation-undo')).toBeEnabled();
  await frame.locator('#animation-undo').click();
  await frame.locator('#animation-redo').click();
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await expect(library.locator('.animation-library-list li')).toHaveCount(2);
  const guide = guideRegistry.getGuideById('project-animation-retargeting')!;
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await catalog.getByRole('button', { name: 'Project Workspace', exact: true }).click();
  await catalog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
  const tour = page.getByRole('dialog', { name: guide.title, exact: true });
  for (const [index, step] of guide.steps.entries()) {
    await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
    await expect(tour).not.toContainText('Target unavailable');
    await tour.getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true }).click();
  }
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  await page.reload();
  await page
    .getByRole('dialog', { name: 'Recover unsaved work?', exact: true })
    .getByRole('button', { name: 'Recover Draft', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Samurai comparison', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const path = await (await download).path();
  const restored = await importProjectPackage(decodePackageZip(new Uint8Array(await readFile(path))));
  expect(restored.captureCharacter('source').animations).toEqual([sourceClip]);
  const result = restored.captureCharacter('target').animations[0]!;
  expect(result.name).toBe(id);
  expect(result.tracks.lower![0]!.x).toBe(43);
  expect(result.rootMotion!.translationKeys[1]!.x).toBeCloseTo(170);
  expect(result.disabledIKConstraints).toEqual(['target-arm']);
  await page.getByLabel('Import Project', { exact: true }).setInputFiles(path);
  await library.locator('.animation-library > summary').click();
  await expect(library.locator('.animation-library-list li')).toHaveCount(2);
});

test('cancel before and after preview loading releases temporary canvases and object URLs without registering a clip', async ({
  page,
}) => {
  const { project } = await retargetFixture();
  await page.goto('project/');
  await page.getByLabel('Import Project', { exact: true }).setInputFiles({
    name: 'cancel.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(encodePackageZip((await buildProjectPackage(project)).files)),
  });
  await expect(page.getByRole('heading', { name: 'Samurai comparison', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const urls = new Set<string>();
    Object.assign(window, { retargetUrls: urls });
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      urls.delete(url);
      revoke(url);
    };
  });
  const library = page.getByRole('region', { name: 'Project animation library', exact: true });
  await library.locator('.animation-library > summary').click();
  for (const waitForReady of [false, true, true]) {
    await library.getByRole('button', { name: 'Retarget to Another Character', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Retarget Animation', exact: true });
    await dialog.getByLabel('Target character', { exact: true }).selectOption('target');
    await dialog.getByLabel('Bone mapping', { exact: true }).selectOption('samurai-map');
    await dialog.getByRole('button', { name: 'Preview Result', exact: true }).click();
    if (waitForReady) await expect(dialog).toContainText('Comparison ready.');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.retarget-comparison-stage canvas')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { retargetUrls: Set<string> }).retargetUrls.size))
      .toBe(0);
    await expect(library.locator('.animation-library-list li')).toHaveCount(1);
    await expect(page.locator('iframe')).toHaveCount(0);
  }
});
