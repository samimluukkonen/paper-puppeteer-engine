import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationControl, inspectorControl, test, waitForPreviewPaint } from './fixtures.js';

// Artwork centroids can shift by a fraction of a logical pixel when rasterized at CSS scale.
function expectPixelDelta(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

async function seek(page: Page, time: number) {
  await page.locator('#timeline-time-input').fill(String(time));
  await page.locator('#timeline-time-input').press('Tab');
  await waitForPreviewPaint(page);
}
async function exported(page: Page) {
  const pending = page.waitForEvent('download');
  await (await animationControl(page, '#animation-download')).click();
  return animationFileSchema.parse(JSON.parse(await readFile(await (await pending).path(), 'utf8')));
}

/** Measure the character artwork and a world landmark in the real Phaser canvas, in logical canvas pixels. */
async function positions(page: Page) {
  await waitForPreviewPaint(page);
  const png = await page.locator('#animation-stage canvas').screenshot();
  const size = await page.locator('#animation-stage canvas').evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
  }));
  return page.evaluate(
    async ({ url, size }) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const points = [
        { x: 0, y: 0, count: 0 },
        { x: 0, y: 0, count: 0 },
      ];
      for (let i = 0; i < data.length; i += 4) {
        const match = (r: number, g: number, b: number) =>
          Math.abs(data[i]! - r) <= 2 && Math.abs(data[i + 1]! - g) <= 2 && Math.abs(data[i + 2]! - b) <= 2;
        const index = match(231, 198, 155) ? 0 : match(247, 181, 43) ? 1 : -1;
        if (index >= 0) {
          const point = points[index]!;
          point.x += (i / 4) % bitmap.width;
          point.y += Math.floor(i / 4 / bitmap.width);
          point.count++;
        }
      }
      bitmap.close();
      return points.map((point) => ({
        x: ((point.x / point.count) * size.width) / canvas.width,
        y: ((point.y / point.count) * size.height) / canvas.height,
        count: point.count,
      }));
    },
    { url: `data:image/png;base64,${png.toString('base64')}`, size },
  );
}

