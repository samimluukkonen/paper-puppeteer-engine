import { expect } from '@playwright/test';
import { test } from './fixtures.js';

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
    await expect(panel.getByRole('button', { name: 'Preview Replacement', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: 'Preview Replacement', exact: true }).click();
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await panel.getByRole('button', { name: 'Revert to Original', exact: true }).click();
    await expect(panel.getByLabel('Artwork changes')).toHaveText('No pending artwork changes');
    await expect(dirty).toHaveText(originalDirty!);
    await expect(validation).toHaveText('Validation: OK');
  });
}
