import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

async function openEditor(page: Page) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        playback: { mode: 'smooth' },
        interpolation: undefined,
        events: [],
        tracks: {
          root: [
            { time: 0, x: 0, rotation: 0 },
            { time: 1000, x: 100, rotation: 1 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
}
const key = (page: Page, time = 0, property = 'x') =>
  page.getByRole('button', { name: `Select root ${property} key at ${time} s`, exact: true });
const rotation = (page: Page) => page.locator('#animation-bone-fields input[data-property="rotation"]');

test('selection inspector and authored marker titles distinguish outgoing and terminal keys', async ({ page }) => {
  await openEditor(page);
  const control = page.locator('#timeline-interpolation');
  await expect(control).toBeDisabled();
  await expect(control).toHaveValue('');
  await expect(control.locator('option')).toHaveText(['—', 'Linear']);
  await expect(key(page)).toHaveAttribute('data-interpolation', 'linear');
  await expect(key(page)).toHaveAttribute(
    'title',
    /root\.x\nTime: 0\.000 s.*\nInterpolation: Linear \(inherited from clip\)/,
  );
  await expect(key(page, 1)).toHaveAttribute('data-interpolation', 'unavailable');
  await expect(key(page, 1)).toHaveAttribute('title', /no outgoing segment/);
  await key(page).click();
  await expect(control).toHaveValue('linear');
  await expect(control).toBeDisabled();
  await expect(page.locator('#timeline-interpolation-help')).toContainText('inherited from the clip');
  await key(page, 0, 'rotation').click({ modifiers: ['ControlOrMeta'] });
  await expect(control).toHaveValue('linear');
  await expect(key(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page, 0, 'rotation')).toHaveAttribute('aria-pressed', 'true');
  await key(page, 1).click({ modifiers: ['ControlOrMeta'] });
  await expect(control).toHaveValue('');
  await expect(page.locator('#timeline-interpolation-help')).toContainText('no outgoing segment');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('interpolation-markers.png') });
});

test('clip declaration UI preserves multi-selection, marker buttons and time through Undo/Redo', async ({ page }) => {
  await openEditor(page);
  await key(page).click();
  await key(page, 0, 'rotation').click({ modifiers: ['ControlOrMeta'] });
  const ruler = page.locator('#timeline-ruler');
  for (let i = 0; i < 5; i++) await ruler.press('Shift+ArrowRight');
  const heldTime = await ruler.getAttribute('aria-valuenow');
  const heldRotation = await rotation(page).inputValue();
  await key(page).evaluate((element) => {
    element.dataset.identityProbe = 'surviving';
  });
  await page.locator('#animation-interpolation').selectOption('linear');
  await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  await expect(ruler).toHaveAttribute('aria-valuenow', heldTime!);
  await expect(rotation(page)).toHaveValue(heldRotation);
  for (const property of ['x', 'rotation'])
    await expect(key(page, 0, property)).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page)).toHaveAttribute('data-primary', 'true');
  await expect(key(page)).toHaveAttribute('data-identity-probe', 'surviving');
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-interpolation')).toHaveValue('');
  await expect(page.locator('#timeline-interpolation')).toHaveValue('linear');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#animation-redo').click();
  await expect(page.locator('#animation-interpolation')).toHaveValue('linear');
  await expect(key(page)).toHaveAttribute('data-interpolation', 'linear');
  await expect(key(page)).toHaveAttribute('data-identity-probe', 'surviving');
  await expect(ruler).toHaveAttribute('aria-valuenow', heldTime!);
  for (const property of ['x', 'rotation'])
    await expect(key(page, 0, property)).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page)).toHaveAttribute('data-primary', 'true');
  await expect(rotation(page)).toHaveValue(heldRotation);
  await page.locator('#animation-interpolation').selectOption('');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('smooth/stepped sample timing uses the existing evaluator and does not change authored interpolation', async ({
  page,
}) => {
  await openEditor(page);
  await key(page, 0, 'rotation').click();
  const ruler = page.locator('#timeline-ruler');
  for (const mode of ['smooth', 'stepped']) {
    await page.locator('#animation-mode').selectOption(mode);
    if (mode === 'stepped') await page.locator('#animation-fps').fill('1');
    if (mode === 'stepped') await page.locator('#animation-fps').press('Tab');
    await ruler.press('Home');
    for (const time of [0, 0.25, 0.5, 0.75, 1]) {
      if (time !== 0) for (let step = 0; step < 25; step++) await ruler.press('ArrowRight');
      expect(Number(await ruler.getAttribute('aria-valuenow'))).toBeCloseTo(time, 8);
      const radians = mode === 'stepped' && time < 1 ? 0 : time;
      expect(Number(await rotation(page).inputValue())).toBeCloseTo((radians * 180) / Math.PI, 2);
      await expect(page.locator('#timeline-interpolation')).toHaveValue('linear');
      await expect(key(page, 0, 'rotation')).toHaveAttribute('data-interpolation', 'linear');
    }
    await ruler.press('Home');
    await page.locator('#play-pause').click();
    await expect(page.locator('#play-pause')).toHaveText('Pause');
    await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).toBeGreaterThan(0.1);
    await page.locator('#play-pause').click();
    if (mode === 'stepped') expect(Number(await rotation(page).inputValue())).toBe(0);
    else expect(Number(await rotation(page).inputValue())).toBeGreaterThan(0);
  }
  await page.setViewportSize({ width: 620, height: 1400 });
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('interpolation-mobile.png') });
});
