import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import {
  animationHierarchy,
  animationMenuControl,
  animationFileAction,
  test,
  animationIKInspector,
} from './fixtures.js';

/** Locate the selected Phaser crosshair from its rendered pixels, without runtime test hooks. */
async function targetPoint(page: Page) {
  const canvas = page.locator('#animation-stage canvas');
  const screenshot = await canvas.screenshot();
  const point = await page.evaluate(
    async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let x = 0,
        y = 0,
        count = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (
          Math.abs(data[index]! - 231) <= 2 &&
          Math.abs(data[index + 1]! - 165) <= 2 &&
          Math.abs(data[index + 2]! - 43) <= 2
        ) {
          const pixel = index / 4;
          x += pixel % bitmap.width;
          y += Math.floor(pixel / bitmap.width);
          ++count;
        }
      }
      return count ? { x: x / count, y: y / count, width: bitmap.width, height: bitmap.height } : null;
    },
    `data:image/png;base64,${screenshot.toString('base64')}`,
  );
  if (!point) throw new Error('Selected IK crosshair was not rendered.');
  const bounds = (await canvas.boundingBox())!;
  return {
    x: bounds.x + (point.x * bounds.width) / point.width,
    y: bounds.y + (point.y * bounds.height) / point.height,
  };
}

async function exported(page: Page) {
  const downloaded = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return animationFileSchema.parse(JSON.parse(Buffer.concat(chunks).toString()));
}

test('hand and foot handles preview, cancel, commit two keys, animate and retain ownership through editor lifecycle', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        loop: false,
        playback: { mode: 'smooth' },
        tracks: {},
        ikTracks: {},
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const canvas = page.locator('#animation-stage canvas');
  const inspector = page.locator('#animation-ik-inspector');
  const x = inspector.locator('[data-ik-property="x"]');
  const y = inspector.locator('[data-ik-property="y"]');
  const ruler = page.locator('#timeline-ruler');
  await page.locator('#playback-speed').selectOption('0.25');
  for (const id of ['rightArmIK', 'rightLegIK']) {
    await ruler.press('Home');
    await page.getByRole('button', { name: `Select IK target ${id}`, exact: true }).click();
    await animationIKInspector(page);
    // Initially requested and solved points coincide, allowing pixel-based crosshair picking.
    if (id === 'rightArmIK') {
      await x.fill('22');
      await y.fill('-42');
    } else {
      await x.fill(String(Number(await x.inputValue()) + 10));
      await y.fill(String(Number(await y.inputValue()) - 10));
    }
    await inspector.getByRole('button', { name: 'Set Target Key', exact: true }).click();
    const before = await exported(page);
    const originalX = Number(await x.inputValue());
    const originalY = Number(await y.inputValue());
    const start = await targetPoint(page);
    await (await animationHierarchy(page)).getByRole('button', { name: 'root', exact: true }).click();
    const originalCanvas = await canvas.screenshot();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await expect(inspector).toBeVisible();
    await expect(inspector.locator(':scope > details > summary')).toContainText(id);
    await page.mouse.move(start.x + 35, start.y - 25, { steps: 6 });
    await expect(x).toHaveAttribute('data-temporary', 'true');
    await expect(ruler).toHaveAttribute('aria-valuenow', '0');
    expect((await canvas.screenshot()).equals(originalCanvas)).toBe(false);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(x).toHaveValue(String(originalX));
    await expect(y).toHaveValue(String(originalY));
    await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 20, start.y - 25, { steps: 5 });
    await page.mouse.up();
    const draftX = Number(await x.inputValue());
    const draftY = Number(await y.inputValue());
    expect(draftX).not.toBe(originalX);
    await expect(x).toHaveAttribute('data-temporary', 'true');
    await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
    expect(await exported(page)).toEqual(before);
    await inspector.getByRole('button', { name: 'Set Target Key', exact: true }).click();
    await page.locator('#animation-undo').click();
    await expect(x).toHaveValue(String(originalX));
    await expect(y).toHaveValue(String(originalY));
    await page.locator('#animation-redo').click();
    expect(Number(await x.inputValue())).toBeCloseTo(draftX, 5);
    expect(Number(await y.inputValue())).toBeCloseTo(draftY, 5);
    await ruler.press('End');
    const second = await targetPoint(page);
    await page.mouse.move(second.x, second.y);
    await page.mouse.down();
    await page.mouse.move(second.x - 10, second.y - 10, { steps: 5 });
    await page.mouse.up();
    await expect(x).toHaveAttribute('data-temporary', 'true');
    await inspector.getByRole('button', { name: 'Set Target Key', exact: true }).click();
    await ruler.press('Home');
    await page.locator('#play-pause').click();
    await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).toBeGreaterThan(0.1);
    // Beginning a drag pauses at the exact current clock.
    const moving = await targetPoint(page);
    await page.mouse.move(moving.x, moving.y);
    await page.mouse.down();
    await expect(page.locator('#play-pause')).toHaveText('Play');
    const held = await ruler.getAttribute('aria-valuenow');
    await page.mouse.move(moving.x + 8, moving.y - 8);
    await page.mouse.up();
    await expect(x).toHaveAttribute('data-temporary', 'true');
    await expect(ruler).toHaveAttribute('aria-valuenow', held!);
    await inspector.getByRole('button', { name: 'Cancel IK edits', exact: true }).click();
  }
  await page.locator('#animation-facing').selectOption('left');
  await page.locator('#animation-onion-skinning').check();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -160);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(bounds.x + bounds.width / 2 + 20, bounds.y + bounds.height / 2 + 20);
  await page.mouse.up({ button: 'middle' });
  await page.screenshot({ path: info.outputPath('ik-handles-facing-onion.png'), fullPage: true });
  await (await animationMenuControl(page, '#animation-ik-preview')).check();
  await expect(inspector.getByRole('status')).toContainText('target provider');
  await expect(inspector.getByRole('button', { name: 'Set Target Key', exact: true })).toBeDisabled();
  await (await animationMenuControl(page, '#animation-ik-preview')).uncheck();
  await expect(inspector.getByRole('button', { name: 'Set Target Key', exact: true })).toBeEnabled();
  await (await animationMenuControl(page, '#animation-ik-drag')).uncheck();
  await (await animationMenuControl(page, '#animation-ik-handles')).uncheck();
  await (await animationMenuControl(page, '#animation-ik-handles')).check();
  await (await animationMenuControl(page, '#animation-ik-drag')).check();
  await animationFileAction(page, '#animation-reload-export', (control) => control.click());
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.reload();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
});

