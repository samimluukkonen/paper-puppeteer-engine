import { expect } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationHierarchy, animationMenuControl, test, animationIKInspector, inspectorControl } from './fixtures.js';

test('React IK inspector authors A/B/C targets, pauses edits, refreshes preview and preserves bone authoring', async ({
  page,
}, testInfo) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        loop: false,
        playback: { mode: 'smooth' },
        tracks: {},
        events: [{ time: 500, name: 'middle' }],
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const inspector = page.locator('#animation-ik-inspector');
  const ruler = page.locator('#timeline-ruler');
  const canvas = page.locator('#animation-stage canvas');
  await page.getByRole('button', { name: 'Select IK target rightArmIK', exact: true }).click();
  await animationIKInspector(page);
  await expect(inspector).toBeVisible();
  await expect(page.locator('#animation-bone-inspector')).toBeHidden();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.getByRole('button', { name: 'Expand rightArmIK properties', exact: true }).click();
  const x = inspector.locator('[data-ik-property="x"]');
  const y = inspector.locator('[data-ik-property="y"]');
  const mix = inspector.locator('[data-ik-property="mix"]');
  await ruler.press('Home');
  const original = await canvas.screenshot();
  await x.fill('22');
  await y.fill('-42');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await inspector.getByRole('button', { name: 'Set IK x key', exact: true }).click();
  await expect(page.locator('.timeline-ik-property-track[data-property="x"] .timeline-keyframe')).toHaveCount(1);
  await expect(page.locator('.timeline-ik-property-track[data-property="y"] .timeline-keyframe')).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Set IK y key', exact: true }).click();
  const a = await canvas.screenshot();
  expect(a.equals(original)).toBe(false);
  for (let i = 0; i < 5; i++) await ruler.press('Shift+ArrowRight');
  await expect(ruler).toHaveAttribute('aria-valuenow', '0.5');
  await x.fill('-8');
  await y.fill('-22');
  await inspector.getByRole('button', { name: 'Set IK x key', exact: true }).click();
  await inspector.getByRole('button', { name: 'Set IK y key', exact: true }).click();
  const b = await canvas.screenshot();
  expect(b.equals(a)).toBe(false);
  await ruler.press('End');
  await x.fill('-78');
  await y.fill('-32');
  await inspector.getByRole('button', { name: 'Set IK x key', exact: true }).click();
  await inspector.getByRole('button', { name: 'Set IK y key', exact: true }).click();
  const c = await canvas.screenshot();
  await page.getByRole('button', { name: 'Select IK target rightArmIK', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('ik-authoring.png'), fullPage: true });
  expect(c.equals(b)).toBe(false);
  await mix.fill('0');
  await inspector.getByRole('button', { name: 'Set IK mix key', exact: true }).click();
  expect((await canvas.screenshot()).equals(c)).toBe(false);
  await inspector.getByLabel('Influence (mix) key actions', { exact: true }).click();
  await inspector.getByRole('button', { name: 'Delete IK mix key', exact: true }).click();
  expect((await canvas.screenshot()).equals(c)).toBe(true);
  await inspector.getByLabel('Target X key actions', { exact: true }).click();
  await inspector.getByRole('button', { name: 'Delete IK x key', exact: true }).click();
  await expect(x).toHaveValue('-8');
  await page.locator('#animation-undo').click();
  await expect(x).toHaveValue('-78');
  expect((await canvas.screenshot()).equals(c)).toBe(true);
  await page.locator('#animation-redo').click();
  await expect(x).toHaveValue('-8');
  await page.locator('#animation-undo').click();
  await ruler.press('Home');
  expect((await canvas.screenshot()).equals(a)).toBe(true);
  await page.locator('#play-pause').click();
  await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).toBeGreaterThan(0.1);
  await x.focus();
  const held = await ruler.getAttribute('aria-valuenow');
  await x.fill('15');
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await expect(ruler).toHaveAttribute('aria-valuenow', held!);
  await inspector.getByRole('button', { name: 'Set IK x key', exact: true }).click();
  await expect(ruler).toHaveAttribute('aria-valuenow', held!);
  await page.getByRole('button', { name: 'Select rightArmIK x key at 0 s', exact: true }).click();
  await page.locator('#timeline-snap-enabled').check();
  for (const mode of ['keyframes', 'events', 'playhead']) await page.locator(`#timeline-snap-${mode}`).uncheck();
  await page.locator('#timeline').press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Select rightArmIK x key at 0.1 s', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await (await animationMenuControl(page, '#timeline-delete-key')).click();
  await expect(page.getByRole('button', { name: 'Select rightArmIK x key at 0.1 s', exact: true })).toHaveCount(0);
  await page.locator('#animation-undo').click();
  await (await animationHierarchy(page)).getByRole('button', { name: 'rightUpperArm', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
  await expect(inspector).toBeHidden();
  const boneInspector = page.locator('#animation-bone-inspector');
  await boneInspector.locator('[data-property="rotation"]').fill('30');
  await boneInspector.getByRole('button', { name: 'Set Rotation (°) key', exact: true }).click();
  await expect(boneInspector.locator('[data-keyed-property="rotation"]')).toHaveAttribute('data-keyed', 'true');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
});
