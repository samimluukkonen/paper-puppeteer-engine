import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { buildScenePackage, encodePackageZip, parseSceneJson } from 'paper-puppeteer-engine/core';

test('standalone scene page loads authored JSON, then an exported scene ZIP, plays, seeks and disposes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('scene.html');
  await expect(page.getByRole('status')).toContainText('Ready: standalone-encounter / 2 Actors');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('Scene cues')).toContainText('greeting');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const source = parseSceneJson(await readFile(new URL('../public/scene.json', import.meta.url), 'utf8'));
  const fetcher: typeof fetch = async (input) =>
    new Response(
      new Uint8Array(await readFile(new URL(`../public/${new URL(String(input)).pathname.slice(1)}`, import.meta.url))),
    );
  const zip = encodePackageZip(
    await buildScenePackage(source, { baseUrl: 'https://standalone.invalid/scene.json', fetcher }),
  );
  await page
    .getByLabel('Open scene ZIP')
    .setInputFiles({ name: 'encounter.scene.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.getByRole('status')).toContainText('Ready: standalone-encounter / 2 Actors');
  await page.getByLabel('Time (ms)').fill('1500');
  await expect(page.getByRole('status')).toContainText('paused / 1500 ms');
  await expect(page.getByLabel('Scene cues')).toHaveText('');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('Scene cues')).toContainText('greeting');
  await expect(page.getByRole('status')).toContainText('completed / 3000 ms');
  await page.getByRole('button', { name: 'Clean up' }).click();
  await expect(page.getByRole('status')).toHaveText('Disposed');
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});