test('random paperdoll sketch exposes and authors both hand and foot targets', async ({ page }, info) => {
  test.setTimeout(90000);
  await page.goto('animation-editor/?character=random-paperdoll-sketch');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(page.locator('#character-status')).toHaveText('Character: random-paperdoll-sketch');
  await page.locator('#animation-show-bones').uncheck();
  const inspector = page.locator('#animation-ik-inspector');
  const x = inspector.locator('[data-ik-property="x"]');
  const y = inspector.locator('[data-ik-property="y"]');
  await page.screenshot({ path: info.outputPath('sketch-ik-targets-unselected.png'), fullPage: true });
  const targets = ['rightArmIK', 'leftArmIK', 'leftLegIK', 'rightLegIK'];
  const values = new Map<string, { x: number; y: number }>();
  for (const [index, id] of targets.entries()) {
    if (index === 2) await page.locator('#animation-facing').selectOption('left');
    await page.getByRole('button', { name: `Select IK target ${id}`, exact: true }).click();
    await animationIKInspector(page);
    await expect(inspector.getByRole('button', { name: 'Set Target Key', exact: true })).toBeEnabled();
    const originalX = Number(await x.inputValue());
    const originalY = Number(await y.inputValue());
    const start = await targetPoint(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 15, start.y - 20, { steps: 5 });
    await page.mouse.up();
    await expect(x).toHaveAttribute('data-temporary', 'true');
    const draft = { x: Number(await x.inputValue()), y: Number(await y.inputValue()) };
    expect(draft.x).not.toBe(originalX);
    expect(draft.y).not.toBe(originalY);
    values.set(id, draft);
    await inspector.getByRole('button', { name: 'Set Target Key', exact: true }).click();
    await expect(x).toHaveAttribute('data-temporary', 'false');
    await page.locator('#animation-undo').click();
    await expect(x).toHaveValue(String(originalX));
    await expect(y).toHaveValue(String(originalY));
    await page.locator('#animation-redo').click();
    expect(Number(await x.inputValue())).toBeCloseTo(draft.x, 5);
    expect(Number(await y.inputValue())).toBeCloseTo(draft.y, 5);
  }
  const animation = await exported(page);
  for (const id of targets) {
    const key = animation.ikTracks?.[id]?.find((entry) => entry.time === 0);
    expect(key?.x).toBeCloseTo(values.get(id)!.x, 5);
    expect(key?.y).toBeCloseTo(values.get(id)!.y, 5);
    expect(key?.mix).toBeUndefined();
  }
  await page.locator('#animation-onion-skinning').check();
  await page.screenshot({ path: info.outputPath('sketch-ik-targets.png'), fullPage: true });
  await (await animationMenuControl(page, '#animation-ik-preview')).check();
  await expect(inspector.getByRole('status')).toContainText('target provider');
  await (await animationMenuControl(page, '#animation-ik-preview')).uncheck();
  await expect(inspector.getByRole('button', { name: 'Set Target Key', exact: true })).toBeEnabled();
});
