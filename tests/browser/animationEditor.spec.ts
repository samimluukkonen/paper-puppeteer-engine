import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';

async function openEditor(page: Page): Promise<void> {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(page.locator('#animation-stage canvas')).toBeVisible();
}

test('editor routes and the demo remain linked under the deployment base', async ({ page, baseURL }) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page).toHaveURL(new URL('animation-editor/', baseURL!).href);
  await expect(page.locator('#character-status')).toHaveText('Character: demo-puppet');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('treeitem', { name: 'head', exact: true }).click();
  const x = page.locator('#inspector input[data-scope="bone"][data-field="x"]');
  await x.fill('12');
  await x.press('Tab');
  await page.locator('#undo').click();
  await expect(x).toHaveValue('0');
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await page.getByRole('link', { name: 'Engine demo' }).click();
  await expect(page.locator('#status-text')).toContainText('Current: idle');
});

test('ruler, current time, selection and scrubbed artwork update without dirtying', async ({ page }) => {
  await openEditor(page);
  await page.screenshot({ path: test.info().outputPath('animation-editor-desktop.png'), fullPage: true });
  const timeline = page.getByRole('slider', { name: 'Animation time' });
  await expect(page.locator('#current-time')).toHaveText('0.000 / 1.800 s');
  await expect(page.locator('.timeline-tick.major').first()).toBeVisible();
  await expect(page.locator('#timeline-playhead')).toBeVisible();
  await page.locator('#animation-selection').selectOption('walk');
  const duration = Number(await timeline.getAttribute('aria-valuemax'));
  const canvas = page.locator('#animation-stage canvas');
  const start = await canvas.screenshot();
  const box = await timeline.boundingBox();
  if (!box) throw new Error('Missing timeline bounds.');
  for (const fraction of [0.01, 0.5, 0.99]) {
    await page.mouse.click(box.x + box.width * fraction, box.y + 50);
    expect(Number(await timeline.getAttribute('aria-valuenow'))).toBeCloseTo(duration * fraction, 2);
  }
  await page.mouse.click(box.x + box.width * 0.25, box.y + 50);
  await expect.poll(async () => (await canvas.screenshot()).equals(start)).toBe(false);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#reset-time').click();
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
  await page.locator('#animation-selection').selectOption('idle');
  await expect(page.locator('#current-time')).toHaveText('0.000 / 1.800 s');
});

test('captured pointer scrubs outside both edges, release ends drag, keyboard and resize preserve time', async ({
  page,
}) => {
  await openEditor(page);
  const timeline = page.getByRole('slider', { name: 'Animation time' });
  const box = await timeline.boundingBox();
  if (!box) throw new Error('Missing timeline bounds.');
  await page.mouse.move(box.x + box.width / 2, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x - 15, box.y + 150, { steps: 4 });
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');
  await page.mouse.move(box.x + box.width + 15, box.y + 150, { steps: 8 });
  await expect(timeline).toHaveAttribute('aria-valuenow', '1.8');
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, box.y + 50);
  await expect(timeline).toHaveAttribute('aria-valuenow', '1.8');
  await timeline.press('Home');
  await timeline.press('ArrowRight');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0.01');
  await timeline.press('End');
  await page.setViewportSize({ width: 620, height: 1100 });
  await expect(timeline).toHaveAttribute('aria-valuenow', '1.8');
  const resized = await timeline.boundingBox();
  if (!resized) throw new Error('Missing resized timeline.');
  const playhead = await page.locator('#timeline-playhead').boundingBox();
  expect(playhead!.x).toBeCloseTo(resized.x + resized.width, 0);
  await page.screenshot({ path: test.info().outputPath('animation-editor-narrow.png'), fullPage: true });
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('no animations and no selection show safe empty timelines', async ({ page }) => {
  await openEditor(page);
  await page.locator('#animation-selection').selectOption('');
  await expect(page.locator('#animation-status')).toHaveText('No animation selected.');
  await expect(page.locator('#current-time')).toHaveText('0.000 / 0.000 s');
  await page.route('**/characters/demo-puppet/character.json', async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    await route.fulfill({ json: { ...manifest, animations: [] } });
  });
  await page.reload();
  await expect(page.locator('#animation-status')).toHaveText('This character has no animations.');
  await expect(page.locator('#animation-stage canvas')).toBeVisible();
  await expect(page.locator('#animation-selection')).toBeDisabled();
  await expect(page.locator('#timeline')).toHaveAttribute('aria-disabled', 'true');
});

test('invalid zero-duration data reports shared validation errors and survives resize', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    const animation = await response.json();
    await route.fulfill({ json: { ...animation, duration: 0 } });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toContainText('Animation duration must be greater than zero');
  await page.setViewportSize({ width: 620, height: 1100 });
  await expect(page.locator('#animation-status')).toContainText('Animation duration must be greater than zero');
  await expect(page.locator('#timeline')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#timeline')).toHaveAttribute('aria-disabled', 'true');
});

test('stepped animation metadata and held preview frames use the existing runtime mode', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    const animation = await response.json();
    await route.fulfill({ json: { ...animation, playback: { mode: 'stepped', fps: 10 } } });
  });
  await openEditor(page);
  await expect(page.locator('#animation-metadata')).toContainText('Mode: stepped · FPS: 10');
  const timeline = page.locator('#timeline');
  const canvas = page.locator('#animation-stage canvas');
  await timeline.press('Home');
  await timeline.press('ArrowRight');
  const frame = await canvas.screenshot();
  await timeline.press('ArrowRight');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0.02');
  expect((await canvas.screenshot()).equals(frame)).toBe(true);
});
