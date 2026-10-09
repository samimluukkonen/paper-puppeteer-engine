import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationControl, animationFileAction, test } from './fixtures.js';

async function editRoot(page: Page, value: string): Promise<void> {
  await page.locator('#animation-bones').getByRole('button', { name: 'root', exact: true }).click();
  await page.locator('#animation-bone-fields input[data-property="x"]').fill(value);
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
}

for (const character of ['demo-puppet', 'random-paperdoll-sketch']) {
  test(`${character} downloads use manifest filenames rather than clip names`, async ({ page }) => {
    await page.goto(`animation-editor/?character=${character}`);
    await expect(page.locator('#animation-selection')).toHaveValue('idle');
    for (const [name, filename] of [
      ['sword', 'combat-idle.json'],
      ['guardUpperBody', 'guard-upper-body.json'],
    ]) {
      await page.locator('#animation-selection').selectOption(name!);
      const waiting = page.waitForEvent('download');
      await (await animationControl(page, '#animation-download')).click();
      const download = await waiting;
      expect(download.suggestedFilename()).toBe(filename);
      const path = await download.path();
      if (!path) throw new Error('Animation download has no local file.');
      expect(animationFileSchema.parse(JSON.parse(await readFile(path, 'utf8'))).name).toBe(name);
    }
  });
}

test('download saves authored JSON and allows switching; discard restores the downloaded baseline', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-discard')).toBeDisabled();
  await editRoot(page, '17');
  // A field draft is preview-only and must not appear in the downloaded file.
  await page.locator('#animation-bone-fields input[data-property="x"]').fill('99');
  const waiting = page.waitForEvent('download');
  await (await animationControl(page, '#animation-download')).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('idle.json');
  const path = await download.path();
  if (!path) throw new Error('Animation download has no local file.');
  const animation = animationFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  expect(animation.version).toBe(1);
  expect(animation.name).toBe('idle');
  expect(animation.tracks.root?.find((key) => key.time === 0)?.x).toBe(17);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-selection').selectOption('walk');
  await page.locator('#animation-selection').selectOption('idle');
  const x = page.locator('#animation-bone-fields input[data-property="x"]');
  await expect(x).toHaveValue('17');
  await editRoot(page, '23');
  await Promise.all([
    page.waitForEvent('dialog').then((dialog) => dialog.dismiss()),
    animationFileAction(page, '#animation-discard', (control) => control.click()),
  ]);
  await expect(x).toHaveValue('23');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await Promise.all([
    page.waitForEvent('dialog').then((dialog) => dialog.accept()),
    animationFileAction(page, '#animation-discard', (control) => control.click()),
  ]);
  await expect(x).toHaveValue('17');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('a failed download retains unsaved changes and reports an actionable error', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await editRoot(page, '17');
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error('Download unavailable');
    };
  });
  await (await animationControl(page, '#animation-download')).click();
  await expect(page.locator('#animation-export-feedback')).toContainText('Download unavailable');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-status')).toContainText('Unsaved animation changes');
});

test('clipboard and repeated downloads share canonical JSON across smooth and stepped playback', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        interpolation: 'linear',
        playback: { mode: 'smooth' },
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 500, y: 10 },
            { time: 1000, x: 4 },
          ],
          torso: [
            { time: 250, rotation: 0.1 },
            { time: 750, rotation: 0.2 },
          ],
        },
        events: [
          { time: 1000, name: 'end' },
          { time: 500, name: 'first', data: { z: [null, { b: true, a: 0.30000000000000004 }], a: 1 } },
          { time: 500, name: 'second', data: null },
        ],
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await editRoot(page, '0.30000000000000004');
  for (const mode of ['smooth', 'stepped'] as const) {
    await (await animationControl(page, '#animation-mode')).selectOption(mode);
    if (mode === 'stepped') {
      await (await animationControl(page, '#animation-fps')).fill('12.5');
      await (await animationControl(page, '#animation-fps')).press('Tab');
    }
    await animationFileAction(page, '#animation-copy-json', (control) => control.click());
    await expect(page.locator('#animation-export-feedback')).toHaveText('Animation JSON copied.');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^\{\n  "version": 1,/);
    expect(copied.endsWith('\n')).toBe(true);
    const animation = animationFileSchema.parse(JSON.parse(copied));
    expect(Object.keys(JSON.parse(copied) as object)).toEqual([
      'version',
      'name',
      'duration',
      'loop',
      'interpolation',
      'playback',
      'tracks',
      'events',
    ]);
    expect(Object.keys(animation.tracks)).toEqual(['root', 'torso']);
    expect(animation.tracks.root?.[0]?.x).toBe(0.3);
    expect(animation.interpolation).toBe('linear');
    expect(animation.playback).toEqual(mode === 'smooth' ? { mode: 'smooth' } : { mode: 'stepped', fps: 12.5 });
    expect(animation.events).toEqual([
      { time: 500, name: 'first', data: { a: 1, z: [null, { a: 0.30000000000000004, b: true }] } },
      { time: 500, name: 'second', data: null },
      { time: 1000, name: 'end' },
    ]);
    for (let repeat = 0; repeat < 2; repeat++) {
      const waiting = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
      const download = await waiting;
      expect(download.suggestedFilename()).toBe('idle.json');
      const path = await download.path();
      if (!path) throw new Error('Animation download has no local file.');
      expect(await readFile(path, 'utf8')).toBe(copied);
    }
    await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  }
});

test('clipboard failure offers download and console alternatives without saving edits', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await editRoot(page, '17');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await animationFileAction(page, '#animation-copy-json', (control) => control.click());
  await expect(page.locator('#animation-export-feedback')).toContainText('Clipboard API is unavailable');
  await expect(page.locator('#animation-export-feedback')).toContainText(
    'Download animation.json or Log Animation JSON',
  );
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  const waiting = page.waitForEvent('console', {
    predicate: (message) => message.type() === 'log' && message.text().startsWith('{\n'),
  });
  await animationFileAction(page, '#animation-log-json', (control) => control.click());
  const logged = (await waiting).text();
  expect(animationFileSchema.parse(JSON.parse(logged)).tracks.root?.[0]?.x).toBe(17);
  await expect(page.locator('#animation-export-feedback')).toHaveText('Animation JSON logged to the console.');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
