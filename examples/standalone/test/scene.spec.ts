import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { buildScenePackage, decodePackageZip, encodePackageZip, parseSceneJson } from 'paper-puppeteer-engine/core';

test('exact personal-production scene survives repeated standalone loading, seeking, playback and cleanup', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const artifact = process.env.PPE_PRODUCTION_SCENE_ZIP;
  test.skip(!artifact, 'Opt in with the personalProductionWorkflow scene ZIP.');
  const bytes = await readFile(artifact!);
  const authored = parseSceneJson(new TextDecoder().decode(decodePackageZip(new Uint8Array(bytes)).get('scene.json')));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('scene.html');
  await expect(page.getByRole('status')).toContainText('Ready: standalone-encounter');
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByLabel('Open scene ZIP').setInputFiles({
      name: 'production.scene.zip',
      mimeType: 'application/zip',
      buffer: bytes,
    });
    await expect(page.getByRole('status')).toContainText(`Ready: ${authored.id} / ${authored.actors.length} Actors`);
    await page.getByLabel('Time (ms)').fill('500');
    await expect(page.getByRole('status')).toContainText('paused / 500 ms');
    await expect(page.getByLabel('Scene cues')).toHaveText('');
    const paused = await page.locator('canvas').screenshot();
    await page.getByLabel('Time (ms)').fill('1000');
    expect((await page.locator('canvas').screenshot()).equals(paused)).toBe(false);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByLabel('Scene cues')).toHaveText('production-arrived\n');
    await expect(page.getByRole('status')).toContainText(`completed / ${authored.duration} ms`, {
      timeout: authored.duration + 10_000,
    });
    await expect(page.locator('canvas')).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Clean up', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Disposed');
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('exact editor first-scene ZIP runs in the independent consumer', async ({ page }) => {
  const artifact = process.env.PPE_WORKFLOW_SCENE_ZIP;
  test.skip(!artifact, 'Opt in with the firstScene browser workflow artifact.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('scene.html');
  await expect(page.getByRole('status')).toContainText('Ready: standalone-encounter');
  await page.getByLabel('Open scene ZIP').setInputFiles({
    name: 'first-scene.zip',
    mimeType: 'application/zip',
    buffer: await readFile(artifact!),
  });
  await expect(page.getByRole('status')).toContainText('Ready: first-scene / 2 Actors');
  await page.getByLabel('Time (ms)').fill('2000');
  await expect(page.getByRole('status')).toContainText('paused / 2000 ms');
  await expect(page.getByLabel('Scene cues')).toHaveText('');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('Scene cues')).toContainText('arrived');
  await expect(page.getByRole('status')).toContainText('completed / 5000 ms');
  await page.getByRole('button', { name: 'Clean up', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Disposed');
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

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
