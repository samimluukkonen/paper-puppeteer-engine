import { expect, type Frame, type Page } from '@playwright/test';
import { inspectorControl, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

async function editor(page: Page): Promise<Frame> {
  const element = await page.locator('iframe:visible').elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error('Missing project renderer.');
  await expect(frame.locator('#validation')).toHaveText('Validation: OK');
  return frame;
}

test('project renderer eviction preserves drafts, animation and rig history when a character is reopened', async ({
  page,
}) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'New Project', exact: true });
  await project.getByLabel('Project name').fill('Renderer retention');
  await project.getByRole('button', { name: 'Create Project', exact: true }).click();
  for (const name of ['Hero', 'Friend', 'Villain']) {
    await page.getByRole('button', { name: '+ New Character', exact: true }).click();
    const character = page.getByRole('dialog', { name: 'New Character', exact: true });
    await character.getByLabel('Character name').fill(name);
    await character.getByRole('button', { name: 'Create Character', exact: true }).click();
    await expect(character).not.toBeVisible();
  }
  const open = async (name: string) => {
    await page
      .locator('.project-assets li')
      .filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) })
      .getByRole('button', { name: 'Rig Editor', exact: true })
      .click();
    return editor(page);
  };
  const hero = await open('Hero');
  const oldToken = new URL(hero.url()).searchParams.get('projectSession')!;
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ff00ff';
    context.fillRect(0, 0, 24, 24);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  const artwork = await inspectorControl(hero, '#editor-app #artwork-panel');
  await artwork.getByLabel('Import new artwork', { exact: true }).setInputFiles({
    name: 'body.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(artwork).toContainText('Artwork added to the library.');
  await (await inspectorControl(hero, '#hierarchy')).getByRole('treeitem', { name: 'root', exact: true }).click();
  await (await inspectorControl(hero, '#editor-app input[aria-label="New slot ID"]')).fill('body');
  await hero.getByRole('button', { name: '+ Add Slot', exact: true }).click();
  const attachments = await inspectorControl(hero, '#editor-app #attachment-panel');
  await attachments.getByLabel('Attachment ID', { exact: true }).fill('body-art');
  await attachments.getByRole('button', { name: 'Create attachment', exact: true }).click();
  await attachments.getByLabel('Assigned attachment', { exact: true }).selectOption('body-art');
  await (await inspectorControl(hero, '#hierarchy')).getByRole('treeitem', { name: 'root', exact: true }).click();
  const x = await inspectorControl(hero, '#inspector [data-scope=bone][data-field=x]');
  await x.fill('42');
  await x.blur();
  await hero.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await hero.getByRole('button', { name: '+ New Animation', exact: true }).click();
  const animation = hero.getByRole('dialog', { name: 'Create new animation', exact: true });
  await animation.getByLabel('Animation name / ID').fill('draft-wave');
  await animation.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await hero.getByRole('button', { name: '← Project', exact: true }).click();
  // Both other characters force Hero's renderer out of the two-host cache.
  for (const name of ['Friend', 'Villain']) {
    const frame = await open(name);
    await frame.getByRole('button', { name: '← Project', exact: true }).click();
  }
  await expect(page.locator('iframe')).toHaveCount(2);
  expect(await page.evaluate((token) => !!window.paperProjectEditor?.(token), oldToken)).toBe(false);
  const reopened = await open('Hero');
  const token = new URL(reopened.url()).searchParams.get('projectSession')!;
  expect(token).not.toBe(oldToken);
  const root = (await inspectorControl(reopened, '#hierarchy')).getByRole('treeitem', { name: 'root', exact: true });
  if ((await root.getAttribute('aria-selected')) !== 'true') await root.click();
  await expect(await inspectorControl(reopened, '#inspector [data-scope=bone][data-field=x]')).toHaveValue('42');
  expect(
    await page.evaluate((token) => {
      const context = window.paperProjectEditor?.(token);
      const document = context?.kind === 'character' ? context.characterDocuments : undefined;
      return {
        clips: document?.animation.animationIds,
        undo: document?.rig.undo(),
        x: document?.rig.workingCopy.bones[0]?.x ?? 0,
        artwork: document?.artwork.appliedReplacements().map((entry) => entry.assetKey),
        attachment: document?.rig.resolvedAttachment('body'),
      };
    }, token),
  ).toEqual({ clips: ['draft-wave'], undo: true, x: 0, artwork: ['body'], attachment: 'body-art' });
  await reopened.getByRole('button', { name: '← Project', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.project\.zip$/);
});