for (const scenario of ['sword step', 'jump', 'walk'] as const) {
  test(`${scenario}: authored travel over static world, fixed/follow camera, exclusive modes and deterministic seeking`, async ({
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
          rootMotion: {
            translationKeys:
              scenario === 'jump'
                ? [
                    { time: 0, x: 0, y: 0 },
                    { time: 500, x: 0, y: -100 },
                    { time: 1000, x: 0, y: 0 },
                  ]
                : [
                    { time: 0, x: 0, y: 0 },
                    { time: 1000, x: 80, y: 0 },
                  ],
          },
        },
      });
    });
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    const original = await exported(page);
    await page.locator('#animation-show-bones').uncheck();
    await page.getByRole('button', { name: 'Select root motion', exact: true }).click();
    await (await inspectorControl(page, '#root-show-trajectory')).uncheck();
    const mode = page.locator('#root-displacement-mode');
    await expect(mode).toHaveValue('authored');
    const environment = page.locator('.environment-preview-panel');
    await environment.locator(':scope > summary').click();
    const bytes = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#19364c';
      context.fillRect(0, 0, 800, 600);
      context.fillStyle = '#f7b52b';
      context.fillRect(210, 150, 12, 12);
      return canvas.toDataURL().split(',')[1]!;
    });
    await environment
      .getByLabel('Import environment image')
      .setInputFiles({ name: 'world.png', mimeType: 'image/png', buffer: Buffer.from(bytes, 'base64') });
    await expect(environment.getByRole('status')).toContainText('imported');
    await environment.getByLabel('Background X', { exact: true }).fill('380');
    await environment.getByLabel('Background Y', { exact: true }).fill('300');
    await environment.getByRole('button', { name: 'Apply background transform', exact: true }).click();
    await environment.getByRole('checkbox', { name: 'Environment Preview', exact: true }).check();
    await environment.getByRole('checkbox', { name: 'Show Ground Reference', exact: true }).check();
    const camera = environment.locator('.environment-camera-panel');
    await camera.locator('summary').click();
    const sampleTime = scenario === 'jump' ? 0.5 : 1;
    const dx = scenario === 'jump' ? 0 : 80;
    const dy = scenario === 'jump' ? -100 : 0;
    for (const cameraMode of ['fixed', 'follow']) {
      await camera.getByLabel('Preview camera mode').selectOption(cameraMode);
      await seek(page, 0);
      const start = await positions(page);
      expect(start.every((point) => point.count > 0)).toBe(true);
      await seek(page, sampleTime);
      const end = await positions(page);
      expectPixelDelta(end[0]!.x - start[0]!.x, cameraMode === 'fixed' ? dx : 0);
      expectPixelDelta(end[0]!.y - start[0]!.y, (cameraMode === 'fixed' ? dy : 0) - sampleTime * 10);
      expectPixelDelta(end[1]!.x - start[1]!.x, cameraMode === 'follow' ? -dx : 0);
      expectPixelDelta(end[1]!.y - start[1]!.y, cameraMode === 'follow' ? -dy : 0);
      for (const time of [0.9, 0.1, sampleTime]) await seek(page, time);
      expect(await positions(page)).toEqual(end);
      if (scenario === 'jump') {
        await seek(page, 1);
        const landed = await positions(page);
        expectPixelDelta(landed[0]!.x - start[0]!.x, 0);
        expectPixelDelta(landed[0]!.y - start[0]!.y, -10); // Skeletal bob remains after root returns to ground.
        expect(landed[1]).toEqual(start[1]);
        await seek(page, sampleTime);
      }
      await mode.selectOption('none');
      const stationary = await positions(page);
      expectPixelDelta(end[0]!.x - stationary[0]!.x, cameraMode === 'fixed' ? dx : 0);
      expectPixelDelta(end[0]!.y - stationary[0]!.y, cameraMode === 'fixed' ? dy : 0);
      // Returning to authored mode restores the exact same rendered root/world coordinates.
      await mode.selectOption('authored');
      expect(await positions(page)).toEqual(end);
    }
    await camera.getByLabel('Preview camera mode').selectOption('fixed');
    if (scenario === 'sword step') {
      await seek(page, 0);
      const canvas = page.locator('#animation-stage canvas');
      const moveCharacter = async (dx: number, dy: number) => {
        const bounds = (await canvas.boundingBox())!;
        const size = await canvas.evaluate((element) => ({
          width: (element as HTMLCanvasElement).width,
          height: (element as HTMLCanvasElement).height,
        }));
        const start = { x: bounds.x + bounds.width * 0.1, y: bounds.y + bounds.height * 0.35 };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(
          start.x + (dx * bounds.width) / size.width,
          start.y + (dy * bounds.height) / size.height,
          { steps: 5 },
        );
        await page.mouse.up();
      };
      const before = await positions(page);
      await moveCharacter(40, 30);
      const placed = await positions(page);
      expectPixelDelta(placed[0]!.x - before[0]!.x, 40);
      expectPixelDelta(placed[0]!.y - before[0]!.y, 30);
      expect(placed[1]).toEqual(before[1]);
      expect(await exported(page)).toEqual(original);
      await page.locator('#root-edit-mode').check();
      await moveCharacter(-40, -30);
      const restored = await positions(page);
      expectPixelDelta(restored[0]!.x - placed[0]!.x, -40);
      expectPixelDelta(restored[0]!.y - placed[0]!.y, -30);
      expect(restored[1]).toEqual(before[1]);
      await page.locator('#root-edit-mode').uncheck();
      expect(await exported(page)).toEqual(original);
    }
    if (scenario === 'walk') {
      await page.locator('#root-loop-mode').selectOption('continuous');
      await seek(page, 0);
      const start = await positions(page);
      await page.locator('#preview-loop').click();
      await page.locator('#play-pause').click();
      await expect.poll(async () => (await positions(page))[0]!.x - start[0]!.x).toBeGreaterThan(100);
      await page.locator('#play-pause').click();
      const held = await positions(page);
      expect(await positions(page)).toEqual(held);
      expect(held[1]).toEqual(start[1]);
      await seek(page, 0);
      expect(await positions(page)).toEqual(start);
    }
    expect(await exported(page)).toEqual(original);
    if (scenario === 'sword step') {
      const panel = page.locator('.motion-preview-panel');
      await panel.locator(':scope > summary').click();
      await seek(page, 0);
      await panel.getByRole('button', { name: 'Add position point', exact: true }).click();
      await seek(page, 1);
      await panel.getByRole('button', { name: 'Add position point', exact: true }).click();
      const last = panel.getByRole('form', { name: 'Preview point 2', exact: true });
      await last.getByLabel('Offset X').fill('160');
      await last.getByRole('button', { name: 'Apply point 2', exact: true }).click();
      await mode.selectOption('preview');
      const temporary = await positions(page);
      await mode.selectOption('authored');
      const authored = await positions(page);
      expectPixelDelta(temporary[0]!.x - authored[0]!.x, 80);
      expect(temporary[1]).toEqual(authored[1]);
      await panel.getByRole('button', { name: 'Preview Copy to Root Motion', exact: true }).click();
      await expect(panel.getByRole('alert')).toContainText('replaces all existing');
      expect(await exported(page)).toEqual(original);
      const proposed = await positions(page);
      expect(proposed[1]).toEqual(temporary[1]);
      expect(proposed[0]).toEqual(temporary[0]);
      await panel.getByRole('button', { name: 'Apply Copy — Replace Root Keys', exact: true }).click();
      const copied = await exported(page);
      expect(copied.rootMotion!.translationKeys.at(-1)!.x).toBe(160);
      expect(copied.tracks).toEqual(original.tracks);
      await page.locator('#animation-undo').click();
      expect(await exported(page)).toEqual(original);
      await page.locator('#animation-redo').click();
      expect(await exported(page)).toEqual(copied);
      await expect(panel.getByRole('form', { name: /^Preview point/ })).toHaveCount(2);
    }
    await page.screenshot({ path: test.info().outputPath('root-environment.png') });
  });
}
