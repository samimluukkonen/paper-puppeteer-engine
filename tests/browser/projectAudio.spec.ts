import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { parseProjectDefinition } from '../../src/devtools/project/ProjectDefinition.js';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

declare global {
  interface Window {
    audioAuditionTest: { starts: number; decodes: number; closed: number };
  }
}
async function openAudio(page: Page) {
  const panel = page.locator('.project-audio');
  if (!(await panel.evaluate((node) => (node as HTMLDetailsElement).open)))
    await panel.locator(':scope > summary').click();
  await expect(panel.getByRole('button', { name: 'Import Audio', exact: true })).toBeVisible();
  return panel;
}
async function openCategory(page: Page, title: string) {
  const group = page
    .locator('.project-audio .project-asset-group')
    .filter({ has: page.locator('summary', { hasText: new RegExp(`^${title}`) }) });
  if (!(await group.evaluate((node) => (node as HTMLDetailsElement).open)))
    await group.locator(':scope > summary').click();
  return group;
}

test('real audio codecs, audition cleanup, membership, browser recovery and portable ZIP round trip', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.audioAuditionTest = { starts: 0, decodes: 0, closed: 0 };
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      override decodeAudioData(
        data: ArrayBuffer,
        success?: DecodeSuccessCallback | null,
        failure?: DecodeErrorCallback | null,
      ): Promise<AudioBuffer> {
        window.audioAuditionTest.decodes++;
        return super.decodeAudioData(data, success, failure);
      }
      override createBufferSource(): AudioBufferSourceNode {
        const node = super.createBufferSource();
        const start = node.start.bind(node);
        node.start = (...args: Parameters<AudioBufferSourceNode['start']>) => {
          window.audioAuditionTest.starts++;
          start(...args);
        };
        return node;
      }
      override close(): Promise<void> {
        window.audioAuditionTest.closed++;
        return super.close();
      }
    };
  });
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
  await dialog.getByLabel('Project name').fill('Audio Film');
  await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page.locator('.project-audio')).not.toHaveAttribute('open');
  const panel = await openAudio(page);
  const binaries = new Map<string, Buffer>();
  for (const [format, category] of [
    ['wav', 'music'],
    ['mp3', 'sfx'],
    ['ogg', 'ambience'],
  ] as const) {
    const buffer = await readFile(new URL(`../fixtures/audio/tone.${format}`, import.meta.url));
    binaries.set(`audio/tone.${format}`, buffer);
    await panel.getByLabel('Audio import category').selectOption(category);
    await panel
      .getByLabel('Import Audio', { exact: true })
      .setInputFiles({ name: `tone.${format}`, mimeType: 'application/octet-stream', buffer });
    await expect(page.getByRole('status')).toContainText('Audio imported.');
    await expect(panel.getByRole('button', { name: 'Import Audio', exact: true })).toBeEnabled();
  }
  expect(await page.evaluate(() => window.audioAuditionTest)).toMatchObject({ starts: 0, decodes: 3 });
  await expect(panel.locator('.project-asset-group[open]')).toHaveCount(0);
  const music = await openCategory(page, 'Music');
  await expect(music.getByRole('button', { name: 'Preview tone', exact: true })).toHaveCount(0);
  await music.getByText('tone', { exact: true }).click();
  expect(await page.evaluate(() => window.audioAuditionTest.starts)).toBe(0);
  const play = music.getByRole('button', { name: 'Play', exact: true });
  const icon = (await play.locator('svg').boundingBox())!;
  const label = (await play.locator('span').boundingBox())!;
  expect(icon.width).toBe(16);
  expect(icon.height).toBe(16);
  expect(label.x - icon.x - icon.width).toBeGreaterThanOrEqual(6);
  await expect(play.locator('svg')).toHaveAttribute('fill', 'currentColor');
  await expect(music.getByRole('button', { name: 'Remove', exact: true }).locator('svg.lucide-trash-2')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('audio-library.png'), fullPage: true });
  await play.click();
  await expect(panel.getByText('Playing tone', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.audioAuditionTest)).toMatchObject({ starts: 1, decodes: 3 });
  const stop = music.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop.locator('svg.lucide-square')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('audio-playing.png'), fullPage: true });
  await stop.click();
  await expect(play).toBeVisible();
  await expect(panel.getByText('Preview stopped.', { exact: true })).toBeVisible();
  // A natural ending returns the same row to Play as well.
  await play.click();
  await expect(panel.getByText('Playing tone', { exact: true })).toBeVisible();
  await expect(play).toBeVisible();
  await expect(panel.getByText('Preview stopped.', { exact: true })).toBeVisible();
  await play.click();
  await expect(panel.getByText('Playing tone', { exact: true })).toBeVisible();
  await panel.getByLabel('Audio preview volume').fill('0.25');
  await expect(panel.locator('.project-audio-volume-value')).toHaveText('25%');
  await panel.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await expect(panel.getByText('Preview stopped.', { exact: true })).toBeVisible();
  await play.click();
  await expect(panel.getByText('Playing tone', { exact: true })).toBeVisible();
  await music.locator(':scope > summary').click();
  await expect(panel.getByText('Preview stopped.', { exact: true })).toBeVisible();
  await openCategory(page, 'Music');
  await music.getByRole('button', { name: 'Rename', exact: true }).click();
  await music.getByRole('textbox', { name: 'Name for tone', exact: true }).fill('Forest theme');
  await music.getByRole('button', { name: 'Apply name', exact: true }).click();
  await music.getByRole('button', { name: 'Done', exact: true }).click();
  await music.getByLabel('Category for Forest theme').selectOption('voice');
  const voice = await openCategory(page, 'Voice');
  await voice.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(voice.getByText('Forest theme', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo Project', exact: true }).click();
  await expect(voice.getByText('Forest theme', { exact: true })).toBeVisible();
  await panel
    .getByLabel('Import Audio', { exact: true })
    .setInputFiles({ name: 'fake.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('not audio') });
  await expect(page.getByRole('status')).toContainText('Unrecognized audio data');
  // Recognizable WAV container with no playable samples must fail the real decoder too.
  await panel
    .getByLabel('Import Audio', { exact: true })
    .setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF0000WAVE') });
  await expect(page.getByRole('status')).toContainText('Audio could not decode');
  await voice.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(panel.getByText('Playing Forest theme', { exact: true })).toBeVisible();
  await panel.locator(':scope > summary').click();
  await expect.poll(() => page.evaluate(() => window.audioAuditionTest.closed)).toBe(1);
  await page.getByRole('tab', { name: 'Local draft', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  page.on('dialog', (event) => {
    void event.accept();
  });
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await recovery.getByRole('button', { name: 'Recover Draft', exact: true }).click();
  await expect(recovery).not.toBeVisible();
  const restoredPanel = await openAudio(page);
  const restoredVoice = await openCategory(page, 'Voice');
  await expect(restoredVoice.getByText('Forest theme', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.audioAuditionTest.starts)).toBe(0);
  await restoredVoice.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(restoredPanel.getByText('Playing Forest theme', { exact: true })).toBeVisible();
  await restoredPanel.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await page.getByRole('tab', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Validate Project', exact: true }).click();
  await expect(page.getByLabel('Project validation')).toContainText('0 Errors');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const bytes = await readFile(await (await downloading).path());
  const files = decodePackageZip(new Uint8Array(bytes));
  const archive = JSON.parse(new TextDecoder().decode(files.get('project.json'))) as { project: unknown };
  const metadata = parseProjectDefinition(archive.project);
  expect(metadata.audio).toHaveLength(3);
  expect(metadata.audio!.find((entry) => entry.name === 'Forest theme')).toMatchObject({
    category: 'voice',
    path: 'audio/tone.wav',
    durationSeconds: expect.any(Number),
  });
  for (const [path, binary] of binaries) expect(Buffer.from(files.get(path)!)).toEqual(binary);
  expect(JSON.stringify(metadata)).not.toContain('blob:');
  await page
    .getByLabel('Import Project', { exact: true })
    .setInputFiles({ name: 'audio.project.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.getByRole('status')).toContainText('Project open in this tab.');
  await expect(page.getByText('Project metadata: Exported', { exact: true })).toBeVisible();
  await openAudio(page);
  await openCategory(page, 'Voice');
  await expect(page.locator('.project-audio-name').filter({ hasText: 'Forest theme' })).toBeVisible();
});
