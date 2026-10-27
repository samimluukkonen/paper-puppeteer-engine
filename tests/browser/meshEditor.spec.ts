import { expect } from '@playwright/test';
import { inspectorControl, rigFileAction, selectRigEntry, test, waitForPreviewPaint } from './fixtures.js';

// Locate the selected gold mesh diamond from the actual rendered canvas, without private editor hooks.
async function selectedDiamond(page: import('@playwright/test').Page) {
  await waitForPreviewPaint(page);
  const canvas = page.locator('#editor-stage canvas');
  const png = await canvas.screenshot();
  const point = await page.evaluate(
    async (data) => {
      const bitmap = await createImageBitmap(await (await fetch(data)).blob());
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let x = 0,
        y = 0,
        count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          Math.abs(pixels[i]! - 255) <= 1 &&
          Math.abs(pixels[i + 1]! - 220) <= 1 &&
          Math.abs(pixels[i + 2]! - 114) <= 1
        ) {
          x += (i / 4) % bitmap.width;
          y += Math.floor(i / 4 / bitmap.width);
          count++;
        }
      }
      bitmap.close();
      if (!count) throw new Error('Missing selected mesh diamond in textured preview.');
      return { x: x / count / surface.width, y: y / count / surface.height };
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
  const bounds = (await canvas.boundingBox())!;
  return { x: bounds.x + point.x * bounds.width, y: bounds.y + point.y * bounds.height };
}

test('textured mesh conversion, subdivision, canvas editing, camera, history and export/reload', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await selectRigEntry(page, '◇ leftForearmVisual');
  await inspectorControl(page, '#mesh-geometry-panel');
  const panel = page.locator('#mesh-geometry-panel');
  await panel.getByRole('button', { name: 'Convert to Mesh Attachment', exact: true }).click();
  await expect(panel).toContainText('4 vertices · 2 triangles');
  const skin = await panel.getByLabel('Mesh skin', { exact: true }).inputValue();
  expect(skin).toContain('-mesh');
  await expect(page.locator('#edit-mode')).toHaveValue('mesh');
  await panel.getByLabel('Mesh edge', { exact: true }).selectOption('0:2');
  await panel.getByRole('button', { name: 'Subdivide edge', exact: true }).click();
  await expect(panel).toContainText('5 vertices · 4 triangles');
  await expect(panel.getByLabel('Mesh vertex', { exact: true })).toHaveValue('vertex-1');
  const x = panel.getByLabel('Vertex X', { exact: true });
  const originalX = await x.inputValue();
  await x.fill(String(Number(originalX) + 2));
  const y = panel.getByLabel('Vertex Y', { exact: true });
  await y.click();
  await expect(y).toBeFocused();
  await expect(x).toHaveValue(String(Number(originalX) + 2));
  await page.locator('#undo').click();
  await expect(x).toHaveValue(originalX);
  await page.locator('#redo').click();
  await expect(x).toHaveValue(String(Number(originalX) + 2));
  const canvas = page.locator('#editor-stage canvas');
  await panel.getByLabel('Mesh vertex', { exact: true }).selectOption('top-left');
  const corner = await x.inputValue();
  // Exercise picking after wheel zoom and middle-button camera panning.
  let point = await selectedDiamond(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -180);
  await waitForPreviewPaint(page);
  point = await selectedDiamond(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(point.x + 25, point.y + 15);
  await page.mouse.up({ button: 'middle' });
  point = await selectedDiamond(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 12, point.y - 8, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(x).toHaveValue(corner);
  point = await selectedDiamond(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 12, point.y - 8, { steps: 4 });
  await page.mouse.up();
  await expect(x).not.toHaveValue(corner);
  const movedX = await x.inputValue();
  await page.locator('#undo').click();
  await expect(x).toHaveValue(corner);
  await page.locator('#redo').click();
  await expect(x).toHaveValue(movedX);
  await canvas.screenshot({ path: test.info().outputPath('edited-textured-mesh.png') });
  // Invalid moves are reported without changing the authored vertex.
  await x.fill('1000000');
  await x.press('Enter');
  await expect(x).toHaveValue(movedX);
  await expect(panel).toContainText(/clockwise|overlap/);
  await page.locator('#download-json').click();
  await rigFileAction(page, '#reload-exported', (control) => control.click());
  await inspectorControl(page, '#mesh-geometry-panel');
  await panel.getByLabel('Mesh skin', { exact: true }).selectOption(skin);
  await panel.getByLabel('Mesh attachment slot', { exact: true }).selectOption('leftForearmVisual');
  await panel.getByRole('button', { name: 'Edit Mesh Geometry', exact: true }).click();
  await expect(panel).toContainText('5 vertices · 4 triangles');
  await panel.getByLabel('Mesh vertex', { exact: true }).selectOption('top-left');
  await expect(x).toHaveValue(movedX);
  await panel.getByLabel('Mesh skin', { exact: true }).selectOption('default');
  await expect(panel.getByRole('button', { name: 'Convert to Mesh Attachment', exact: true })).toBeEnabled();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
});

for (const focused of [true, false]) {
  test(`mesh slot selection retains Mesh geometry with ${focused ? 'dropdown focus' : 'lost focus'}`, async ({
    page,
  }) => {
    await page.goto('rig-editor/');
    await expect(page.locator('#validation')).toHaveText('Validation: OK');
    await selectRigEntry(page, '◇ rightForearmVisual');
    await inspectorControl(page, '#mesh-geometry-panel');
    const panel = page.locator('#mesh-geometry-panel');
    const slot = panel.getByLabel('Mesh attachment slot', { exact: true });
    const meshTab = page.getByRole('tab', { name: 'Mesh geometry', exact: true });
    const detailsTab = page.getByRole('tab', { name: 'Selection details', exact: true });
    const selectSlot = async (id: string) => {
      if (focused) await slot.focus();
      else {
        // Native dropdown change notifications can arrive after inspector focus has moved away.
        await page.locator('#edit-mode').focus();
        expect(await page.locator('#rig-inspector').evaluate((element) => element.matches(':focus-within'))).toBe(
          false,
        );
      }
      await slot.selectOption(id);
      await expect(meshTab).toHaveAttribute('aria-selected', 'true');
      await expect(detailsTab).toHaveAttribute('aria-selected', 'false');
      await expect(panel).toBeVisible();
      if (focused) await expect(slot).toBeFocused();
      await expect(slot).toHaveValue(id);
    };
    for (const id of ['leftForearmVisual', 'rightForearmVisual', 'leftForearmVisual']) {
      await selectSlot(id);
      await expect(panel.getByRole('button', { name: 'Convert to Mesh Attachment', exact: true })).toBeVisible();
    }
    await expect(page.locator('#dirty-status')).toHaveText('No changes');
    await panel.getByRole('button', { name: 'Convert to Mesh Attachment', exact: true }).click();
    await expect(panel).toContainText('4 vertices · 2 triangles');
    await selectSlot('rightForearmVisual');
    await expect(panel.getByRole('button', { name: 'Convert to Mesh Attachment', exact: true })).toBeVisible();
    await selectSlot('leftForearmVisual');
    await expect(panel).toContainText('4 vertices · 2 triangles');
    await expect(panel.getByLabel('Mesh vertex', { exact: true })).toBeVisible();
  });
}
