import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { createRectangleMeshAttachment } from '../../src/engine/meshAttachments.js';
import { animationFileSchema, rigFileSchema } from '../../src/engine/schemas.js';
import { animationControl, animationFileAction, inspectorControl, test, waitForPreviewPaint } from './fixtures.js';

async function exported(page: Page) {
  const pending = page.waitForEvent('download');
  await (await animationControl(page, '#animation-download')).click();
  return animationFileSchema.parse(JSON.parse(await readFile(await (await pending).path(), 'utf8')));
}
async function seek(page: Page, time: string) {
  await page.locator('#timeline-time-input').fill(time);
  await page.locator('#timeline-time-input').press('Tab');
  await waitForPreviewPaint(page);
}

/** Wait for two identical painted captures before comparing a seek round trip. */
async function stableCanvas(page: Page): Promise<Buffer> {
  let previous: Buffer | undefined;
  let result: Buffer | undefined;
  await expect
    .poll(async () => {
      result = await page.locator('#animation-stage canvas').screenshot();
      const stable = previous?.equals(result) ?? false;
      previous = result;
      return stable;
    })
    .toBe(true);
  return result!;
}

async function prepareSleeve(page: Page): Promise<void> {
  await page.route('**/demo-puppet/rig.json', async (route) => {
    const source = rigFileSchema.parse(await (await route.fetch()).json());
    const sprite = source.attachments!.find((entry) => entry.id === 'leftForearmDefault')!;
    if (sprite.type === 'mesh') throw new Error('Expected a sprite fixture.');
    const mesh = createRectangleMeshAttachment(sprite, { width: 24, height: 67 }, source, 'leftForearm');
    await route.fulfill({
      json: {
        ...source,
        attachments: source.attachments!.map((entry) =>
          entry.id === mesh.id
            ? {
                ...mesh,
                vertices: mesh.vertices.map((vertex) => ({
                  ...vertex,
                  influences: [
                    { boneId: 'leftForearm', weight: 0.8 },
                    { boneId: 'leftUpperArm', weight: 0.2 },
                  ],
                })),
              }
            : entry,
        ),
      },
    });
  });
  await page.route('**/animations/idle.json', async (route) => {
    const source = animationFileSchema.parse(await (await route.fetch()).json());
    await route.fulfill({
      json: {
        ...source,
        duration: 1000,
        loop: false,
        playback: { mode: 'smooth' },
        tracks: {
          leftUpperArm: [
            { time: 0, rotation: 0 },
            { time: 500, rotation: -0.7 },
            { time: 1000, rotation: -1.3 },
          ],
          leftForearm: [
            { time: 0, rotation: 0 },
            { time: 500, rotation: 1.7 },
            { time: 1000, rotation: 0.3 },
          ],
        },
        events: [],
      },
    });
  });
}

