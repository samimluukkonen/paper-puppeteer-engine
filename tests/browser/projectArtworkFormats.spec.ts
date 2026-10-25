import { expect, type Frame, type Page } from '@playwright/test';
import { encodePackageZip } from '../../src/engine/packageZip.js';
import { inspectorControl, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

async function createProject(page: Page): Promise<void> {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
  await dialog.getByLabel('Project name').fill('Artwork formats');
  await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
  const image = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'red';
    context.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/webp'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const json = (data: unknown) => new TextEncoder().encode(JSON.stringify(data));
  const files = new Map([
    [
      'character.json',
      json({
        version: 1,
        id: 'webp-hero',
        rig: 'rig.json',
        skins: { default: 'skin.json' },
        defaultSkin: 'default',
        animations: [],
        textures: { body: 'body.webp' },
      }),
    ],
    ['rig.json', json({ version: 1, root: 'root', bones: [{ id: 'root', sprite: { texture: 'body' } }] })],
    ['skin.json', json({ version: 1, name: 'default', slots: {} })],
    ['body.webp', new Uint8Array(image)],
  ]);
  await page.getByLabel('Import Character ZIP', { exact: true }).setInputFiles({
    name: 'webp.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(encodePackageZip(files)),
  });
  await expect(page.getByRole('status')).toContainText('Character registered.');
}

async function editor(page: Page): Promise<Frame> {
  const element = await page.locator('iframe:visible').elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error('Missing project editor frame.');
  return frame;
}

test('static WebP opens in rig, animation and scene editors and survives project export', async ({ page }) => {
  await createProject(page);
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  const character = await editor(page);
  await expect(character.locator('#validation')).toHaveText('Validation: OK');
  await character.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(character.locator('#character-status')).toContainText('webp-hero');
  await character.getByRole('button', { name: '← Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await dialog.getByLabel('Scene name').fill('WebP scene');
  await dialog.getByRole('button', { name: 'Create Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const scene = await editor(page);
  await (await inspectorControl(scene, '[data-guide-id="scene-add-actor"]')).click();
  await scene
    .getByRole('dialog', { name: 'Add Actor', exact: true })
    .getByRole('button', { name: 'Add actor', exact: true })
    .click();
  await expect(scene.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(scene.locator('.scene-preview-error')).toHaveCount(0);
  await scene.getByRole('button', { name: '← Project', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.project\.zip$/);
});

test('a failed character load permits project export and a fresh editor retry', async ({ page }) => {
  await createProject(page);
  await page.addInitScript(() => {
    // Fail one pre-decode header read in the child editor, retaining the valid source package.
    // oxlint-disable-next-line typescript/unbound-method -- The original browser method is called with its explicit Blob receiver below.
    const slice = Blob.prototype.slice;
    Blob.prototype.slice = function (start, end, type) {
      if (this.type === 'image/webp' && end === 30 && !sessionStorage.getItem('test:failed-artwork')) {
        sessionStorage.setItem('test:failed-artwork', 'true');
        return new Blob(['invalid image header']);
      }
      return slice.call(this, start, end, type);
    };
  });
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  const failed = await editor(page);
  await expect(failed.locator('#inspector')).toContainText('Character load failed');
  await failed.getByRole('button', { name: '← Project', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  await download;
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  await expect((await editor(page)).locator('#validation')).toHaveText('Validation: OK');
});
