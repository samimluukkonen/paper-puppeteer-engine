import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { packageJson } from '../../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip } from '../../src/devtools/shared/package/packageZip.js';
import { animationFileSchema, characterManifestSchema } from '../../src/engine/schemas.js';
import { animationControl, animationFileAction, animationHierarchy, animationMenuControl, test } from './fixtures.js';

async function create(page: Page, name: string) {
  await page.locator('#animation-new').click();
  const dialog = page.getByRole('dialog', { name: 'Create new animation', exact: true });
  await dialog.getByLabel('Animation name / ID', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#animation-selection')).toHaveValue(name);
}

test('rig with no animation files: create, author, play, export, reload and package two new clips', async ({
  page,
}) => {
  test.setTimeout(90_000);
  let animationRequests = 0;
  page.on('request', (request) => {
    if (/\/characters\/demo-puppet\/animations\/.*\.json/.test(request.url())) animationRequests++;
  });
  await page.route('**/characters/demo-puppet/character.json', async (route) => {
    const response = await route.fetch();
    const manifest = characterManifestSchema.parse(await response.json());
    await route.fulfill({ response, json: { ...manifest, animations: [] } });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('This character has no animations.');
  await expect(page.locator('#animation-new')).toBeEnabled();
  expect(animationRequests).toBe(0);
  const canvas = page.locator('#animation-stage canvas');
  // Hide debug overlays so only the unchanged character pose is compared.
  await page.locator('#animation-show-bones').uncheck();
  await (await animationMenuControl(page, '#animation-ik-handles')).uncheck();
  await page.locator('#animation-preview-menu > summary').click();
  const bindPose = await canvas.screenshot({ path: test.info().outputPath('bind.png') });
  await create(page, 'idle');
  await expect(page.locator('#current-time')).toHaveText('0.000 / 1.000 s');
  await expect(page.locator('#play-pause')).toHaveAttribute('aria-label', 'Play');
  await expect(page.locator('#animation-dirty')).toHaveText('New / Unsaved');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('.timeline-keyframe, .timeline-event')).toHaveCount(0);
  expect((await canvas.screenshot({ path: test.info().outputPath('created.png') })).equals(bindPose)).toBe(true);
  await (await animationHierarchy(page)).getByRole('button', { name: 'head', exact: true }).click();
  for (const [time, rotation] of [
    ['0', '0'],
    ['0.5', '30'],
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
  await (await animationControl(page, '#animation-interpolation')).selectOption('linear');
  const waiting = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('idle.json');
  const json = await readFile(await download.path(), 'utf8');
  const authored = animationFileSchema.parse(JSON.parse(json));
  expect(authored.tracks.head?.map((key) => key.time)).toEqual([0, 500, 1000]);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await create(page, 'second');
  await page.locator('#animation-selection').selectOption('idle');
  await (await animationHierarchy(page)).getByRole('button', { name: 'head', exact: true }).click();
  await animationFileAction(page, '#animation-import-file', (control) =>
    control.setInputFiles({ name: 'idle.json', mimeType: 'application/json', buffer: Buffer.from(json) }),
  );
  const secondDownload = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  expect(animationFileSchema.parse(JSON.parse(await readFile(await (await secondDownload).path(), 'utf8')))).toEqual(
    authored,
  );
  const packages = page.locator('.package-tools');
  await packages.locator(':scope > summary').click();
  const zipWaiting = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const zip = await zipWaiting;
  const files = decodePackageZip(await readFile(await zip.path()));
  const manifest = characterManifestSchema.parse(packageJson(files, 'character.json'));
  expect(manifest.animations).toEqual(['animations/idle.json', 'animations/second.json']);
  expect(packageJson(files, 'animations/idle.json')).toEqual(authored);
  await packages.getByRole('button', { name: 'Reload exported package', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Package runtime preview' });
  await expect(preview).toContainText('runtime playback ready');
  await preview.getByRole('button', { name: 'Close preview' }).click();
});

test('existing clips: cancellation, duplicate validation, multiple unsaved documents and navigation protection', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await page.locator('#animation-new').click();
  const dialog = page.locator('#animation-new-dialog');
  await dialog.getByLabel('Animation name / ID', { exact: true }).fill('idle');
  await dialog.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already registered');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await page.locator('#animation-selection').selectOption('');
  await expect(page.locator('#animation-new')).toBeEnabled();
  await create(page, 'new-idle');
  await create(page, 'new-walk');
  await page.locator('#animation-selection').selectOption('idle');
  const rejected = page.waitForEvent('dialog').then((prompt) => prompt.dismiss());
  await page.getByRole('link', { name: 'Engine demo' }).click();
  await rejected;
  await expect(page.locator('#animation-new')).toBeVisible();
  await page.locator('#animation-selection').selectOption('new-idle');
  await expect(page.locator('#animation-dirty')).toHaveText('New / Unsaved');
});
