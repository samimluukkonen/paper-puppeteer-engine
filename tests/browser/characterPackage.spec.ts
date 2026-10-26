import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { packageJson } from '../../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip } from '../../src/devtools/shared/package/packageZip.js';
import { characterManifestSchema, rigFileSchema } from '../../src/engine/schemas.js';
import { test, selectRigEntry, inspectorControl } from './fixtures.js';

test('package preview exposes controls only after its artwork and puppet are ready', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('tab', { name: 'Character package', exact: true }).click();
  const packages = page.locator('.package-tools');
  await packages.locator(':scope > summary').click();
  const download = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  await download;
  await page.evaluate(() => {
    // oxlint-disable-next-line typescript/unbound-method -- Resume the native method with its original XMLHttpRequest receiver.
    const send = XMLHttpRequest.prototype.send;
    const pending: (() => void)[] = [];
    let hold = true;
    // Hold artwork requests after metadata validation without relying on a timed delay.
    XMLHttpRequest.prototype.send = function (body) {
      if (hold) pending.push(() => send.call(this, body));
      else send.call(this, body);
    };
    Reflect.set(window, 'packageArtworkGate', {
      get count() {
        return pending.length;
      },
      release() {
        hold = false;
        for (const resume of pending.splice(0)) resume();
      },
    });
  });
  await packages.getByRole('button', { name: 'Reload exported package', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Package runtime preview', exact: true });
  await expect
    .poll(() => page.evaluate(() => (Reflect.get(window, 'packageArtworkGate') as { count: number }).count))
    .toBeGreaterThan(0);
  await expect(dialog.locator('select')).toHaveCount(0);
  await page.evaluate(() => (Reflect.get(window, 'packageArtworkGate') as { release(): void }).release());
  await expect(dialog).toContainText('runtime playback ready', { timeout: 30_000 });
  await expect(dialog.locator('select')).toHaveCount(3);
  await dialog.getByLabel('Animation', { exact: true }).selectOption('walk');
  await dialog.getByLabel('Skin', { exact: true }).selectOption('alternate');
  await dialog.getByLabel('Facing', { exact: true }).selectOption('left');
  await expect(dialog.getByLabel('Facing', { exact: true })).toHaveValue('left');
  await dialog.getByRole('button', { name: 'Close preview' }).click();
  await packages.getByRole('button', { name: 'Reload exported package', exact: true }).click();
  await expect(dialog).toContainText('runtime playback ready', { timeout: 30_000 });
  await expect(dialog.getByLabel('Facing', { exact: true })).toHaveValue('right');
  await dialog.getByRole('button', { name: 'Close preview' }).click();
});

test('static WebP replacement exports and reloads with guarded runtime image loading', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  const artwork = page.locator('#artwork-panel');
  await inspectorControl(page, '#artwork-panel');
  await artwork.getByLabel('Artwork asset', { exact: true }).selectOption('paper-left-forearm');
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 80;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ff00ff';
    context.fillRect(6, 2, 20, 76);
    return canvas.toDataURL('image/webp').split(',')[1]!;
  });
  await artwork.getByLabel('Import sprite').setInputFiles({
    name: 'forearm.webp',
    mimeType: 'image/webp',
    buffer: Buffer.from(encoded, 'base64'),
  });
  await artwork.getByLabel('Alignment policy').selectOption('pixels');
  await artwork.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
  await artwork.getByRole('button', { name: 'Apply Replacement', exact: true }).click();
  await page.getByRole('tab', { name: 'Character package', exact: true }).click();
  const packages = page.locator('.package-tools');
  await packages.locator(':scope > summary').click();
  const waiting = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const download = await waiting;
  const path = await download.path();
  if (!path) throw new Error('Missing ZIP download');
  const files = decodePackageZip(await readFile(path));
  const manifest = characterManifestSchema.parse(packageJson(files, 'character.json'));
  expect(manifest.textures['paper-left-forearm']).toMatch(/\.webp$/);
  expect(Buffer.from(files.get(manifest.textures['paper-left-forearm']!)!)).toEqual(Buffer.from(encoded, 'base64'));
  await packages.getByRole('button', { name: 'Reload exported package', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Package runtime preview' });
  await expect(dialog).toContainText('runtime playback ready', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Close preview' }).click();
});

for (const editor of ['rig', 'animation'] as const) {
  test(`${editor} artwork and elbow edits export a complete ZIP and reload in production Puppet playback`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      const stats = { started: 0, finished: 0, uiTicks: 0 };
      Reflect.set(window, 'packageZipWorkerStats', stats);
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (!String(url).includes('packageZip.worker')) return;
          ++stats.started;
          const timer = window.setInterval(() => ++stats.uiTicks, 0);
          this.addEventListener(
            'message',
            () => {
              window.clearInterval(timer);
              ++stats.finished;
            },
            { once: true },
          );
        }
      };
    });
    await page.goto(`${editor}-editor/`);
    await expect(page.locator(editor === 'rig' ? '#validation' : '#animation-status')).toHaveText('Validation: OK');
    await page.getByRole('tab', { name: 'Character package', exact: true }).click();
    const packages = page.locator('.package-tools');
    await packages.locator(':scope > summary').click();
    await expect(packages).toContainText('Rig: Clean');
    await expect(packages).toContainText('Animations: Clean');
    await page.getByRole('tab', { name: 'Edit', exact: true }).click();
    if (editor === 'animation') {
      await page.locator('#animation-selection').selectOption('walk');
      await page.getByRole('combobox', { name: 'Editor Mode', exact: true }).selectOption('rig-tweak');
    }
    await selectRigEntry(page, 'leftForearm');
    const joint = page.locator(
      `${editor === 'animation' ? '#tweak-inspector' : '#inspector'} input[data-scope="bone"][data-field="y"]`,
    );
    await joint.fill('77');
    await joint.press('Tab');
    await expect(packages).toContainText('Rig: Modified');
    if (editor === 'animation')
      await page.getByRole('combobox', { name: 'Editor Mode', exact: true }).selectOption('animation');
    const artwork = page.locator('#artwork-panel');
    await inspectorControl(page, '#artwork-panel');
    await artwork.getByLabel('Artwork asset', { exact: true }).selectOption('paper-left-forearm');
    const encoded = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 80;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ff00ff';
      context.fillRect(6, 2, 20, 76);
      return canvas.toDataURL('image/png').split(',')[1]!;
    });
    await artwork
      .getByLabel('Import sprite')
      .setInputFiles({ name: 'forearm.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
    await artwork.getByLabel('Alignment policy').selectOption('pixels');
    await artwork.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
    await artwork.getByRole('button', { name: 'Apply Replacement', exact: true }).click();
    await expect(packages).toContainText('Assets: Modified');
    if (editor === 'animation')
      await page.getByRole('combobox', { name: 'Editor Mode', exact: true }).selectOption('animation');
    await page.getByRole('tab', { name: 'Character package', exact: true }).click();
    const waiting = page.waitForEvent('download');
    await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
    const download = await waiting,
      path = await download.path();
    expect(download.suggestedFilename()).toBe('demo-puppet.zip');
    if (!path) throw new Error('Missing ZIP download');
    const bytes = await readFile(path);
    const files = decodePackageZip(bytes);
    const manifest = characterManifestSchema.parse(packageJson(files, 'character.json'));
    const rig = rigFileSchema.parse(packageJson(files, manifest.rig));
    expect(rig.bones.find((bone) => bone.id === 'leftForearm')!.y).toBe(77);
    expect(Buffer.from(files.get(manifest.textures['paper-left-forearm']!)!)).toEqual(Buffer.from(encoded, 'base64'));
    for (const asset of [...Object.values(manifest.skins), ...manifest.animations, ...Object.values(manifest.textures)])
      expect(files.has(asset)).toBe(true);
    await expect(packages).toContainText('Rig: Clean');
    await expect(packages).toContainText('Assets: Clean');
    // Reload the exact downloaded snapshot repeatedly. Each preview owns a separate game and object URLs.
    for (let attempt = 0; attempt < 3; ++attempt) {
      await packages.getByRole('button', { name: 'Reload exported package', exact: true }).click();
      const preview = page.getByRole('dialog', { name: 'Package runtime preview', exact: true });
      await expect(preview).toContainText('runtime playback ready', { timeout: 30_000 });
      await expect(preview.locator('canvas')).toBeVisible();
      await preview.getByLabel('Animation', { exact: true }).selectOption('walk');
      await preview.getByLabel('Skin', { exact: true }).selectOption('alternate');
      await preview.getByLabel('Facing', { exact: true }).selectOption('left');
      const before = await preview.locator('canvas').screenshot();
      await expect.poll(async () => (await preview.locator('canvas').screenshot()).equals(before)).toBe(false);
      await preview.getByRole('button', { name: 'Close preview', exact: true }).click();
      await expect(page.locator('#package-runtime-stage')).toHaveCount(0);
    }
    await packages
      .getByLabel('Import ZIP for runtime preview')
      .setInputFiles({ name: 'saved.zip', mimeType: 'application/zip', buffer: bytes });
    const imported = page.getByRole('dialog', { name: 'Package runtime preview', exact: true });
    await expect(imported).toContainText('runtime playback ready', { timeout: 30_000 });
    await imported.getByRole('button', { name: 'Close preview', exact: true }).click();
    await packages
      .getByLabel('Import ZIP for runtime preview')
      .setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('broken') });
    await expect(packages).toContainText('Invalid ZIP size');
    await expect(joint).toHaveValue('77');
    await expect(artwork.getByLabel('Artwork changes')).toHaveText('1 pending artwork change(s)');
    const workerStats = await page.evaluate(
      () => Reflect.get(window, 'packageZipWorkerStats') as { started: number; finished: number; uiTicks: number },
    );
    expect(workerStats.started).toBe(3);
    expect(workerStats.finished).toBe(3);
    expect(workerStats.uiTicks).toBeGreaterThan(0);
  });
}
