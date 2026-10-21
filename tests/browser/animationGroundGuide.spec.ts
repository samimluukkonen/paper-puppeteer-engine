import { expect, type Dialog, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationFileAction, animationIKInspector, test } from './fixtures.js';

async function groundHandle(page: Page) {
  const canvas = page.locator('#animation-stage canvas');
  const screenshot = await canvas.screenshot();
  const row = await page.evaluate(
    async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let bestY = -1,
        bestCount = 0;
      for (let y = 0; y < bitmap.height; y++) {
        let count = 0;
        for (let x = 0; x < bitmap.width; x++) {
          if (x > bitmap.width * 0.2 && x < bitmap.width * 0.8) continue;
          const index = (y * bitmap.width + x) * 4;
          if (
            data[index]! > 150 &&
            data[index]! < 235 &&
            data[index + 1]! > 115 &&
            data[index + 1]! < 210 &&
            data[index + 2]! < 170 &&
            data[index]! - data[index + 1]! > 25
          )
            count++;
        }
        if (count > bestCount) {
          bestCount = count;
          bestY = y;
        }
      }
      return bestCount > bitmap.width / 8 ? bestY : -1;
    },
    `data:image/png;base64,${screenshot.toString('base64')}`,
  );
  expect(row).toBeGreaterThanOrEqual(0);
  const bounds = (await canvas.boundingBox())!;
  const logicalWidth = await canvas.evaluate((element) => (element as HTMLCanvasElement).width);
  const pixel = bounds.width / logicalWidth;
  return { x: bounds.x + 25 * pixel, y: bounds.y + row + (row >= 24 * pixel ? -12 : 12) * pixel };
}

async function exported(page: Page) {
  const downloaded = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const stream = await (await downloaded).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString();
}

test('animation ground controls, canvas dragging, alignment and cleanup preserve authored data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('walk');
  const panel = page.locator('.ground-guide-controls');
  await expect(panel).not.toHaveAttribute('open');
  await panel.locator('summary').click();
  const y = panel.getByRole('spinbutton', { name: 'Ground Y', exact: true });
  const show = panel.getByRole('checkbox', { name: 'Show ground guide' });
  const original = await exported(page);
  const canvas = page.locator('#animation-stage canvas');
  const hidden = await canvas.screenshot();
  await show.check();
  await expect.poll(async () => (await canvas.screenshot()).equals(hidden)).toBe(false);
  await y.fill('480');
  await y.press('Enter');
  await panel.getByRole('button', { name: 'Undo ground change', exact: true }).click();
  await expect(y).toHaveValue('435');
  await panel.getByRole('button', { name: 'Redo ground change', exact: true }).click();
  await expect(y).toHaveValue('480');
  let start = await groundHandle(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 25, { steps: 4 });
  await expect.poll(async () => Number(await y.inputValue())).toBeGreaterThan(480);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(y).toHaveValue('480');
  start = await groundHandle(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 20, { steps: 4 });
  await page.mouse.up();
  const draggedY = await y.inputValue();
  expect(Number(draggedY)).toBeGreaterThan(480);
  const stationary = await groundHandle(page);
  await page.locator('#preview-loop').click();
  await page.locator('#play-pause').click();
  await expect(page.locator('#play-pause')).toHaveAttribute('aria-label', 'Pause');
  await expect
    .poll(async () => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow')))
    .toBeGreaterThan(0.1);
  expect(Math.abs((await groundHandle(page)).y - stationary.y)).toBeLessThan(2);
  await expect(y).toHaveValue(draggedY);
  await page.locator('#play-pause').click();
  await page.locator('#timeline-time-input').fill('0.3');
  await page.locator('#timeline-time-input').press('Enter');
  await page.locator('#animation-facing').selectOption('left');
  await page.locator('#animation-onion-skinning').check();
  await expect(y).toHaveValue(draggedY);
  expect(Math.abs((await groundHandle(page)).y - stationary.y)).toBeLessThan(2);
  await canvas.hover();
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => Math.abs((await groundHandle(page)).y - stationary.y)).toBeGreaterThan(2);
  await expect(y).toHaveValue(draggedY);
  expect(await exported(page)).toBe(original);
  const selected = await page.locator('#animation-selection').inputValue();
  const other = await page
    .locator('#animation-selection option')
    .evaluateAll(
      (options, current) =>
        options.map((option) => (option as HTMLOptionElement).value).find((value) => value && value !== current),
      selected,
    );
  if (other) {
    await page.locator('#animation-selection').selectOption(other);
    await expect(y).toHaveValue(draggedY);
    await page.locator('#animation-selection').selectOption(selected);
  }
  await page.getByRole('button', { name: 'Select IK target rightLegIK', exact: true }).click();
  await animationIKInspector(page);
  await expect(
    panel.getByText('No sole-contact marker is used by this legacy command', { exact: false }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Align IK target Y to guide', exact: true }).click();
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await page.locator('#animation-undo').click();
  expect(await exported(page)).toBe(original);
  await page.locator('#animation-redo').click();
  const aligned = await exported(page);
  const before = animationFileSchema.parse(JSON.parse(original));
  const after = animationFileSchema.parse(JSON.parse(aligned));
  expect(after.tracks).toEqual(before.tracks);
  expect(after.events).toEqual(before.events);
  expect(after.ikTracks).not.toEqual(before.ikTracks);
  await panel.getByRole('checkbox', { name: 'Enable ground snapping', exact: true }).check();
  await show.uncheck();
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(show).not.toBeChecked();
  await page.reload();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await panel.locator('summary').click();
  await expect(y).toHaveValue(draggedY);
  await expect(show).not.toBeChecked();
  await expect(panel.getByRole('checkbox', { name: 'Enable ground snapping', exact: true })).toBeChecked();
  const acceptReplacement = (dialog: Dialog): void => {
    void dialog.accept();
  };
  page.on('dialog', acceptReplacement);
  try {
    await animationFileAction(page, '#animation-import-file', (control) =>
      control.setInputFiles({ name: 'walk.json', mimeType: 'application/json', buffer: Buffer.from(aligned) }),
    );
  } finally {
    page.off('dialog', acceptReplacement);
  }
  expect(await exported(page)).toBe(aligned);
  await expect(y).toHaveValue(draggedY);
  expect(errors).toEqual([]);
});
