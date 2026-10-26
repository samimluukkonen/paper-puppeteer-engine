import { readFile } from 'node:fs/promises';
import { expect, type Frame, type Page } from '@playwright/test';
import { importProjectPackage } from '../../src/devtools/project/projectPackage.js';
import { decodePackageZip, encodePackageZip } from '../../src/engine/packageZip.js';
import { test, waitForPreviewPaint, inspectorControl } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

async function exported(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  return readFile(await (await waiting).path(), 'utf8');
}

async function backgroundBytes(page: Page, format = 'image/png') {
  return Buffer.from(
    await page.evaluate(async (format) => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 400;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#174bc7';
      context.fillRect(0, 0, 600, 400);
      context.fillStyle = '#409020';
      context.fillRect(0, 300, 600, 100);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), format));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }, format),
  );
}

async function bluePixels(page: Page | Frame) {
  const png = await page.locator('#animation-stage canvas').screenshot();
  return page.evaluate(
    async (data) => {
      const bitmap = await createImageBitmap(await (await fetch(data)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i]! < 70 && pixels[i + 1]! < 130 && pixels[i + 2]! > 150) count++;
      }
      bitmap.close();
      return count;
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
}

test('environment imports PNG/WebP, aligns a static world background, preserves animations and survives desktop navigation', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const panel = page.locator('.environment-preview-panel');
  await expect(panel).toBeHidden();
  await page.locator('#animation-selection').selectOption('walk');
  const original = await exported(page);
  await inspectorControl(page, '.environment-preview-panel');
  await panel
    .getByLabel('Import environment image')
    .setInputFiles({ name: 'forest.png', mimeType: 'image/png', buffer: await backgroundBytes(page) });
  await expect(panel.getByRole('status')).toContainText('forest.png imported');
  const reference = await panel.getByLabel('Background', { exact: true }).inputValue();
  expect(reference).toMatch(/^\.\.\/images\/.*\.png$/);
  await panel.getByLabel('Background X', { exact: true }).fill('380');
  await panel.getByLabel('Background Y', { exact: true }).fill('435');
  await panel.getByRole('button', { name: 'Apply background transform', exact: true }).click();
  const toggle = page
    .locator('.animation-preview-options')
    .getByRole('checkbox', { name: 'Environment Preview', exact: true });
  const ordinaryBlue = await bluePixels(page);
  await toggle.check();
  await expect(panel.getByRole('checkbox', { name: 'Environment Preview', exact: true })).toBeChecked();
  await expect.poll(() => bluePixels(page)).toBeGreaterThan(1000);
  await toggle.uncheck();
  await expect.poll(() => bluePixels(page)).toBe(ordinaryBlue);
  await toggle.check();
  await panel.getByRole('checkbox', { name: 'Show background', exact: true }).uncheck();
  await expect.poll(() => bluePixels(page)).toBe(ordinaryBlue);
  await panel.getByRole('checkbox', { name: 'Show background', exact: true }).check();
  await panel.getByRole('checkbox', { name: 'Show Ground Reference', exact: true }).check();
  await panel.getByRole('button', { name: 'Align image bottom to ground', exact: true }).click();
  await expect(panel.getByLabel('Background Y', { exact: true })).toHaveValue('235');
  await panel.getByLabel('Scale', { exact: true }).fill('1.5');
  await panel.getByRole('button', { name: 'Apply background transform', exact: true }).click();
  await panel.getByRole('button', { name: 'Align image bottom to ground', exact: true }).click();
  await expect(panel.getByLabel('Background Y', { exact: true })).toHaveValue('135');
  const canvas = page.locator('#animation-stage canvas');
  await waitForPreviewPaint(page);
  const beforeNavigation = await canvas.screenshot();
  await page.screenshot({ path: test.info().outputPath('animation-environment-preview.png') });
  await canvas.hover();
  await page.mouse.wheel(0, -120);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await waitForPreviewPaint(page);
  expect((await canvas.screenshot()).equals(beforeNavigation)).toBe(false);
  await expect(panel.getByLabel('Background X', { exact: true })).toHaveValue('380');
  await expect(panel.getByLabel('Background Y', { exact: true })).toHaveValue('135');
  await page.setViewportSize({ width: 1800, height: 1400 });
  await expect(panel.getByLabel('Background Y', { exact: true })).toHaveValue('135');
  await page.locator('#animation-facing').selectOption('left');
  await page.locator('#play-pause').click();
  await expect
    .poll(async () => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow')))
    .toBeGreaterThan(0.1);
  await page.locator('#play-pause').click();
  expect(await exported(page)).toBe(original);
  await page.locator('#animation-selection').selectOption('idle');
  const idle = await exported(page);
  await expect(panel.getByLabel('Background', { exact: true })).toHaveValue(reference);
  await toggle.uncheck();
  expect(await exported(page)).toBe(idle);
  await page.locator('#animation-selection').selectOption('walk');
  expect(await exported(page)).toBe(original);
  await panel
    .getByLabel('Import environment image')
    .setInputFiles({ name: 'hills.webp', mimeType: 'image/webp', buffer: await backgroundBytes(page, 'image/webp') });
  await expect(panel.getByRole('status')).toContainText('hills.webp imported');
  await expect(panel.getByLabel('Background', { exact: true })).toHaveValue(/\.webp$/);
  await panel.getByLabel('Background', { exact: true }).selectOption(reference);
  await expect(panel.getByLabel('Background', { exact: true })).toHaveValue(reference);
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(panel.getByLabel('Background', { exact: true })).toHaveValue(reference);
  await panel.getByRole('button', { name: 'Reset background transform', exact: true }).click();
  await expect(panel.getByLabel('Scale', { exact: true })).toHaveValue('1');
  await panel.getByRole('button', { name: 'Clear background', exact: true }).click();
  await expect(panel.getByLabel('Background', { exact: true })).toHaveValue('');
  await panel.getByRole('button', { name: 'Reset Environment', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  expect(await exported(page)).toBe(original);
  await page.reload();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(toggle).not.toBeChecked();
  await expect(panel).toBeHidden();
});

test('animation environment imports share project assets and survive project packaging without authoring a scene', async ({
  page,
}) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name').fill('Environment previews');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const files = new Map([
    [
      'character.json',
      json({
        version: 1,
        id: 'hero',
        rig: 'rig.json',
        textures: { paper: 'paper.png' },
        skins: { default: 'skin.json' },
        defaultSkin: 'default',
        animations: ['idle.json'],
      }),
    ],
    ['rig.json', json({ version: 1, root: 'root', bones: [{ id: 'root', sprite: { texture: 'paper' } }] })],
    ['skin.json', json({ version: 1, name: 'default', slots: {} })],
    ['idle.json', json({ version: 1, name: 'idle', duration: 1000, loop: true, tracks: {} })],
    ['paper.png', new Uint8Array(await backgroundBytes(page))],
  ]);
  await page
    .getByLabel('Import Character ZIP', { exact: true })
    .setInputFiles({ name: 'hero.zip', mimeType: 'application/zip', buffer: Buffer.from(encodePackageZip(files)) });
  await expect(page.getByRole('status')).toContainText('Character registered.');
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  const element = await page.locator('iframe:visible').elementHandle();
  const frame = await element.contentFrame();
  if (!frame) throw new Error('Missing project editor frame.');
  await expect(frame.locator('#validation')).toHaveText('Validation: OK');
  await frame.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  const panel = frame.locator('.environment-preview-panel');
  await inspectorControl(frame, '.environment-preview-panel');
  await panel.getByRole('button', { name: 'Load project character images', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Project images are available');
  await panel.getByLabel('Background', { exact: true }).selectOption('project:hero:paper.png');
  await expect(panel.getByLabel('Background', { exact: true })).toHaveValue(/\.png$/);
  await panel
    .getByLabel('Import environment image')
    .setInputFiles({ name: 'forest.webp', mimeType: 'image/webp', buffer: await backgroundBytes(page, 'image/webp') });
  await expect(panel.getByRole('status')).toContainText('forest.webp imported');
  const reference = await panel.getByLabel('Background', { exact: true }).inputValue();
  await panel.getByRole('checkbox', { name: 'Environment Preview', exact: true }).check();
  await panel.getByLabel('Background X', { exact: true }).fill('380');
  await panel.getByLabel('Background Y', { exact: true }).fill('435');
  await panel.getByRole('button', { name: 'Apply background transform', exact: true }).click();
  await panel.getByRole('checkbox', { name: 'Show Ground Reference', exact: true }).check();
  await panel.locator('.environment-camera-panel summary').click();
  await panel.getByLabel('Preview camera mode').selectOption('follow');
  const motion = frame.locator('.motion-preview-panel');
  await inspectorControl(frame, '.motion-preview-panel');
  await motion.getByRole('button', { name: 'Add position point', exact: true }).click();
  await motion.getByLabel('Offset X', { exact: true }).fill('45');
  await motion.getByRole('button', { name: 'Apply point 1', exact: true }).click();
  await motion.getByRole('checkbox', { name: 'Use Preview-Only Displacement', exact: true }).check();
  await frame.locator('#preview-loop').click();
  await expect(frame.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(frame.locator('#animation-undo')).toBeDisabled();
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await page.getByRole('tab', { name: 'Local draft', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await recovery.getByRole('button', { name: 'Recover Draft', exact: true }).click();
  await expect(recovery).not.toBeVisible();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const archive = decodePackageZip(new Uint8Array(await readFile(await (await waiting).path())));
  const workspace = await importProjectPackage(archive);
  expect(workspace.definition.scenes).toHaveLength(0);
  expect(workspace.scenes.images.entries).toHaveLength(2);
  expect(workspace.scenes.images.has(reference)).toBe(true);
  expect(workspace.animationPreviewPreferences('hero')).toMatchObject({
    environment: { enabled: true, image: reference, x: 380, y: 435 },
    camera: { mode: 'follow' },
    ground: { enabled: true },
    animations: {
      idle: { loop: true, motion: { enabled: true, positionKeys: [{ time: 0, offsetX: 45, offsetY: 0 }] } },
    },
  });
  const clip = workspace.captureCharacter('hero').animations[0]!;
  expect(clip.tracks).toEqual({});
  expect(JSON.stringify(clip)).not.toContain('environment');
  // Re-import the actual downloaded ZIP and verify restored owners through the public controls.
  await page.getByLabel('Import Project', { exact: true }).setInputFiles({
    name: 'environment.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(encodePackageZip(archive)),
  });
  await expect(page.getByText('Project metadata: Exported', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  const restoredFrame = await (await page.locator('iframe:visible').elementHandle())?.contentFrame();
  if (!restoredFrame) throw new Error('Missing restored editor frame.');
  await expect(restoredFrame.locator('#validation')).toHaveText('Validation: OK');
  await restoredFrame.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  const restoredPanel = restoredFrame.locator('.environment-preview-panel');
  await expect(restoredPanel).toBeHidden();
  await inspectorControl(restoredFrame, '.environment-preview-panel');
  await expect(restoredPanel.getByLabel('Background', { exact: true })).toHaveValue(reference);
  await expect(restoredPanel.getByLabel('Background X', { exact: true })).toHaveValue('380');
  await expect(restoredPanel.getByRole('checkbox', { name: 'Show Ground Reference', exact: true })).toBeChecked();
  await restoredPanel.locator('.environment-camera-panel summary').click();
  await expect(restoredPanel.getByLabel('Preview camera mode')).toHaveValue('follow');
  await inspectorControl(restoredFrame, '.motion-preview-panel');
  await expect(restoredFrame.locator('.motion-preview-panel').getByLabel('Offset X', { exact: true })).toHaveValue(
    '45',
  );
  await expect(restoredFrame.locator('#preview-loop')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => bluePixels(restoredFrame)).toBeGreaterThan(1000);
  await expect(restoredFrame.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('standalone preview-only edits and artwork recover after refresh without authored animation changes', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('walk');
  const original = await exported(page);
  const panel = page.locator('.environment-preview-panel');
  await inspectorControl(page, '.environment-preview-panel');
  await panel.getByLabel('Import environment image').setInputFiles({
    name: 'standalone-floor.png',
    mimeType: 'image/png',
    buffer: await backgroundBytes(page),
  });
  await expect(panel.getByRole('status')).toContainText('imported');
  const reference = await panel.getByLabel('Background', { exact: true }).inputValue();
  await panel.getByRole('checkbox', { name: 'Environment Preview', exact: true }).check();
  await panel.getByLabel('Background X', { exact: true }).fill('380');
  await panel.getByLabel('Background Y', { exact: true }).fill('435');
  await panel.getByRole('button', { name: 'Apply background transform', exact: true }).click();
  const motion = page.locator('.motion-preview-panel');
  await inspectorControl(page, '.motion-preview-panel');
  await motion.getByRole('button', { name: 'Add position point', exact: true }).click();
  await motion.getByLabel('Offset Y', { exact: true }).fill('-70');
  await motion.getByRole('button', { name: 'Apply point 1', exact: true }).click();
  await motion.getByRole('checkbox', { name: 'Use Preview-Only Displacement', exact: true }).check();
  expect(await exported(page)).toBe(original);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.getByRole('tab', { name: 'Local draft', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  await page.reload();
  await page
    .getByRole('dialog', { name: 'Recover unsaved work?', exact: true })
    .getByRole('button', { name: 'Recover Draft', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Rig Editor', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  const frame = await (await page.locator('iframe:visible').elementHandle())?.contentFrame();
  if (!frame) throw new Error('Missing recovered character frame.');
  await expect(frame.locator('#validation')).toHaveText('Validation: OK');
  await frame.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await frame.locator('#animation-selection').selectOption('walk');
  const restored = frame.locator('.environment-preview-panel');
  await inspectorControl(frame, '.environment-preview-panel');
  await expect(restored.getByLabel('Background', { exact: true })).toHaveValue(reference);
  await expect(restored.getByRole('checkbox', { name: 'Environment Preview', exact: true })).toBeChecked();
  await inspectorControl(frame, '.motion-preview-panel');
  await expect(frame.locator('.motion-preview-panel').getByLabel('Offset Y', { exact: true })).toHaveValue('-70');
  await expect.poll(() => bluePixels(frame)).toBeGreaterThan(1000);
  await expect(frame.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
