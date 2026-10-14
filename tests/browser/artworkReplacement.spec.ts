import { expect } from '@playwright/test';
import { rigFileSchema } from '../../src/engine/schemas.js';
import { animationMenuControl, test } from './fixtures.js';

for (const editor of ['rig', 'animation'] as const) {
  test(`${editor} forearm image preview, cancel, apply, invalid import and revert preserve the document`, async ({
    page,
  }) => {
    await page.goto(`${editor}-editor/`);
    const validation = page.locator(editor === 'rig' ? '#validation' : '#animation-status');
    await expect(validation).toHaveText('Validation: OK');
    const panel = page.locator('#artwork-panel');
    await panel.locator('summary').click();
    await panel.getByLabel('Artwork asset', { exact: true }).selectOption('paper-left-forearm');
    await expect(panel).toContainText('Attachment: leftForearm');
    const canvas = page.locator(editor === 'rig' ? '#editor-stage canvas' : '#animation-stage canvas');
    const dirty = page.locator(editor === 'rig' ? '#dirty-status' : '#animation-dirty');
    const originalDirty = await dirty.textContent();
    const original = await canvas.screenshot({ path: test.info().outputPath('original.png') });
    const images = await page.evaluate(() => {
      const sprite = document.createElement('canvas');
      sprite.width = 32;
      sprite.height = 80;
      const context = sprite.getContext('2d')!;
      context.fillStyle = '#ff00ff';
      context.fillRect(6, 2, 20, 76);
      return { png: sprite.toDataURL('image/png').split(',')[1]!, webp: sprite.toDataURL('image/webp').split(',')[1]! };
    });
    const input = panel.getByLabel('Import sprite');
    await input.setInputFiles({
      name: 'forearm.png',
      mimeType: 'image/png',
      buffer: Buffer.from(images.png, 'base64'),
    });
    await expect(panel).toContainText('32 × 80 px');
    await panel.getByLabel('Alignment policy').selectOption('normalized');
    await panel.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
    const replaced = await canvas.screenshot({ path: test.info().outputPath('replacement.png') });
    expect(replaced.equals(original)).toBe(false);
    await expect(dirty).toHaveText(originalDirty!);
    await expect(panel.getByLabel('Artwork changes')).toHaveText('No pending artwork changes');
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await canvas.screenshot()).equals(original)).toBe(true);
    await input.setInputFiles({
      name: 'forearm.png',
      mimeType: 'image/png',
      buffer: Buffer.from(images.png, 'base64'),
    });
    await panel.getByLabel('Alignment policy').selectOption('normalized');
    await expect(panel.getByRole('button', { name: 'Preview Replacement', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
    await panel.getByRole('button', { name: 'Apply Replacement', exact: true }).click();
    await expect(panel.getByLabel('Artwork changes')).toHaveText('1 pending artwork change(s)');
    await expect(dirty).toHaveText(originalDirty!);
    expect((await canvas.screenshot()).equals(original)).toBe(false);
    const url = page.url();
    await Promise.all([
      page.waitForEvent('dialog').then(async (dialog) => {
        expect(dialog.type()).toBe('beforeunload');
        await dialog.dismiss();
      }),
      page.getByRole('link', { name: 'Engine demo' }).click(),
    ]);
    expect(page.url()).toBe(url);
    await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('corrupt image') });
    await expect(panel).toContainText('not a valid PNG or WebP');
    await expect(panel.getByLabel('Artwork changes')).toHaveText('1 pending artwork change(s)');
    if (editor === 'animation') {
      await page.locator('#animation-selection').selectOption('walk');
      await expect(validation).toHaveText('Validation: OK');
      await expect(dirty).toHaveText(originalDirty!);
      await page.locator('#play-pause').click();
      await expect
        .poll(async () =>
          Number(await page.getByRole('slider', { name: 'Animation time' }).getAttribute('aria-valuenow')),
        )
        .toBeGreaterThan(0.05);
      await page.locator('#play-pause').click();
      await page.locator('#animation-selection').selectOption('idle');
    } else {
      await page.getByRole('treeitem', { name: 'leftForearm', exact: true }).click();
      await expect(validation).toHaveText('Validation: OK');
    }
    await input.setInputFiles({
      name: 'forearm.webp',
      mimeType: 'image/webp',
      buffer: Buffer.from(images.webp, 'base64'),
    });
    await panel.getByLabel('Alignment policy').selectOption('normalized');
    await expect(panel.getByRole('button', { name: 'Preview Replacement', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await panel.getByRole('button', { name: 'Revert to Original', exact: true }).click();
    await expect(panel.getByLabel('Artwork changes')).toHaveText('No pending artwork changes');
    await expect(dirty).toHaveText(originalDirty!);
    await expect(validation).toHaveText('Validation: OK');
  });
}

test('shared versus individual replacement, dimension policies and artwork history refresh skins, IK and onion previews', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.route('**/demo-puppet/rig.json', async (route) => {
    const response = await route.fetch();
    const rig = rigFileSchema.parse(await response.json());
    await route.fulfill({
      json: {
        ...rig,
        attachments: rig.attachments!.map((entry) =>
          entry.id === 'rightForearmDefault' ? { ...entry, texture: 'paper-left-forearm' } : entry,
        ),
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const panel = page.locator('#artwork-panel');
  await panel.locator('summary').click();
  await panel.getByLabel('Artwork asset', { exact: true }).selectOption('paper-left-forearm');
  await expect(panel).toContainText('Attachment: rightForearmDefault');
  const canvas = page.locator('#animation-stage canvas');
  const original = await canvas.screenshot();
  const size = await panel.getByAltText('Original artwork').evaluate((element) => ({
    width: (element as HTMLImageElement).naturalWidth,
    height: (element as HTMLImageElement).naturalHeight,
  }));
  const png = async (width: number, height: number, color: string) =>
    Buffer.from(
      await page.evaluate(
        ({ width, height, color }) => {
          const image = document.createElement('canvas');
          image.width = width;
          image.height = height;
          const context = image.getContext('2d')!;
          context.fillStyle = color;
          context.fillRect(0, 0, width, height);
          return image.toDataURL('image/png').split(',')[1]!;
        },
        { width, height, color },
      ),
      'base64',
    );
  await panel.getByLabel('Import sprite').setInputFiles({
    name: 'forearm-v2.png',
    mimeType: 'image/png',
    buffer: await png(size.width, size.height, '#ff00ff'),
  });
  await expect(panel.getByLabel('Alignment policy')).toHaveValue('normalized');
  await panel.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply Replacement', exact: true }).click();
  const shared = await canvas.screenshot();
  expect(shared.equals(original)).toBe(false);
  await panel.getByLabel('Replacement scope').selectOption('attachment:leftForearmDefault');
  await panel.getByLabel('Import sprite').setInputFiles({
    name: 'forearm-v3.png',
    mimeType: 'image/png',
    buffer: await png(size.width * 2, size.height * 2, '#00ffff'),
  });
  await expect(panel).toContainText(`Old size: ${size.width} × ${size.height}`);
  await expect(panel).toContainText(`New size: ${size.width * 2} × ${size.height * 2}`);
  await expect(panel.getByRole('button', { name: 'Preview Replacement', exact: true })).toBeDisabled();
  await panel.getByLabel('Alignment policy').selectOption('pixels');
  await panel.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
  const pixel = await canvas.screenshot();
  await panel.getByLabel('Alignment policy').selectOption('normalized');
  await expect(panel.getByRole('button', { name: 'Apply Replacement', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
  expect((await canvas.screenshot()).equals(pixel)).toBe(false);
  await panel.getByLabel('Alignment policy').selectOption('pixels');
  await panel.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply Replacement', exact: true }).click();
  const individual = await canvas.screenshot({ path: test.info().outputPath('individual-pixel-pivot.png') });
  expect(individual.equals(shared)).toBe(false);
  await expect(panel.getByLabel('Artwork changes')).toHaveText('2 pending artwork change(s)');
  await panel.getByRole('button', { name: 'Undo Artwork', exact: true }).click();
  expect((await canvas.screenshot()).equals(shared)).toBe(true);
  await panel.getByRole('button', { name: 'Redo Artwork', exact: true }).click();
  expect((await canvas.screenshot()).equals(individual)).toBe(true);
  const attachments = page.locator('#attachment-panel');
  await attachments.locator(':scope > summary').click();
  await attachments.getByLabel('Active skin', { exact: true }).selectOption('alternate');
  await attachments.getByLabel('Active skin', { exact: true }).selectOption('default');
  expect((await canvas.screenshot()).equals(individual)).toBe(true);
  await page.getByRole('checkbox', { name: 'Onion Skinning', exact: true }).check();
  await (await animationMenuControl(page, '#animation-ik-preview')).check();
  await page.locator('#animation-facing').selectOption('left');
  await page.locator('#animation-selection').selectOption('walk');
  await page.locator('#play-pause').click();
  await expect
    .poll(async () => Number(await page.getByRole('slider', { name: 'Animation time' }).getAttribute('aria-valuenow')))
    .toBeGreaterThan(0.05);
  await page.locator('#play-pause').click();
  await page.getByRole('checkbox', { name: 'Onion Skinning', exact: true }).uncheck();
  await panel.getByRole('button', { name: 'Revert to Original', exact: true }).click();
  await panel.getByLabel('Replacement scope').selectOption('shared');
  await panel.getByRole('button', { name: 'Revert to Original', exact: true }).click();
  await expect(panel.getByLabel('Artwork changes')).toHaveText('No pending artwork changes');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
});
