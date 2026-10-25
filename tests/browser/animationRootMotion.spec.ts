import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationControl, animationFileAction, inspectorControl, test, waitForPreviewPaint } from './fixtures.js';

async function seek(page: Page, time: string) {
  await page.locator('#timeline-time-input').fill(time);
  await page.locator('#timeline-time-input').press('Tab');
}
async function download(page: Page) {
  const pending = page.waitForEvent('download');
  await (await animationControl(page, '#animation-download')).click();
  const file = await pending;
  return animationFileSchema.parse(JSON.parse(await readFile(await file.path(), 'utf8')));
}
/** Find the rendered square's purple outline; trajectory is hidden during this measurement. */
async function handlePoint(page: Page) {
  await waitForPreviewPaint(page);
  const canvas = page.locator('#animation-stage canvas');
  const png = await canvas.screenshot();
  const point = await page.evaluate(
    async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let x = 0,
        y = 0,
        count = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          Math.abs(pixels[i]! - 191) <= 2 &&
          Math.abs(pixels[i + 1]! - 139) <= 2 &&
          Math.abs(pixels[i + 2]! - 255) <= 2
        ) {
          x += (i / 4) % bitmap.width;
          y += Math.floor(i / 4 / bitmap.width);
          count++;
        }
      const result = count ? { x: x / count, y: y / count, width: bitmap.width, height: bitmap.height } : null;
      bitmap.close();
      return result;
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
  expect(point, 'root handle is drawn in the Phaser preview').not.toBeNull();
  const bounds = (await canvas.boundingBox())!;
  return {
    x: bounds.x + (point!.x * bounds.width) / point!.width,
    y: bounds.y + (point!.y * bounds.height) / point!.height,
  };
}

test('artist authors a root step with the timeline, numeric controls, real handle, graph, history and portable reload', async ({
  page,
}) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    const source = animationFileSchema.parse(await response.json());
    await route.fulfill({
      json: {
        ...source,
        duration: 1000,
        loop: false,
        playback: { mode: 'smooth' },
        tracks: {
          root: [
            { time: 0, y: 0 },
            { time: 1000, y: -10 },
          ],
        },
        ikTracks: {},
        events: [],
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const panel = page.locator('#root-motion-panel');
  await expect(panel).not.toHaveAttribute('open');
  await (await inspectorControl(page, '#root-add-key')).click();
  await expect(page.getByRole('button', { name: 'Select Root Motion x key at 0 s', exact: true })).toBeVisible();
  await seek(page, '0.25');
  await page.locator('#root-add-key').click();
  await seek(page, '0.6');
  await page.locator('#root-x').fill('80');
  await page.locator('#root-y').fill('0');
  await panel.getByRole('button', { name: 'Set position key', exact: true }).click();
  await seek(page, '1');
  await page.locator('#root-add-key').click();
  const authored = await download(page);
  expect(authored.rootMotion!.translationKeys.map((key) => key.x)).toEqual([0, 0, 80, 80]);
  expect(authored.tracks.root).toEqual([
    { time: 0, y: 0 },
    { time: 1000, y: -10 },
  ]);

  await seek(page, '0.6');
  await page.locator('#root-edit-mode').check();
  await page.locator('#root-show-trajectory').uncheck();
  const point = await handlePoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 45, point.y - 20, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('#root-x')).toHaveValue('80');
  const start = await handlePoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 45, start.y - 20, { steps: 8 });
  await page.mouse.up();
  const movedX = await page.locator('#root-x').inputValue();
  expect(Number(movedX)).toBeGreaterThan(80);
  await page.locator('#animation-undo').click();
  await expect(page.locator('#root-x')).toHaveValue('80');
  await page.locator('#animation-redo').click();
  await expect(page.locator('#root-x')).toHaveValue(movedX);
  await page.locator('#animation-undo').click();
  await page.locator('#root-edit-mode').uncheck();

  const key = page.getByRole('button', { name: 'Select Root Motion x key at 0.6 s', exact: true });
  await key.click();
  await page.locator('#root-key-time').fill('0.65');
  await page.locator('#root-apply-key').click();
  await expect(page.getByRole('button', { name: 'Select Root Motion x key at 0.65 s', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('#root-key-time').fill('0.6');
  await page.locator('#root-apply-key').click();
  await page.getByRole('button', { name: 'Select Root Motion x key at 0.25 s', exact: true }).click();
  await page.locator('#graph-toggle').click();
  await expect(page.locator('#graph-property')).toHaveValue('x');
  await expect(page.locator('#graph-target')).toHaveText('Root Motion');
  await page.locator('#graph-interpolation').selectOption('bezier');
  await expect(page.locator('.graph-handle')).toHaveCount(2);
  const withCurve = await download(page);
  expect(withCurve.rootMotion!.translationKeys[1]!.curves!.x!.mode).toBe('bezier');
  expect(withCurve.tracks).toEqual(authored.tracks);
  expect(withCurve.ikTracks).toEqual(authored.ikTracks);
  await page.locator('#root-show-trajectory').check();
  await page.screenshot({ path: test.info().outputPath('root-motion-authoring.png') });
  await animationFileAction(page, '#animation-reload-export', (control) => control.click());
  expect((await download(page)).rootMotion).toEqual(withCurve.rootMotion);
});

test('Visual Root Motion guide reveals real controls while preserving legacy data and view preferences', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const before = await download(page);
  const guide = guideRegistry.getGuideById('animation-root-motion')!;
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
  const tour = page.getByRole('dialog', { name: guide.title, exact: true });
  for (const [index, step] of guide.steps.entries()) {
    await expect(tour).toContainText(`Step ${index + 1} of ${guide.steps.length}`);
    await expect(page.locator(`[data-guide-id="${step.targetId}"]`)).toBeVisible();
    await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
    await tour.getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true }).click();
  }
  await expect(tour).toHaveCount(0);
  await expect(page.locator('#root-edit-mode')).not.toBeChecked();
  expect(await download(page)).toEqual(before);
});

test('root timeline drag and Escape preserve one-step history and keyboard selection for duplication/deletion', async ({
  page,
}) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        tracks: {},
        ikTracks: {},
        events: [],
        playback: { mode: 'smooth' },
        rootMotion: {
          translationKeys: [
            { time: 0, x: 0, y: 0 },
            { time: 500, x: 40, y: 0 },
            { time: 1000, x: 80, y: 0 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const original = page.getByRole('button', { name: 'Select Root Motion x key at 0.5 s', exact: true });
  const box = (await original.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(original).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y, { steps: 5 });
  await page.mouse.up();
  await expect(original).toHaveCount(0);
  const selected = page.locator('.timeline-root-track[data-root-property="x"] [data-primary="true"]');
  await expect(selected).toBeFocused();
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('.timeline-root-track[data-root-property="x"] .timeline-keyframe')).toHaveCount(4);
  await page.keyboard.press('Delete');
  await expect(page.locator('.timeline-root-track[data-root-property="x"] .timeline-keyframe')).toHaveCount(3);
  await expect(page.locator('.timeline-root-track[data-root-property="y"] .timeline-keyframe')).toHaveCount(3);
  await page.locator('#animation-undo').click();
  await expect(page.locator('.timeline-root-track[data-root-property="x"] .timeline-keyframe')).toHaveCount(4);
  await page.locator('#animation-undo').click();
  await expect(page.locator('.timeline-root-track[data-root-property="x"] .timeline-keyframe')).toHaveCount(3);
  await page.locator('#animation-undo').click();
  await expect(original).toHaveCount(1);
});
