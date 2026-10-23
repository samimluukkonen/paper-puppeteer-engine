import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { animationControl, animationFileAction, test } from './fixtures.js';

async function exported(page: Page) {
  const pending = page.waitForEvent('download');
  await (await animationControl(page, '#animation-download')).click();
  const path = await (await pending).path();
  if (!path) throw new Error('Missing exported animation');
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}
async function openDiagnostics(page: Page) {
  await page.locator('#animation-authoring-tools > summary').click();
  await page.getByRole('button', { name: 'Motion Diagnostics…', exact: true }).click();
  return page.getByRole('region', { name: 'Motion Diagnostics', exact: true });
}

test('manual diagnostics, inspect, canvas comparison, cancel, explicit cleanup, Undo/Redo and export/reload', async ({
  page,
}) => {
  await page.route('**/animations/walk.json', async (route) => {
    const response = await route.fetch();
    const source = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      json: {
        ...source,
        duration: 1000,
        loop: false,
        playback: { mode: 'smooth' },
        tracks: {
          head: [
            { time: 0, x: 0 },
            { time: 500, x: 5 },
            { time: 1000, x: 10 },
          ],
        },
        events: [{ time: 250, name: 'step', data: { foot: 'left' } }],
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('walk');
  const original = await exported(page);
  await expect(page.locator('#animation-motion-panel')).not.toHaveAttribute('open', '');
  let panel = await openDiagnostics(page);
  await panel.getByRole('button', { name: 'Run diagnostics', exact: true }).click();
  await expect(panel).toContainText('Potentially redundant property keys (1)');
  await expect(panel.locator('details')).not.toHaveAttribute('open', '');
  await panel.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.locator('#timeline-time-input')).toHaveValue('0.5');
  await expect(page.getByRole('button', { name: 'Select head x key at 0.5 s', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panel.getByRole('button', { name: 'Preview Cleanup', exact: true }).click();
  await panel.getByLabel('Comparison time (s)').fill('0.75');
  await panel.getByRole('button', { name: 'Before', exact: true }).click();
  const canvas = page.locator('#animation-stage canvas');
  await page.screenshot({ path: test.info().outputPath('motion-cleanup-preview.png') });
  // The popover overlaps the viewport; hide its paint while comparing the canvas underneath.
  const captureOptions = { style: '#animation-motion-panel { visibility: hidden !important; }' };
  const before = await canvas.screenshot({ ...captureOptions, path: test.info().outputPath('before.png') });
  await panel.getByRole('button', { name: 'After', exact: true }).click();
  const after = await canvas.screenshot({ ...captureOptions, path: test.info().outputPath('after.png') });
  const comparison = await page.evaluate(
    async ([a, b]) => {
      const pixels = async (data: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = surface.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return context.getImageData(0, 0, surface.width, surface.height);
      };
      const left = await pixels(a!),
        right = await pixels(b!);
      let differences = 0,
        minX = left.width,
        minY = left.height,
        maxX = 0,
        maxY = 0;
      for (let i = 0; i < left.data.length; i += 4) {
        if ([0, 1, 2, 3].some((c) => left.data[i + c] !== right.data[i + c])) {
          differences++;
          const x = (i / 4) % left.width,
            y = Math.floor(i / 4 / left.width);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      return { differences, minX, maxX, minY, maxY };
    },
    [before.toString('base64'), after.toString('base64')],
  );
  expect(comparison.differences, JSON.stringify(comparison)).toBe(0);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(panel).toContainText('maximum local deviation 0.000');
  await panel.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Apply Cleanup', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close Motion Diagnostics', exact: true }).click();
  expect(await exported(page)).toEqual(original);
  panel = await openDiagnostics(page);
  await panel.getByRole('button', { name: 'Preview Cleanup', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  expect(await exported(page)).toEqual(original);
  panel = await openDiagnostics(page);
  await panel.getByRole('button', { name: 'Preview Cleanup', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply Cleanup', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Cleanup applied and revalidated');
  await panel.getByRole('button', { name: 'Close Motion Diagnostics', exact: true }).click();
  const cleaned = await exported(page);
  expect(cleaned).toEqual({
    ...original,
    tracks: {
      head: [
        { time: 0, x: 0 },
        { time: 1000, x: 10 },
      ],
    },
  });
  await page.locator('#animation-undo').click();
  expect(await exported(page)).toEqual(original);
  await page.locator('#animation-redo').click();
  expect(await exported(page)).toEqual(cleaned);
  await animationFileAction(page, '#animation-reload-export', (control) => control.click());
  expect(await exported(page)).toEqual(cleaned);
});

test('legitimate fast attacks remain authored and findings navigate to real keys', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    const source = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      json: {
        ...source,
        duration: 1000,
        playback: { mode: 'smooth' },
        tracks: {
          head: [
            { time: 0, rotation: 0 },
            { time: 10, rotation: 2 },
            { time: 1000, rotation: 2 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const original = await exported(page);
  const panel = await openDiagnostics(page);
  await panel.getByRole('button', { name: 'Run diagnostics', exact: true }).click();
  await expect(panel).toContainText('Possible large change');
  await expect(panel).toContainText('may be intentional');
  await expect(panel).toContainText('Potentially redundant property keys (0)');
  await panel.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.locator('#timeline-time-input')).toHaveValue('0.01');
  await expect(panel.getByRole('button', { name: 'Preview Cleanup', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Close Motion Diagnostics', exact: true }).click();
  expect(await exported(page)).toEqual(original);
});
