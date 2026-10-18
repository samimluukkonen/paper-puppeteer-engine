import { expect, test } from '@playwright/test';

test('two exported character instances finish three scenes, cancel a walk, then destroy the game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('./choreography.html');
  await expect(page.getByRole('status')).toHaveText('Ready');
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: 'Run scene', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Running');
    await expect(page.locator('#events')).toContainText('a: walk');
    await expect(page.locator('#events')).toContainText('b: walk');
    await expect(page.getByRole('status')).toHaveText('Scene: completed; resources disposed');
    const log = await page.locator('#events').textContent();
    expect(log).toContain('a: event attack-hit');
    expect(log).toContain('b: event recovered');
    expect(log!.indexOf('a: attack')).toBeLessThan(log!.indexOf('b: recover'));
    expect(log!.trim().split('\n').slice(-2).sort()).toEqual(['a: idle', 'b: idle']);
    await expect(page.getByRole('button', { name: 'Run scene', exact: true })).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Run scene', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Running');
  await page.getByRole('button', { name: 'Cancel scene', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Scene: cancelled; resources disposed');
  await page.getByRole('button', { name: 'Run scene', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Running');
  await page.getByRole('button', { name: 'Clean up', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Disposed');
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});