test('sleeve corrections: bind handles, interpolation, timeline, history, cancellation and portable reload', async ({
  page,
}) => {
  await prepareSleeve(page);
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const baseline = await exported(page);
  const panel = page.locator('#mesh-deformation-panel');
  await expect(panel).toBeHidden();
  await (await inspectorControl(page, '#deformation-edit-mode')).check();
  await expect(page.locator('#deformation-mesh')).toHaveValue('leftForearmDefault');
  await page.locator('#deformation-neutral').click();
  await seek(page, '1');
  await page.locator('#deformation-neutral').click();
  await seek(page, '0.5');
  const canvas = page.locator('#animation-stage canvas');
  const before = await stableCanvas(page);
  await page.locator('#deformation-x').fill('15');
  await page.locator('#deformation-y').fill('-8');
  await panel.getByRole('button', { name: 'Set vertex correction key' }).click();
  const authored = await exported(page);
  expect(authored.tracks).toEqual(baseline.tracks);
  expect(authored.deformationTracks!.leftForearmDefault![1]!.offsets['top-left']).toEqual({ x: 15, y: -8 });
  await expect(
    page.getByRole('button', { name: 'Select leftForearmDefault deformation key at 0.5 s', exact: true }),
  ).toBeVisible();
  await waitForPreviewPaint(page);
  expect(await canvas.screenshot()).not.toEqual(before);
  await seek(page, '0.25');
  await expect(page.locator('#deformation-x')).toHaveValue('7.5');
  await seek(page, '0.75');
  await expect(page.locator('#deformation-x')).toHaveValue('7.5');
  await seek(page, '0.5');
  const held = await stableCanvas(page);
  await seek(page, '0');
  await seek(page, '1');
  await seek(page, '0.5');
  expect((await stableCanvas(page)).equals(held)).toBe(true);
  await page.locator('#animation-undo').click();
  await expect(page.locator('#deformation-x')).toHaveValue('0');
  await page.locator('#animation-redo').click();
  expect(await exported(page)).toEqual(authored);

  const handle = page.getByRole('button', { name: 'Select bind-space vertex top-left', exact: true });
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 20, bounds.y + bounds.height / 2 + 10, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await exported(page)).toEqual(authored);
  await handle.focus();
  await handle.press('Enter');
  await page
    .getByRole('button', { name: 'Select bind-space vertex bottom-left', exact: true })
    .click({ modifiers: ['Shift'] });
  const moved = (await handle.boundingBox())!;
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(moved.x + moved.width / 2 + 16, moved.y + moved.height / 2, { steps: 4 });
  await page.mouse.up();
  const dragged = await exported(page);
  expect(dragged).not.toEqual(authored);
  expect(dragged.deformationTracks!.leftForearmDefault![1]!.offsets['bottom-left']!.x).toBeGreaterThan(0);
  await page.locator('#animation-undo').click();
  expect(await exported(page)).toEqual(authored);

  const key = page.getByRole('button', { name: 'Select leftForearmDefault deformation key at 0.5 s', exact: true });
  await key.click();
  const lane = (await key.locator('..').boundingBox())!;
  const marker = (await key.boundingBox())!;
  await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await page.mouse.down();
  await page.mouse.move(marker.x + marker.width / 2 + lane.width * 0.1, marker.y + marker.height / 2, { steps: 4 });
  await page.mouse.up();
  const draggedKey = page.locator('.timeline-deformation-track .timeline-keyframe[aria-pressed="true"]');
  await expect(draggedKey).toBeVisible();
  // Fractional CSS lane widths can produce subpixel differences in the authored time.
  expect(Number(await draggedKey.getAttribute('data-time'))).toBeCloseTo(0.6, 6);
  await page.locator('#animation-undo').click();
  expect(await exported(page)).toEqual(authored);
  await key.click();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('button', { name: 'Select leftForearmDefault deformation key at 0.6 s', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  expect(await exported(page)).toEqual(authored);
  await key.click();
  await page.locator('#deformation-key-time').fill('0.6');
  await page.locator('#deformation-apply-key').click();
  await expect(
    page.getByRole('button', { name: 'Select leftForearmDefault deformation key at 0.6 s', exact: true }),
  ).toBeVisible();
  await page.locator('#animation-undo').click();
  expect(await exported(page)).toEqual(authored);
  await key.click();
  await page.keyboard.press('ControlOrMeta+c');
  await seek(page, '0.8');
  await page.locator('#timeline').focus();
  await page.keyboard.press('ControlOrMeta+v');
  expect((await exported(page)).deformationTracks!.leftForearmDefault).toHaveLength(4);
  await page.keyboard.press('Delete');
  expect(await exported(page)).toEqual(authored);
  await animationFileAction(page, '#animation-reload-export', (control) => control.click());
  expect(await exported(page)).toEqual(authored);
  await (await inspectorControl(page, '#deformation-edit-mode')).check();
  await seek(page, '0.5');
  await expect(page.locator('#deformation-x')).toHaveValue('15');
  await page.screenshot({ path: test.info().outputPath('sleeve-correction.png') });
});

test('deformation guide reveals real controls without enabling editing or changing existing corrections', async ({
  page,
}) => {
  await prepareSleeve(page);
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const guide = guideRegistry.getGuideById('animation-mesh-deformation')!;
  const panel = page.locator('#mesh-deformation-panel');
  await expect(panel).toBeHidden();
  const snapshot = async () => ({
    fields: await panel.locator('input, select').evaluateAll((controls) =>
      controls.map((element) => {
        const field = element as HTMLInputElement | HTMLSelectElement;
        return { id: field.id, value: field.value, checked: field instanceof HTMLInputElement ? field.checked : false };
      }),
    ),
    vertices: await panel
      .locator('[data-vertex][aria-pressed="true"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-vertex'))),
    time: await page.locator('#current-time').textContent(),
    dirty: await page.locator('#animation-dirty').textContent(),
    undo: await page.locator('#animation-undo').isEnabled(),
    redo: await page.locator('#animation-redo').isEnabled(),
    clip: await page.locator('#animation-selection').inputValue(),
    facing: await page.locator('#animation-facing').inputValue(),
  });
  for (const configured of [false, true]) {
    if (configured) {
      await (await inspectorControl(page, '#deformation-edit-mode')).check();
      await seek(page, '0.5');
      await page.locator('#deformation-x').fill('8');
      await page.locator('#deformation-y').fill('-4');
      await panel.getByRole('button', { name: 'Set vertex correction key' }).click();
      await page.locator('#deformation-x').fill('10');
      await panel.getByRole('button', { name: 'Set vertex correction key' }).click();
      await page.locator('#animation-undo').click();
      await page.locator('#deformation-vertex').selectOption('bottom-left');
      await page.locator('#animation-facing').selectOption('left');
    }
    const authored = await exported(page);
    const before = await snapshot();
    let downloads = 0;
    const downloaded = () => downloads++;
    page.on('download', downloaded);
    const launch = async () => {
      await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
      await page.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
      return page.getByRole('dialog', { name: guide.title, exact: true });
    };
    const tour = await launch();
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour).toContainText(`Step ${index + 1} of ${guide.steps.length}`);
      const target = page.locator(`[data-guide-id="${step.targetId}"]`);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
      const hole = tour.locator('.guide-spotlight-hole');
      await expect(hole).toBeVisible();
      await expect
        .poll(async () => {
          const bounds = await target.boundingBox(),
            spot = await hole.boundingBox();
          if (!bounds || !spot) return false;
          const x = spot.x + spot.width / 2,
            y = spot.y + spot.height / 2;
          return (
            x >= bounds.x - 4 &&
            x <= bounds.x + bounds.width + 4 &&
            y >= bounds.y - 4 &&
            y <= bounds.y + bounds.height + 4
          );
        })
        .toBe(true);
      await expect(tour.getByRole('status')).toHaveCount(0);
      await expect(tour.getByRole('button', { name: 'Try It', exact: true })).toHaveCount(0);
      if (index === 4) {
        await page.screenshot({
          path: test.info().outputPath(`deformation-guide-${configured ? 'authored' : 'empty'}.png`),
        });
        await tour.getByRole('button', { name: 'Back', exact: true }).click();
        await tour.getByRole('button', { name: 'Next', exact: true }).click();
      }
      await tour
        .getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true })
        .click();
    }
    await expect(tour).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
    expect(await snapshot()).toEqual(before);
    expect(downloads).toBe(0);
    page.off('download', downloaded);
    expect(await exported(page)).toEqual(authored);
    const restarted = await launch();
    await restarted.getByRole('button', { name: 'Next', exact: true }).click();
    await restarted.getByRole('button', { name: 'Restart guide', exact: true }).click();
    await expect(restarted).toContainText('Step 1 of 9');
    await page.keyboard.press('Escape');
    await expect(restarted).toHaveCount(0);
    expect(await snapshot()).toEqual(before);
  }
});

