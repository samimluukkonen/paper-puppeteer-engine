import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';

async function createScene(page: Page, id: string) {
  await page.getByRole('button', { name: 'New Scene', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Scene' });
  await dialog.getByLabel('Scene ID').fill(id);
  await dialog.getByRole('button', { name: 'Create scene', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function downloadScene(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene JSON' }).click();
  const download = await waiting;
  const path = await download.path();
  if (!path) throw new Error('Scene download missing.');
  return parseSceneJson(await readFile(path, 'utf8'));
}

test('empty creation, multiple documents, properties, history, downloads and unsaved navigation', async ({ page }) => {
  const errors: string[] = [];
  const characterRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/characters/')) characterRequests.push(request.url());
  });
  await page.goto('scene-editor/');
  await expect(page.getByRole('heading', { name: 'Scene Editor', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scene stage' })).toBeVisible();
  await createScene(page, 'first');
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page.getByText('Scene properties', { exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Scene inspector' })
    .getByLabel('Name', { exact: true })
    .fill('Opening scene');
  await page
    .getByRole('complementary', { name: 'Scene inspector' })
    .getByLabel('Duration (seconds)', { exact: true })
    .fill('4.5');
  await page.getByRole('button', { name: 'Apply properties' }).click();
  await expect(page.getByRole('status')).toContainText('Opening scene · first · 4.5 s · New / Unsaved');
  await createScene(page, 'second');
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page.getByLabel('Select scene').selectOption('first');
  await page.getByText('Scene properties', { exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Scene inspector' }).getByLabel('Name', { exact: true }),
  ).toHaveValue('Opening scene');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Scene inspector' }).getByLabel('Name', { exact: true }),
  ).toHaveValue('Untitled Scene');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const scene = await downloadScene(page);
  expect(scene).toMatchObject({ id: 'first', name: 'Opening scene', duration: 4500, actors: [], actions: [] });
  await expect(page.getByRole('status')).toContainText('Matches loaded / exported checkpoint');
  const waiting = page.waitForEvent('dialog');
  const clicking = page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  const guard = await waiting;
  expect(guard.type()).toBe('beforeunload');
  await guard.dismiss();
  await clicking;
  await expect(page).toHaveURL(/scene-editor\//);
  await page.getByLabel('Select scene').selectOption('second');
  await downloadScene(page);
  expect(characterRequests).toEqual([]);
  await page.getByRole('link', { name: 'Engine Demo', exact: true }).click();
  await expect(page).not.toHaveURL(/scene-editor\//);
  await page.getByRole('link', { name: 'Scene Editor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No scene open', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('imports retain authored actors/actions and guard dirty replacement and source revert', async ({ page }) => {
  await page.goto('scene-editor/');
  const input = {
    version: 2,
    id: 'imported',
    name: 'Imported scene',
    duration: 10000,
    actors: [
      {
        id: 'hero',
        character: { manifest: '../characters/demo-puppet/character.json' },
        position: { x: 42, y: 17 },
        skin: 'default',
        facing: 'right',
      },
    ],
    actions: [{ id: 'look', type: 'face', actorId: 'hero', time: 2000, target: { type: 'direction', facing: 'left' } }],
  };
  const upload = async (value: unknown) => {
    await page.getByLabel('Open scene JSON').setInputFiles({
      name: 'test.scene.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    });
  };
  await upload(input);
  await expect(page.getByRole('status')).toContainText('Imported scene');
  await page.getByText('Scene properties', { exact: true }).click();
  await page.getByRole('complementary', { name: 'Scene inspector' }).getByLabel('Name', { exact: true }).fill('Edited');
  await page.getByRole('button', { name: 'Apply properties' }).click();
  await Promise.all([page.waitForEvent('dialog').then((dialog) => dialog.dismiss()), upload(input)]);
  // Dependency loading is asynchronous; the old scene name alone does not mean import finished.
  await expect(page.getByRole('status')).toContainText('Import cancelled.');
  await expect(page.getByRole('status')).toContainText('Edited');
  await Promise.all([
    page.waitForEvent('dialog').then((dialog) => dialog.accept()),
    page.getByRole('button', { name: 'Revert', exact: true }).click(),
  ]);
  await expect(page.getByRole('status')).toContainText('Imported scene');
  expect(await downloadScene(page)).toEqual(input);
  await upload({ ...input, actors: [input.actors[0], input.actors[0]] });
  await expect(page.getByRole('alert')).toContainText('Duplicate actor ID');
  await expect(page.getByRole('status')).toContainText('Imported scene');
});

test('scene workspace fits desktop viewports with a collapsed inspector', async ({ page }) => {
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('scene-editor/');
    await expect(page.getByRole('region', { name: 'Scene stage' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
  }
});

test('visual actor placement, appearance, duplication, cancellation and document cleanup', async ({ page }) => {
  const errors: string[] = [];
  const assetRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/characters/')) assetRequests.push(request.url());
  });
  await page.goto('scene-editor/');
  await createScene(page, 'placement');
  const add = async () => {
    await page.getByRole('button', { name: '+ Add Actor', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Add Actor', exact: true })
      .getByRole('button', { name: 'Add actor', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'Add Actor', exact: true })).not.toBeVisible();
  };
  await add();
  await add();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  const canvas = page.locator('#scene-stage-canvas canvas');
  await expect(canvas).toBeVisible();
  await page.getByText('Actor properties', { exact: true }).click();
  await page.getByLabel('Initial X', { exact: true }).fill('200');
  await page.getByLabel('Initial Y', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Apply actor properties' }).click();
  await page.getByRole('combobox', { name: 'Facing', exact: true }).selectOption('left');
  await page.getByRole('combobox', { name: 'Initial animation', exact: true }).selectOption('idle');
  await page.getByRole('combobox', { name: 'Initial skin', exact: true }).selectOption('alternate');
  const snapshot = await downloadScene(page);
  expect(snapshot.actors).toHaveLength(2);
  expect(snapshot.actors[1]).toMatchObject({
    id: 'actor-2',
    position: { x: 200, y: 100 },
    facing: 'left',
    animation: 'idle',
    skin: 'alternate',
  });
  await page.getByText('Scene actors (2)', { exact: true }).click();
  await page.getByRole('button', { name: 'actor-1 → demo-puppet', exact: true }).click();
  await page.getByText('Actor properties', { exact: true }).click();
  await page.getByLabel('Initial X', { exact: true }).fill('-200');
  await page.getByLabel('Initial Y', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Apply actor properties' }).click();
  // Default view is centered on world (0,0); FIT scaling determines DOM positions.
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width * 0.3, y: box.y + box.height * (450 / 700) };
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + box.width * 0.05, origin.y - box.height * (25 / 700), { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByLabel('Initial X', { exact: true }).inputValue()))
    .toBeCloseTo(-150, 3);
  await expect
    .poll(async () => Number(await page.getByLabel('Initial Y', { exact: true }).inputValue()))
    .toBeCloseTo(75, 3);
  const movedX = await page.getByLabel('Initial X', { exact: true }).inputValue();
  const movedY = await page.getByLabel('Initial Y', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Initial X', { exact: true })).toHaveValue('-200');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Initial X', { exact: true })).toHaveValue(movedX);
  await page.mouse.move(origin.x + box.width * 0.05, origin.y - box.height * (25 / 700));
  await page.mouse.down();
  await page.mouse.move(origin.x + box.width * 0.1, origin.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByLabel('Initial X', { exact: true })).toHaveValue(movedX);
  await expect(page.getByLabel('Initial Y', { exact: true })).toHaveValue(movedY);
  await page.getByRole('button', { name: 'Duplicate Actor', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Actor', exact: true }).click();
  expect((await downloadScene(page)).actors).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await downloadScene(page)).actors).toHaveLength(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await downloadScene(page)).actors).toHaveLength(2);
  const requestCount = assetRequests.length;
  await createScene(page, 'empty');
  await page.getByLabel('Select scene').selectOption('placement');
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  expect((await downloadScene(page)).actors).toHaveLength(2);
  expect(assetRequests.length).toBe(requestCount);
  expect(errors).toEqual([]);
});

test('visual scene timeline edits clips, markers, properties, grouped history and serialized actions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('scene-editor/');
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'timeline.scene.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        id: 'timeline',
        name: 'Timeline',
        duration: 10000,
        actors: ['a', 'b'].map((id, index) => ({
          id,
          character: { manifest: '../characters/demo-puppet/character.json' },
          position: { x: index * 200, y: 0 },
        })),
        actions: [],
      }),
    ),
  });
  await expect(page.locator('.scene-track-row')).toHaveCount(3);
  const tracks = page.getByLabel('Action tracks', { exact: true });
  await tracks.getByRole('button', { name: 'a', exact: true }).click();
  await page.getByRole('combobox', { name: 'Action type', exact: true }).selectOption('move');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  const movement = page.getByRole('button', { name: 'a: move action-1', exact: true });
  await expect(movement).toBeVisible();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await page.getByText('Action properties · move', { exact: true }).click();
  await page.getByLabel('Destination X', { exact: true }).fill('400');
  await page.getByLabel('Action duration (seconds)', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Apply action properties' }).click();
  const before = await downloadScene(page);
  expect(before.actors[0]!.position).toEqual({ x: 0, y: 0 });
  expect(before.actions[0]).toMatchObject({ type: 'move', time: 0, duration: 2000, destination: { x: 400, y: 0 } });
  const box = await movement.boundingBox();
  if (!box) throw new Error('Missing movement clip');
  const lane = await page.getByLabel('a actions', { exact: true }).boundingBox();
  if (!lane) throw new Error('Missing timeline lane');
  await page.mouse.move(box.x + 15, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 15 + lane.width * 0.2, box.y + 10, { steps: 6 });
  await page.mouse.up();
  expect((await downloadScene(page)).actions[0]!.time).toBeCloseTo(2000, 5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await downloadScene(page)).actions[0]!.time).toBe(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await downloadScene(page)).actions[0]!.time).toBeCloseTo(2000, 5);
  // Resize is independently undoable; Escape cancels without consuming the redo branch.
  const resize = movement.locator('[data-resize]');
  const edge = await resize.boundingBox();
  if (!edge) throw new Error('Missing duration handle');
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 10);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + lane.width * 0.1, edge.y + 10, { steps: 4 });
  await page.mouse.up();
  expect((await downloadScene(page)).actions[0]).toMatchObject({ time: 2000, duration: 3000 });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const current = await movement.boundingBox();
  if (!current) throw new Error('Missing movement clip');
  await page.mouse.move(current.x + 15, current.y + 10);
  await page.mouse.down();
  await page.mouse.move(current.x + 65, current.y + 10);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  expect((await downloadScene(page)).actions[0]).toMatchObject({ time: 2000, duration: 2000 });
  await page.getByLabel('Duplicate at (seconds)', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Duplicate action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'a: move action-2', exact: true })).toBeVisible();
  // A second Actor can own the same channel at the same time.
  await tracks.getByRole('button', { name: 'b', exact: true }).click();
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'b: move action-3', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Action type', exact: true }).selectOption('animation');
  await expect(page.getByRole('button', { name: 'Add action', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByText('Action properties · animation', { exact: true }).click();
  expect(
    await page.getByRole('combobox', { name: 'Animation ID', exact: true }).locator('option').allTextContents(),
  ).toEqual(['idle', 'walk', 'sword', 'guardUpperBody']);
  await page.getByRole('combobox', { name: 'Animation ID', exact: true }).selectOption('walk');
  await page.getByLabel('Loop within duration', { exact: true }).check();
  await page.getByRole('button', { name: 'Apply action properties' }).click();
  await page.getByRole('combobox', { name: 'Action type', exact: true }).selectOption('cue');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByText('Action properties · cue', { exact: true }).click();
  await page.getByLabel('Cue name', { exact: true }).fill('arrived');
  await page.getByLabel('Payload (JSON, optional)', { exact: true }).fill('{"location":"door"}');
  await page.getByRole('button', { name: 'Apply action properties' }).click();
  const result = await downloadScene(page);
  expect(result.actions).toHaveLength(5);
  expect(result.actions[3]).toMatchObject({ type: 'animation', animation: 'walk', loop: true });
  expect(result.actions[4]).toMatchObject({ type: 'cue', name: 'arrived', payload: { location: 'door' } });
  await page.getByRole('button', { name: 'Delete action', exact: true }).click();
  expect((await downloadScene(page)).actions).toHaveLength(4);
  await page.getByLabel('Timeline zoom', { exact: true }).fill('4');
  expect(await tracks.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('scene panel dividers resize inspector and timeline without authoring', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('scene-editor/');
  await createScene(page, 'resizing');
  const original = await downloadScene(page);
  const inspector = page.getByRole('complementary', { name: 'Scene inspector', exact: true });
  const timeline = page.getByRole('region', { name: 'Scene timeline', exact: true });
  const widthDivider = page.getByRole('separator', { name: 'Scene inspector width', exact: true });
  const heightDivider = page.getByRole('separator', { name: 'Scene timeline height', exact: true });
  const originalWidth = (await inspector.boundingBox())!.width;
  const originalHeight = (await timeline.boundingBox())!.height;
  const vertical = (await widthDivider.boundingBox())!;
  await page.mouse.move(vertical.x + vertical.width / 2, vertical.y + 50);
  await page.mouse.down();
  await page.mouse.move(vertical.x + vertical.width / 2 - 100, vertical.y + 50, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBeCloseTo(originalWidth + 100, 0);
  const horizontal = (await heightDivider.boundingBox())!;
  await page.mouse.move(horizontal.x + 50, horizontal.y + horizontal.height / 2);
  await page.mouse.down();
  await page.mouse.move(horizontal.x + 50, horizontal.y + horizontal.height / 2 - 80, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await timeline.boundingBox())!.height).toBeCloseTo(originalHeight + 80, 0);
  await widthDivider.press('Home');
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBe(260);
  await widthDivider.press('ArrowLeft');
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBe(270);
  await heightDivider.press('Home');
  await expect.poll(async () => (await timeline.boundingBox())!.height).toBe(240);
  await heightDivider.press('ArrowUp');
  await expect.poll(async () => (await timeline.boundingBox())!.height).toBe(260);
  await widthDivider.press('End');
  await heightDivider.press('End');
  await page.setViewportSize({ width: 1280, height: 800 });
  const layout = page.locator('.scene-workspace-body');
  await expect
    .poll(async () => (await inspector.boundingBox())!.width)
    .toBeLessThanOrEqual((await layout.boundingBox())!.width - 572);
  await expect
    .poll(async () => (await timeline.boundingBox())!.height)
    .toBeLessThanOrEqual((await layout.boundingBox())!.height - 212);
  await expect
    .poll(async () => {
      const host = (await page.locator('#scene-stage-canvas').boundingBox())!;
      const canvas = (await page.locator('#scene-stage-canvas canvas').boundingBox())!;
      return canvas.width <= host.width + 1 && canvas.height <= host.height + 1;
    })
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(await downloadScene(page)).toEqual(original);
  expect(errors).toEqual([]);
});

test('two-character encounter playback, pause, restart, deterministic scrubbing and authored isolation', async ({
  page,
}) => {
  const errors: string[] = [];
  const failedAssets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedAssets.push(response.url());
  });
  const json = await readFile(new URL('../../public/scenes/encounter.scene.json', import.meta.url), 'utf8');
  const authored = parseSceneJson(json);
  await page.goto('scene-editor/');
  await page
    .getByLabel('Open scene JSON')
    .setInputFiles({ name: 'encounter.scene.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  const tracks = page.getByLabel('Action tracks', { exact: true });
  await tracks.getByRole('button', { name: 'a', exact: true }).click();
  await page.getByText('Runtime preview', { exact: true }).click();
  const position = page.getByText('Position', { exact: true }).locator('+ dd');
  const animation = page.getByText('Animation', { exact: true }).locator('+ dd');
  const time = page.getByRole('spinbutton', { name: 'Playhead (s)', exact: true });
  const status = page.getByLabel('Scene playback status', { exact: true });
  for (const [seconds, expected] of [
    ['0.25', '-280.000, 120.000'],
    ['1.5', '-195.000, 120.000'],
    ['2.5', '-110.000, 120.000'],
    ['0.25', '-280.000, 120.000'],
    ['1.5', '-195.000, 120.000'],
  ]) {
    await time.fill(seconds!);
    await expect(position).toHaveText(expected!);
    await expect(status).toContainText('paused');
  }
  await tracks.getByRole('button', { name: 'b', exact: true }).click();
  await expect(position).toHaveText('195.000, 120.000');
  await tracks.getByRole('button', { name: 'a', exact: true }).click();
  await time.fill('3.4');
  await expect(position).toHaveText('-110.000, 120.000');
  await expect(animation).toHaveText('bow');
  await page.screenshot({ path: test.info().outputPath('scene-encounter-bow.png') });
  await time.fill('5');
  await tracks.getByRole('button', { name: 'b', exact: true }).click();
  await expect(position).toHaveText('110.000, 120.000');
  await expect(animation).toHaveText('respond');
  await play.click();
  await expect(status).toContainText('playing');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const pausedTime = await time.inputValue();
  await page.waitForTimeout(120);
  await expect(time).toHaveValue(pausedTime);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(status).toContainText('playing');
  await expect.poll(async () => Number(await time.inputValue())).toBeLessThan(1);
  await time.fill('1.5');
  await expect(status).toContainText('paused');
  await expect(position).toHaveText('195.000, 120.000');
  await time.fill('6.5');
  await expect(status).toContainText('completed');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(status).toContainText('stopped');
  await expect(time).toHaveValue('0');
  await page.getByLabel('Scene playback speed', { exact: true }).selectOption('2');
  await play.click();
  await expect(status).toContainText('completed', { timeout: 15000 });
  await expect(position).toHaveText('110.000, 120.000');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(time).toHaveValue('0');
  expect(await downloadScene(page)).toEqual(authored);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Matches loaded / exported checkpoint');
  expect(failedAssets).toEqual([]);
  expect(errors).toEqual([]);
});
