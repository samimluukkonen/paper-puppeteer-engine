import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page } from '@playwright/test';
import { test, waitForPreviewPaint } from './fixtures.js';

async function seek(page: Page, time: number) {
  await page.locator('#timeline-time-input').fill(String(time));
  await page.locator('#timeline-time-input').press('Enter');
  await waitForPreviewPaint(page);
}

async function exported(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  return readFile(await (await waiting).path(), 'utf8');
}

async function pixelDifference(page: Page, first: Buffer, second: Buffer) {
  return page.evaluate(
    async ([first, second]) => {
      const pixels = async (encoded: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const a = await pixels(first!);
      const b = await pixels(second!);
      if (a.length !== b.length) return -1;
      let different = 0;
      // GPU antialiasing can round a boundary pixel by one color level after a fresh projection.
      // Compare decoded pixels with that single-level tolerance, retaining strict geometry checks.
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 1) different++;
      return different;
    },
    [first.toString('base64'), second.toString('base64')],
  );
}

async function addPoint(page: Page, panel: Locator, time: number, x: number, y: number) {
  await seek(page, time);
  const count = await panel.getByRole('form').count();
  await panel.getByRole('button', { name: 'Add position point', exact: true }).click();
  const form = panel.getByRole('form').nth(count);
  await form.getByLabel('Offset X', { exact: true }).fill(String(x));
  await form.getByLabel('Offset Y', { exact: true }).fill(String(y));
  await form.getByRole('button', { name: `Apply point ${count + 1}`, exact: true }).click();
}

