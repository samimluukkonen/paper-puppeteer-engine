import { expect } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { rigFileSchema } from '../../src/engine/schemas.js';
import { inspectorControl, rigFileAction, selectRigEntry, test } from './fixtures.js';

const guides = guideRegistry.getGuidesForEditor('rig');
test.setTimeout(240_000);

for (const existing of [true, false]) {
  test(`walk every available Rig Editor guide with resolved spotlights and preserved edits; existing=${existing}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('rig-editor/');
    await expect(page.locator('#validation')).toHaveText('Validation: OK');
    if (!existing) {
      await page.getByRole('button', { name: '+ New Character', exact: true }).click();
      const create = page.getByRole('dialog', { name: 'Create new character', exact: true });
      await create.getByLabel('Character name', { exact: true }).fill('Tour character');
      await create.getByRole('button', { name: 'Create Character', exact: true }).click();
      await expect(page).toHaveURL(/character=tour-character$/);
      await expect(page.locator('#validation')).toHaveText('Validation: OK');
    }
    await expect(page.locator('#rig-inspector details[open]')).toHaveCount(0);
    await selectRigEntry(page, 'root');
    const x = await inspectorControl(page, '#inspector input[data-scope="bone"][data-field="x"]');
    await x.fill('19');
    await x.press('Tab');
    const logRig = async () => {
      const logged = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
      await rigFileAction(page, '#log-json', (button) => button.click());
      return rigFileSchema.parse(JSON.parse((await logged).text()));
    };
    const before = await logRig();
    await x.fill('23');
    await x.press('Tab');
    const expected = { ...before, bones: before.bones.map((bone) => (bone.id === 'root' ? { ...bone, x: 23 } : bone)) };
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    const canvas = await page.locator('#editor-stage canvas').elementHandle();
    for (const guide of guides) {
      const open = page.getByRole('button', { name: 'Feature Guide', exact: true });
      await open.click();
      const start = page.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true });
      if (!existing && ['rig-aligning-sprites', 'rig-ik-constraints', 'rig-mesh-geometry'].includes(guide.id)) {
        await expect(start).toBeDisabled();
        await page.keyboard.press('Escape');
        continue;
      }
      await start.click();
      const tour = page.getByRole('dialog', { name: guide.title, exact: true });
      for (const [index, step] of guide.steps.entries()) {
        await expect(tour).toContainText(`Step ${index + 1} of ${guide.steps.length}`);
        await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
        const target = page.locator(`[data-guide-id="${step.targetId}"]`);
        await expect(target).toHaveCount(1);
        await expect(target).toBeVisible();
        await expect(tour.getByRole('status')).toHaveCount(0);
        const hole = tour.locator('.guide-spotlight-hole');
        await expect(hole).toBeVisible();
        await expect
          .poll(async () => {
            const bounds = await target.boundingBox();
            const spot = await hole.boundingBox();
            if (!bounds || !spot) return false;
            const center = { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2 };
            return (
              center.x >= bounds.x - 4 &&
              center.x <= bounds.x + bounds.width + 4 &&
              center.y >= bounds.y - 4 &&
              center.y <= bounds.y + bounds.height + 4
            );
          })
          .toBe(true);
        await expect(tour.getByRole('button', { name: 'Exit', exact: true })).toBeEnabled();
        if (existing) await page.screenshot({ path: testInfo.outputPath(`${guide.id}-${step.id}.png`) });
        if (index === 1) {
          await tour.getByRole('button', { name: 'Back', exact: true }).click();
          await expect(tour).toContainText(`Step 1 of ${guide.steps.length}`);
          await tour.getByRole('button', { name: 'Next', exact: true }).click();
        }
        await tour
          .getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true })
          .click();
      }
      await expect(tour).toHaveCount(0);
      await expect(open).toBeFocused();
      await expect(x).toHaveValue('23');
      await expect(page.locator('#dirty-status')).toContainText('Unsaved changes');
      await expect(page.locator('#edit-mode')).toHaveValue('joint');
      expect(downloads).toEqual([]);
      // Each guide can also be exited before completion.
      await open.click();
      await start.click();
      await page.keyboard.press('Escape');
      await expect(tour).toHaveCount(0);
    }
    expect(
      await page.locator('#editor-stage canvas').evaluate((element, original) => element === original, canvas),
    ).toBe(true);
    expect(await logRig()).toEqual(expected);
    await page.locator('#undo').click();
    await expect(x).toHaveValue('19');
    await page.locator('#redo').click();
    await expect(x).toHaveValue('23');
  });
}

test('New Character tour remains available when character loading fails', async ({ page }) => {
  await page.goto('rig-editor/?character=unavailable');
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.getByRole('button', { name: 'Start Guide: Creating a New Character', exact: true }).click();
  const tour = page.getByRole('dialog', { name: 'Creating a New Character', exact: true });
  for (let index = 0; index < 3; index++) {
    await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
    await expect(tour.getByRole('status')).toHaveCount(0);
    await tour.getByRole('button', { name: index === 2 ? 'Finish' : 'Next', exact: true }).click();
  }
  await expect(tour).toHaveCount(0);
});

test('mesh guide resolves before and after conversion while preserving mesh selection and history', async ({
  page,
}) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await inspectorControl(page, '#mesh-geometry-panel');
  const panel = page.locator('#mesh-geometry-panel');
  await panel.getByLabel('Mesh attachment slot', { exact: true }).selectOption('leftForearmVisual');
  const guide = guideRegistry.getGuideById('rig-mesh-geometry')!;
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  const walkthrough = async () => {
    await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
    await page.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
    const tour = page.getByRole('dialog', { name: guide.title, exact: true });
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
      const target = page.locator(`[data-guide-id="${step.targetId}"]`);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
      await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
      await expect(tour.getByRole('status')).toHaveCount(0);
      if (index === 3)
        await page.screenshot({
          path: test.info().outputPath(`mesh-guide-${await page.locator('#edit-mode').inputValue()}.png`),
        });
      await tour
        .getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true })
        .click();
    }
    await expect(tour).toHaveCount(0);
    expect(downloads).toEqual([]);
  };
  await walkthrough();
  await expect(page.locator('#edit-mode')).toHaveValue('joint');
  await expect(panel.getByLabel('Mesh attachment slot', { exact: true })).toHaveValue('leftForearmVisual');
  await panel.getByRole('button', { name: 'Convert to Mesh Attachment', exact: true }).click();
  await panel.getByLabel('Mesh edge', { exact: true }).selectOption('0:2');
  await panel.getByRole('button', { name: 'Subdivide edge', exact: true }).click();
  await panel.getByLabel('Mesh edge', { exact: true }).selectOption('0:4');
  const skin = await panel.getByLabel('Mesh skin', { exact: true }).inputValue();
  await walkthrough();
  await expect(panel).toContainText('5 vertices · 4 triangles');
  await expect(panel.getByLabel('Mesh edge', { exact: true })).toHaveValue('0:4');
  await expect(panel.getByLabel('Mesh skin', { exact: true })).toHaveValue(skin);
  await expect(page.locator('#edit-mode')).toHaveValue('mesh');
  await page.locator('#undo').click();
  await expect(panel).toContainText('4 vertices · 2 triangles');
  await page.locator('#redo').click();
  await expect(panel).toContainText('5 vertices · 4 triangles');
});
