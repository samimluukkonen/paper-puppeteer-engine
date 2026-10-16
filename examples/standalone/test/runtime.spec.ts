import { resolve, sep } from 'node:path';
import { expect, test } from '@playwright/test';

test('runtime controls demonstrate FIFO, state/action returns, async completion, cancellation and shutdown', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Ready: demo-puppet / idle');
  await page.getByRole('button', { name: 'Walking state', exact: true }).click();
  await expect(page.locator('#lifecycle')).toContainText('walk / started');
  await page.getByRole('button', { name: 'Running state', exact: true }).click();
  await expect(page.locator('#lifecycle')).toContainText('run / started');
  await page.getByRole('button', { name: 'Attack action', exact: true }).click();
  await expect(page.locator('#event')).toContainText('attack: attack-hit');
  await expect(page.locator('#lifecycle')).toContainText('run / started');
  await page.getByRole('button', { name: 'Queue attack + recover', exact: true }).click();
  await expect(page.locator('#event')).toContainText('recover: recovered');
  await expect(page.locator('#lifecycle')).toContainText('recover / completed');
  await page.getByRole('button', { name: 'Await attack', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Async attack: completed');
  await expect(page.locator('#lifecycle')).toContainText('idle / started');
  await page.getByRole('button', { name: 'Await attack', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel wait', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Async attack: cancelled');
  await expect(page.locator('#lifecycle')).toContainText('attack / completed');
  await page.getByRole('button', { name: 'Stop base', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Base stopped');
  await page.getByRole('button', { name: 'Await attack', exact: true }).click();
  await page.getByRole('button', { name: 'Clean up', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Disposed');
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Await attack', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('exported character plays, emits events, switches appearance and cleans up in another app', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Ready: demo-puppet / idle');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Walk', exact: true }).click();
  await expect(page.locator('#event')).toContainText('footstep');
  await page.getByRole('button', { name: 'Sword', exact: true }).click();
  await expect(page.locator('#event')).toContainText('weapon-ready');
  await page.getByRole('button', { name: 'IK reach', exact: true }).click();
  await expect(page.locator('#event')).toContainText('reach: reach-marker');
  await page.getByRole('button', { name: 'Baked reach', exact: true }).click();
  await expect(page.locator('#event')).toContainText('baked: reach-marker');
  await page.getByRole('button', { name: 'Switch skin' }).click();
  await expect(page.locator('#skin')).toHaveText('Skin: helmet-only');
  await page.locator('#skin').click();
  await expect(page.locator('#skin')).toHaveText('Skin: alternate');
  await page.locator('#skin').click();
  await expect(page.locator('#skin')).toHaveText('Skin: default');
  await page.getByRole('button', { name: 'Clean up' }).click();
  await expect(page.getByRole('status')).toHaveText('Disposed');
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Walk', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('cleanup cancels a metadata load before a puppet is created', async ({ page }) => {
  let requested!: () => void;
  let completed!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const routeCompleted = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route('**/character/character.json', async (route) => {
    requested();
    // Hold the metadata response until the test has stopped the scene.
    await page.getByRole('status').filter({ hasText: 'Disposed' }).waitFor();
    await route.abort();
    completed();
  });
  await page.goto('./');
  await requestStarted;
  await page.getByRole('button', { name: 'Clean up' }).click();
  await expect(page.getByRole('status')).toHaveText('Disposed');
  await expect(page.locator('canvas')).toHaveCount(0);
  await routeCompleted;
});

test('exact editor release-workflow export plays baked motion, events and the authored skin', async ({ page }) => {
  const directory = process.env.PPE_WORKFLOW_CHARACTER_DIR;
  test.skip(!directory, 'Set PPE_WORKFLOW_CHARACTER_DIR to the extracted releaseWorkflow ZIP for this local handoff.');
  const root = resolve(directory!);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.route('**/character/**', async (route) => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.split('/character/')[1]!);
    const path = resolve(root, relative);
    expect(path.startsWith(`${root}${sep}`)).toBe(true);
    await route.fulfill({ path });
  });
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Ready: demo-puppet / idle');
  await page.getByRole('button', { name: 'IK reach', exact: true }).click();
  await expect(page.locator('#event')).toContainText('reach: release-cue');
  const canvas = page.locator('canvas');
  const before = await canvas.screenshot();
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
  // The export retains source skins as well as the newly authored one.
  for (let index = 0; index < 4; ++index) {
    await page.getByRole('button', { name: /Switch skin|Skin:/ }).click();
    if ((await page.locator('#skin').textContent()) === 'Skin: release-alternate') break;
  }
  await expect(page.locator('#skin')).toHaveText('Skin: release-alternate');
  const withSkin = await canvas.screenshot();
  await expect.poll(async () => (await canvas.screenshot()).equals(withSkin)).toBe(false);
  await page.getByRole('button', { name: 'Clean up' }).click();
  await expect(page.getByRole('status')).toHaveText('Disposed');
  await expect(canvas).toHaveCount(0);
  expect(errors).toEqual([]);
});