for (const scenario of ['sword cut', 'jump', 'walk'] as const) {
  test(`${scenario}: displacement follows the pose against a static environment and preserves exported animation`, async ({
    page,
  }) => {
    // Dedicated authored motions for acceptance examples; the bundled walk stays unchanged.
    if (scenario !== 'walk') {
      await page.route('**/animations/guard-upper-body.json', (route) =>
        route.fulfill({
          json: {
            version: 1,
            name: 'motion-example',
            duration: 1000,
            loop: true,
            tracks:
              scenario === 'jump'
                ? {
                    pelvis: [
                      { time: 0, y: 0 },
                      { time: 250, y: 8 },
                      { time: 500, y: -5 },
                      { time: 1000, y: 0 },
                    ],
                    leftThigh: [
                      { time: 0, rotation: 0 },
                      { time: 500, rotation: 0.5 },
                      { time: 1000, rotation: 0 },
                    ],
                  }
                : {
                    root: [
                      { time: 0, x: 0 },
                      { time: 300, x: 0 },
                      { time: 550, x: 8 },
                      { time: 1000, x: 8 },
                    ],
                    rightUpperArm: [
                      { time: 0, rotation: -1 },
                      { time: 300, rotation: -1.5 },
                      { time: 550, rotation: 0.8 },
                      { time: 1000, rotation: 0 },
                    ],
                    rightThigh: [
                      { time: 0, rotation: 0 },
                      { time: 550, rotation: -0.35 },
                      { time: 1000, rotation: 0 },
                    ],
                  },
          },
        }),
      );
    }
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    const clip = scenario === 'walk' ? 'walk' : 'motion-example';
    await page.locator('#animation-selection').selectOption(clip);
    const original = await exported(page);
    const environment = page.locator('.environment-preview-panel');
    await environment.locator(':scope > summary').click();
    const background = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 700;
      canvas.height = 600;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#192f46';
      context.fillRect(0, 0, 700, 600);
      context.fillStyle = '#446622';
      context.fillRect(0, 430, 700, 170);
      context.fillStyle = '#8299aa';
      context.fillRect(500, 0, 10, 430);
      return canvas.toDataURL().split(',')[1]!;
    });
    await environment.getByLabel('Import environment image').setInputFiles({
      name: 'motion-environment.png',
      mimeType: 'image/png',
      buffer: Buffer.from(background, 'base64'),
    });
    await expect(environment.getByRole('status')).toContainText('imported');
    await environment.getByRole('checkbox', { name: 'Environment Preview', exact: true }).check();
    await environment.getByLabel('Background X', { exact: true }).fill('380');
    await environment.getByLabel('Background Y', { exact: true }).fill('300');
    await environment.getByRole('button', { name: 'Apply background transform', exact: true }).click();
    await environment.locator(':scope > summary').click();

    const panel = page.locator('.motion-preview-panel');
    await expect(panel).not.toHaveAttribute('open');
    await panel.locator(':scope > summary').click();
    const enable = panel.getByRole('checkbox', { name: 'Enable additional preview displacement', exact: true });
    await expect(enable).not.toBeChecked();
    await panel.getByRole('checkbox', { name: 'Show preview trajectory', exact: true }).uncheck();
    const keys =
      scenario === 'jump'
        ? [
            [0, 0, 0],
            [0.5, 40, -100],
            [1, 80, 0],
          ]
        : [
            [0, 0, 0],
            [0.3, 0, 0],
            [0.55, 65, 0],
            [1, 65, 0],
          ];
    for (const [time, x, y] of keys) await addPoint(page, panel, time!, x!, y!);

    const canvas = page.locator('#animation-stage canvas');
    for (const facing of ['right', 'left']) {
      await page.locator('#animation-facing').selectOption(facing);
      await seek(page, 0.425);
      const authored = await canvas.screenshot();
      await enable.check();
      await waitForPreviewPaint(page);
      const displaced = await canvas.screenshot();
      expect(await pixelDifference(page, displaced, authored)).toBeGreaterThan(0);
      await seek(page, 0.8);
      await seek(page, 0.425);
      const repeated = await canvas.screenshot();
      await test.info().attach(`${facing}-displaced`, { body: displaced, contentType: 'image/png' });
      await test.info().attach(`${facing}-repeated`, { body: repeated, contentType: 'image/png' });
      expect(await pixelDifference(page, repeated, displaced)).toBe(0);
      await enable.uncheck();
      await waitForPreviewPaint(page);
      expect(await pixelDifference(page, await canvas.screenshot(), authored)).toBe(0);
    }
    await enable.check();
    await panel.locator(':scope > summary').click();
    await environment.locator(':scope > summary').click();
    const camera = environment.locator('.environment-camera-panel');
    await expect(camera).not.toHaveAttribute('open');
    await camera.locator('summary').click();
    await camera.getByLabel('Zoom', { exact: true }).fill('0.8');
    await camera.getByRole('button', { name: 'Apply preview camera', exact: true }).click();
    await camera.screenshot({ path: test.info().outputPath('preview-camera-controls.png') });
    await environment.getByRole('checkbox', { name: 'Show Ground Reference', exact: true }).check();
    let fixed: Buffer | undefined;
    for (const mode of ['fixed', 'follow']) {
      await camera.getByLabel('Preview camera mode').selectOption(mode);
      await environment.locator(':scope > summary').click();
      await seek(page, 0.425);
      const target = await canvas.screenshot();
      await test.info().attach(`${mode}-camera`, { body: target, contentType: 'image/png' });
      if (mode === 'fixed') fixed = target;
      else expect(await pixelDifference(page, target, fixed!)).toBeGreaterThan(0);
      await seek(page, 0.9);
      await seek(page, 0.1);
      await seek(page, 0.425);
      expect(await pixelDifference(page, await canvas.screenshot(), target)).toBe(0);
      await page.locator('#reset-time').click();
      await waitForPreviewPaint(page);
      const beginning = await canvas.screenshot();
      await page.locator('#playback-speed').selectOption('2');
      await page.locator('#play-pause').click();
      await expect
        .poll(async () => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow')))
        .toBeGreaterThan(0.1);
      await page.locator('#play-pause').click();
      await expect(page.locator('#play-pause')).toHaveAttribute('aria-label', 'Play');
      await waitForPreviewPaint(page);
      const paused = await page.locator('#timeline-ruler').getAttribute('aria-valuenow');
      await waitForPreviewPaint(page);
      expect(await page.locator('#timeline-ruler').getAttribute('aria-valuenow')).toBe(paused);
      await page.locator('#reset-time').click();
      await waitForPreviewPaint(page);
      expect(await pixelDifference(page, await canvas.screenshot(), beginning)).toBe(0);
      await environment.locator(':scope > summary').click();
      await expect(environment.getByLabel('Background X', { exact: true })).toHaveValue('380');
      await expect(environment.getByLabel('Background Y', { exact: true })).toHaveValue('300');
      await expect(camera.getByLabel('Camera X', { exact: true })).toHaveValue('380');
      await expect(camera.getByLabel('Camera Y', { exact: true })).toHaveValue('435');
    }
    await camera.getByRole('button', { name: 'Reset Camera', exact: true }).click();
    await expect(camera.getByLabel('Zoom', { exact: true })).toHaveValue('1');
    await expect(camera.getByLabel('Preview camera mode')).toHaveValue('fixed');
    await environment.locator(':scope > summary').click();
    await panel.locator(':scope > summary').click();
    await page.locator('#playback-speed').selectOption('1');
    await panel.getByRole('checkbox', { name: 'Show preview trajectory', exact: true }).check();
    await page.locator('#play-pause').click();
    await expect
      .poll(async () => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow')))
      .toBeGreaterThan(0.5);
    await page.locator('#play-pause').click();
    await seek(page, 0.5);
    await page.screenshot({ path: test.info().outputPath(`${scenario.replace(' ', '-')}-trajectory.png`) });
    expect(await exported(page)).toBe(original);
    await page.locator('#animation-selection').selectOption('idle');
    await expect(enable).not.toBeChecked();
    await page.locator('#animation-selection').selectOption(clip);
    await expect(enable).toBeChecked();
    await panel.getByRole('button', { name: 'Reset trajectory', exact: true }).click();
    await expect(enable).not.toBeChecked();
    await expect(panel.getByRole('form')).toHaveCount(0);
    expect(await exported(page)).toBe(original);
  });
}
