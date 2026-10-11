import { expect } from '@playwright/test';
import { animationFileSchema, rigFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

test('authored rig IK drives editor scrubbing and playback while fixed preview remains an explicit override', async ({
  page,
}) => {
  await page.route('**/demo-puppet/rig.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...rigFileSchema.parse(await response.json()),
        ik: [
          {
            name: 'rightArmIK',
            rootBone: 'rightUpperArm',
            middleBone: 'rightForearm',
            endBone: 'rightHand',
            bendDirection: -1,
          },
        ],
      },
    });
  });
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
        ikTracks: {
          rightArmIK: [
            { time: 0, x: 22, y: -42 },
            { time: 500, x: -8, y: -22 },
            { time: 1000, x: -78, y: -32 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const canvas = page.locator('#animation-stage canvas');
  const ruler = page.locator('#timeline-ruler');
  await ruler.press('Home');
  const a = await canvas.screenshot();
  for (let i = 0; i < 5; i++) await ruler.press('Shift+ArrowRight');
  await expect(ruler).toHaveAttribute('aria-valuenow', '0.5');
  const b = await canvas.screenshot();
  expect(b.equals(a)).toBe(false);
  await ruler.press('End');
  const c = await canvas.screenshot();
  expect(c.equals(b)).toBe(false);
  await ruler.press('Home');
  expect((await canvas.screenshot()).equals(a)).toBe(true);
  await page.locator('#animation-ik-preview').check();
  const fixed = await canvas.screenshot();
  await ruler.press('End');
  expect((await canvas.screenshot()).equals(fixed)).toBe(true);
  await page.locator('#animation-ik-preview').uncheck();
  expect((await canvas.screenshot()).equals(c)).toBe(true);
  await page.locator('#animation-facing').selectOption('left');
  expect((await canvas.screenshot()).equals(c)).toBe(false);
  await page.locator('#animation-facing').selectOption('right');
  expect((await canvas.screenshot()).equals(c)).toBe(true);
  await ruler.press('Home');
  await page.locator('#play-pause').click();
  await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).toBeGreaterThan(0.1);
  await page.locator('#play-pause').click();
  expect((await canvas.screenshot()).equals(a)).toBe(false);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
