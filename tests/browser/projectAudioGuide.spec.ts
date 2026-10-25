import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { test } from './fixtures.js';

const guide = guideRegistry.getGuideById('project-audio-assets')!;
const startName = `Start Guide: ${guide.title}`;
declare global {
  interface Window {
    projectAudioGuideStarts: number;
  }
}

async function openCatalog(page: Page) {
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await catalog.getByRole('button', { name: 'Project Workspace', exact: true }).click();
  return catalog;
}
async function exportProject(page: Page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const download = await downloading;
  return decodePackageZip(new Uint8Array(await readFile(await download.path())));
}

test('audio guide explains missing projects and stays in the shared searchable catalog', async ({ page }) => {
  await page.goto('project/');
  const catalog = await openCatalog(page);
  await expect(catalog.getByRole('button', { name: startName, exact: true })).toBeDisabled();
  await expect(catalog).toContainText('Create or import a project');
  await catalog.getByRole('searchbox', { name: 'Search guides', exact: true }).fill('audio music');
  await expect(catalog.locator('.feature-guide-entry h4')).toHaveText([guide.title]);
  await expect(catalog.getByLabel('Guide character')).toHaveCount(0);
  await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
});

for (const populated of [false, true]) {
  test(`audio tour reveals real controls and preserves ${populated ? 'imported assets and Undo/Redo' : 'an empty project'}`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      window.projectAudioGuideStarts = 0;
      const NativeContext = window.AudioContext;
      window.AudioContext = class extends NativeContext {
        override createBufferSource(): AudioBufferSourceNode {
          const source = super.createBufferSource();
          const start = source.start.bind(source);
          source.start = (...args: Parameters<AudioBufferSourceNode['start']>) => {
            window.projectAudioGuideStarts++;
            start(...args);
          };
          return source;
        }
      };
    });
    await page.goto('project/');
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'New Project', exact: true });
    await create.getByLabel('Project name').fill('Guided audio');
    await create.getByRole('button', { name: 'Create Project', exact: true }).click();
    const audio = page.locator('.project-audio');
    if (populated) {
      await audio.locator(':scope > summary').click();
      await audio.getByLabel('Import Audio', { exact: true }).setInputFiles({
        name: 'tone.wav',
        mimeType: 'audio/wav',
        buffer: await readFile(new URL('../fixtures/audio/tone.wav', import.meta.url)),
      });
      await expect(page.getByRole('status')).toContainText('Audio imported.');
      await expect(audio.getByRole('button', { name: 'Import Audio', exact: true })).toBeEnabled();
      const music = audio.locator('.project-asset-group').first();
      await music.locator(':scope > summary').click();
      await music.getByRole('button', { name: 'Rename', exact: true }).click();
      await music.getByRole('textbox', { name: 'Name for tone', exact: true }).fill('Renamed');
      await music.getByRole('button', { name: 'Apply name', exact: true }).click();
      await music.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('button', { name: 'Undo Project', exact: true }).click();
      await music.locator(':scope > summary').click();
      await audio.locator(':scope > summary').click();
    }
    const before = await exportProject(page);
    const undo = page.getByRole('button', { name: 'Undo Project', exact: true });
    const redo = page.getByRole('button', { name: 'Redo Project', exact: true });
    const history = [await undo.isEnabled(), await redo.isEnabled()];
    await page.getByRole('tab', { name: 'Local draft', exact: true }).click();
    await expect(audio).not.toHaveAttribute('open');
    const catalog = await openCatalog(page);
    await expect(catalog.getByRole('button', { name: startName, exact: true })).toBeEnabled();
    await catalog.getByRole('button', { name: startName, exact: true }).click();
    const tour = page.getByRole('dialog', { name: guide.title, exact: true });
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
      const target = page.locator(`[data-guide-id="${step.targetId}"]`);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
      await expect(page.locator('.guide-spotlight-hole')).toBeVisible();
      await expect(tour).not.toContainText('Target unavailable');
      await expect(tour.getByRole('button', { name: 'Try It', exact: true })).toHaveCount(0);
      if (index === 1) {
        await tour.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(tour).toContainText('Step 1 of 7');
        await tour.getByRole('button', { name: 'Next', exact: true }).click();
        await page.screenshot({ path: info.outputPath('audio-import-guide.png') });
      }
      if (index + 1 < guide.steps.length) await tour.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(page.getByRole('tab', { name: 'Project', exact: true })).toHaveAttribute('aria-selected', 'true');
    await tour.getByRole('button', { name: 'Restart guide', exact: true }).click();
    await expect(tour).toContainText('Step 1 of 7');
    await tour.getByRole('button', { name: 'Choose another guide', exact: true }).click();
    await expect(catalog).toBeVisible();
    await expect(catalog.getByRole('button', { name: 'Project Workspace', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await catalog.getByRole('button', { name: startName, exact: true }).click();
    await tour.press('Escape');
    await expect(tour).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
    const reopened = await openCatalog(page);
    await reopened.getByRole('button', { name: startName, exact: true }).click();
    for (let index = 1; index < guide.steps.length; index++)
      await tour.getByRole('button', { name: 'Next', exact: true }).click();
    await tour.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(tour).not.toBeVisible();
    await expect(audio.locator('.project-asset-group[open]')).toHaveCount(0);
    expect(await page.evaluate(() => window.projectAudioGuideStarts)).toBe(0);
    expect([await undo.isEnabled(), await redo.isEnabled()]).toEqual(history);
    await expect(page.getByText('Project metadata: Exported', { exact: true })).toBeVisible();
    const after = await exportProject(page);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [path, bytes] of before) expect(after.get(path)).toEqual(bytes);
  });
}
