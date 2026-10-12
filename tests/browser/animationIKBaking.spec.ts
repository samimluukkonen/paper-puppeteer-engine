import { expect } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

test.describe.configure({ timeout: 60000 });

for (const chain of [
  { id: 'rightArmIK', root: 'rightUpperArm', middle: 'rightForearm', target: { x: 22, y: -42 } },
  { id: 'rightLegIK', root: 'rightThigh', middle: 'rightLowerLeg', target: { x: 25, y: 100 } },
]) {
  test(`${chain.id}: preview, scrub, summary, bake, playback and Undo restore authored IK`, async ({ page }) => {
    await page.route('**/animations/idle.json', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        json: {
          ...animationFileSchema.parse(await response.json()),
          duration: 1000,
          loop: false,
          playback: { mode: 'smooth' },
          interpolation: 'linear',
          events: [],
          tracks: {
            [chain.root]: [{ time: 0, rotation: 0.2 }],
            [chain.middle]: [{ time: 0, rotation: 0.1 }],
          },
          ikTracks: {
            [chain.id]: [
              { time: 0, ...chain.target },
              { time: 1000, x: chain.target.x - 70, y: chain.target.y + 30 },
            ],
          },
        },
      });
    });
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    await page.locator('#animation-show-bones').uncheck();
    await page.locator('.animation-ik-baking > summary').click();
    const panel = page.getByRole('region', { name: 'IK Baking', exact: true });
    const bake = panel.getByRole('button', { name: 'Bake IK', exact: true });
    const constraint = panel.getByRole('checkbox', { name: new RegExp(`^${chain.id}`) });
    await expect(bake).toBeDisabled();
    await constraint.check();
    await expect(panel.getByLabel('Bake summary')).toContainText('Generated keys: 22');
    await expect(panel.getByLabel('Bake summary')).toContainText('Existing keys to replace: 2');
    await expect(panel.getByLabel('Bake fidelity')).toContainText('At keys: maximum joint error');
    await expect(panel.getByLabel('Bake fidelity')).toContainText('Between keys: maximum joint error');
    const fps = panel.getByRole('spinbutton', { name: 'Sampling FPS', exact: true });
    await fps.fill('0');
    await expect(bake).toBeDisabled();
    await expect(panel.getByRole('alert')).toBeVisible();
    await fps.fill('5');
    await expect(panel.getByLabel('Bake summary')).toContainText('Generated keys: 12');
    await fps.fill('10');
    const canvas = page.locator('#animation-stage canvas');
    const original = await canvas.screenshot();
    await panel.getByRole('button', { name: 'Preview Bake', exact: true }).click();
    await expect.poll(async () => (await canvas.screenshot()).equals(original)).toBe(false);
    await expect(page.locator('#animation-undo')).toBeDisabled();
    await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
    const ruler = page.locator('#timeline-ruler');
    for (let i = 0; i < 5; i++) await ruler.press('Shift+ArrowRight');
    await expect(ruler).toHaveAttribute('aria-valuenow', '0.5');
    const preview = await canvas.screenshot();
    await panel.getByRole('button', { name: 'Hide Bake Preview', exact: true }).click();
    await expect.poll(async () => (await canvas.screenshot()).equals(preview)).toBe(false);
    await page.locator('.animation-ik-baking > summary').click();
    const originalMiddle = await canvas.screenshot();
    await page.locator('.animation-ik-baking > summary').click();
    // Runtime fixed targets must be rejected instead of baking a different authored pose.
    await page.locator('#animation-ik-preview').check();
    await expect(bake).toBeDisabled();
    await expect(panel.getByRole('alert').first()).toContainText('runtime state');
    await page.locator('#animation-ik-preview').uncheck();
    await expect(bake).toBeEnabled();
    await bake.click();
    await expect(page.locator('#play-pause')).toHaveText('Play');
    await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
    await expect(constraint).toBeDisabled();
    await expect(panel.getByRole('status')).toContainText('IK baked');
    await page.locator('.animation-ik-baking > summary').click();
    await page.getByRole('button', { name: `Expand ${chain.root} properties`, exact: true }).click();
    const keys = page.locator(
      `.timeline-track-lane[data-bone-id="${chain.root}"][data-property="rotation"] .timeline-keyframe`,
    );
    await expect(keys).toHaveCount(11);
    await ruler.press('Home');
    await page.locator('#play-pause').click();
    await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).toBeGreaterThan(0.1);
    await page.locator('#play-pause').click();
    await page.locator('#animation-undo').click();
    await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
    await expect(page.locator('#animation-undo')).toBeDisabled();
    await expect(keys).toHaveCount(1);
    await page.getByRole('button', { name: `Expand ${chain.id} properties`, exact: true }).click();
    await expect(
      page.locator(
        `.timeline-ik-property-track[data-constraint-id="${chain.id}"][data-property="x"] .timeline-keyframe`,
      ),
    ).toHaveCount(2);
    await ruler.press('Home');
    for (let i = 0; i < 5; i++) await ruler.press('Shift+ArrowRight');
    await expect.poll(async () => (await canvas.screenshot()).equals(originalMiddle)).toBe(true);
    await page.locator('.animation-ik-baking > summary').click();
    await expect(constraint).toBeEnabled();
    await constraint.check();
    await panel.getByRole('button', { name: 'Preview Bake', exact: true }).click();
    await page.locator('#animation-selection').selectOption('walk');
    await expect(panel.getByRole('button', { name: 'Preview Bake', exact: true })).toBeDisabled();
    await expect(constraint).not.toBeChecked();
    await page.reload();
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  });
}