test('posed mesh diagnostics toggle without authoring corrections or changing playback data', async ({ page }) => {
  await prepareSleeve(page);
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toContainText('Validation: OK');
  await inspectorControl(page, '#mesh-deformation-panel');
  const panel = page.locator('#mesh-deformation-panel');
  const diagnostics = panel.getByLabel('Show mesh diagnostics', { exact: true });
  await expect(diagnostics).not.toBeChecked();
  await panel.getByLabel('Deformable mesh', { exact: true }).selectOption('leftForearmDefault');
  const before = await exported(page);
  await seek(page, '0.5');
  const clean = await stableCanvas(page);
  await diagnostics.check();
  await expect(page.locator('#animation-mesh-diagnostics-status')).toContainText('Bones: leftForearm, leftUpperArm');
  await expect(page.locator('#deformation-edit-mode')).not.toBeChecked();
  const overlay = await stableCanvas(page);
  expect(overlay.equals(clean)).toBe(false);
  expect(await exported(page)).toEqual(before);
  await diagnostics.uncheck();
  expect((await stableCanvas(page)).equals(clean)).toBe(true);
  await diagnostics.check();
  await seek(page, '0.8');
  await expect(page.locator('#animation-mesh-diagnostics-status')).toContainText('Review hints only');
  expect(await exported(page)).toEqual(before);
  await diagnostics.uncheck();
});
