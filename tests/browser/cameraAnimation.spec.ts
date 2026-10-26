import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../../src/engine/ScenePackage.js';
import { sceneInspectorGroup, test, waitForPreviewPaint } from './fixtures.js';

test.use({ actionTimeout: 15000 });

test('camera keys, curves, timeline dragging, deterministic scrubbing, independent navigation and portable reload', async ({
  page,
}) => {
  await page.goto('scene-editor/');
  const source = {
    version: 2,
    id: 'camera-keys',
    name: 'Camera animation',
    duration: 6000,
    actors: ['a', 'b'].map((id, index) => ({
      id,
      character: { manifest: '../characters/demo-puppet/character.json' },
      position: { x: index * 180 - 90, y: 0 },
    })),
    actions: [{ id: 'move', actorId: 'a', type: 'move', time: 0, duration: 6000, destination: { x: 200, y: 60 } }],
  };
  await page
    .getByLabel('Open scene JSON')
    .setInputFiles({ name: 'camera.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await sceneInspectorGroup(page, 'Camera');
  await page.locator('.scene-camera > summary').click();
  const timeline = page.locator('.scene-timeline-toolbar');
  const inspector = page.locator('.scene-camera');
  const time = page.getByLabel('Playhead (s)', { exact: true });
  await timeline.getByRole('button', { name: 'Set Camera Key', exact: true }).click();
  await expect(page.getByLabel('Camera Key Edit mode', { exact: true })).toBeChecked();
  await time.fill('3');
  await inspector.getByLabel('Center X', { exact: true }).fill('180');
  await inspector.getByLabel('Center Y', { exact: true }).fill('60');
  await inspector.getByLabel('Camera zoom', { exact: true }).fill('1.5');
  await inspector.getByRole('button', { name: 'Apply camera key', exact: true }).click();
  await time.fill('5');
  await inspector.getByLabel('Camera zoom', { exact: true }).fill('2');
  await inspector.getByRole('button', { name: 'Apply camera key', exact: true }).click();
  const keys = page.getByLabel('Camera x keys', { exact: true });
  await expect(keys.getByRole('button')).toHaveCount(3);
  await keys.getByRole('button', { name: 'Camera x key at 0 s', exact: true }).click();
  await expect(inspector.locator('.scene-camera-key-inspector')).not.toHaveAttribute('open');
  await inspector.locator('.scene-camera-key-inspector > summary').click();
  await page.getByLabel('Camera key interpolation', { exact: true }).selectOption('smooth');
  await expect(page.getByLabel('Camera Bézier 1 X', { exact: true })).toHaveValue('0.42');
  await page.getByLabel('Camera Bézier 1 X', { exact: true }).fill('0.2');
  await page.getByRole('button', { name: 'Apply selected camera key', exact: true }).click();
  await page.getByLabel('Duplicate camera key at (s)', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Duplicate camera key', exact: true }).click();
  await expect(keys.getByRole('button')).toHaveCount(4);
  await page.getByRole('button', { name: 'Delete camera key', exact: true }).click();
  await expect(keys.getByRole('button')).toHaveCount(3);
  const moving = keys.getByRole('button', { name: 'Camera x key at 3 s', exact: true });
  await moving.scrollIntoViewIfNeeded();
  const lane = (await keys.boundingBox())!;
  const diamond = (await moving.boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.move(diamond.x + diamond.width / 2, diamond.y + diamond.height / 2);
  await page.mouse.down();
  await page.mouse.move(diamond.x + diamond.width / 2 - lane.width / 12, diamond.y + diamond.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect
    .poll(async () => Number(await page.getByLabel('Camera key time (s)', { exact: true }).inputValue()))
    .toBeCloseTo(2.5, 4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Camera key time (s)', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect
    .poll(async () => Number(await page.getByLabel('Camera key time (s)', { exact: true }).inputValue()))
    .toBeCloseTo(2.5, 4);
  await inspector.getByRole('button', { name: 'Preview Through Camera', exact: true }).click();
  await time.fill('1');
  await waitForPreviewPaint(page);
  const canvas = page.locator('#scene-stage-canvas canvas');
  const frame = await canvas.screenshot();
  await time.fill('4');
  await time.fill('1');
  await waitForPreviewPaint(page);
  expect(Buffer.compare(frame, await canvas.screenshot())).toBe(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('Scene playback status', { exact: true })).toContainText('playing');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await time.fill('1');
  await waitForPreviewPaint(page);
  expect(Buffer.compare(frame, await canvas.screenshot())).toBe(0);
  await inspector.getByRole('button', { name: 'Exit Camera Preview', exact: true }).click();
  const downloadJson = async () => {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
    return readFile(await (await waiting).path());
  };
  const beforeNavigation = await downloadJson();
  await canvas.scrollIntoViewIfNeeded();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -100);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + bounds.height / 2 + 20, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  expect((await downloadJson()).toString()).toBe(beforeNavigation.toString());
  const authored = parseSceneJson(beforeNavigation.toString());
  expect(authored.cameraTracks!.x![0]!.curve).toEqual({
    mode: 'bezier',
    control1: { x: 0.2, y: 0 },
    control2: { x: 0.58, y: 1 },
  });
  expect(authored.actors).toEqual(source.actors);
  expect(authored.actions).toEqual(source.actions);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const restored = await validateScenePackage(
    decodePackageZip(new Uint8Array(await readFile(await (await waiting).path()))),
  );
  expect(restored.definition.cameraTracks).toEqual(authored.cameraTracks);
  // Reopen the portable authored camera in another retained scene, with no overwrite prompt.
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'reloaded.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...authored, id: 'reloaded' })),
  });
  await expect(page.getByLabel('Camera x keys', { exact: true }).getByRole('button')).toHaveCount(3);
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
});
