import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { parseRigDefinition } from '../../src/engine/externalData.js';
import { getFootContactWorldPosition } from '../../src/engine/footContactMarkers.js';
import { parseSceneJson, createEmptyScene } from '../../src/engine/SceneDefinition.js';
import { rigFileSchema } from '../../src/engine/schemas.js';
import { sceneInspectorGroup, test } from './fixtures.js';

async function downloadAnimation(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.locator('#animation-download').click();
  const path = await (await waiting).path();
  return readFile(path, 'utf8');
}

async function installContacts(page: Page) {
  await page.route('**/characters/*/rig.json', async (route) => {
    const response = await route.fetch();
    const rig = rigFileSchema.parse(await response.json());
    await route.fulfill({
      response,
      json: {
        ...rig,
        version: 1,
        footContactMarkers: [
          { id: 'sole', name: 'Main sole', boneId: 'rightFoot', localX: 8, localY: 12 },
          { id: 'heel', name: 'Raised heel', boneId: 'rightFoot', localX: -2, localY: -10 },
        ],
      },
    });
  });
}

test('preview and explicitly apply contact IK keys, then undo/redo and scrub without automatic key edits', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installContacts(page);
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('walk');
  const panel = page.locator('#animation-inspector .ground-guide-controls');
  await expect(panel).not.toHaveAttribute('open');
  await panel.locator('summary').click();
  await panel.getByLabel('Show ground guide', { exact: true }).check();
  await panel.getByRole('combobox', { name: 'Foot contact marker', exact: true }).selectOption('sole');
  await panel.getByRole('combobox', { name: 'Foot IK constraint', exact: true }).selectOption('rightLegIK');
  const distances = panel.getByRole('list', { name: 'Contact ground distances' });
  await expect(distances).toContainText('Main sole');
  await expect(distances).toContainText(/World X -?[\d.]+, Y -?[\d.]+/);
  const y = panel.getByRole('spinbutton', { name: 'Ground Y', exact: true });
  const distance = Number(
    (await distances.getByText('Main sole', { exact: false }).innerText()).match(/: ([-\d.]+)/)![1],
  );
  await y.fill(String(Number(await y.inputValue()) + distance - 5));
  await y.press('Enter');
  const original = await downloadAnimation(page);
  await panel.getByRole('button', { name: 'Align Selected Foot Contact to Ground', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Within tolerance');
  expect(await downloadAnimation(page)).toBe(original);
  await panel.getByRole('button', { name: 'Cancel alignment preview', exact: true }).click();
  expect(await downloadAnimation(page)).toBe(original);
  await panel.getByRole('button', { name: 'Align Selected Foot Contact to Ground', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply IK target keys', exact: true }).click();
  await expect(distances.getByText('Main sole', { exact: false })).toContainText('on ground');
  const committed = await downloadAnimation(page);
  expect(committed).not.toBe(original);
  await page.locator('#animation-undo').click();
  expect(await downloadAnimation(page)).toBe(original);
  await page.locator('#animation-redo').click();
  expect(await downloadAnimation(page)).toBe(committed);
  await page.locator('#timeline-time-input').fill('0.5');
  await page.locator('#timeline-time-input').press('Enter');
  await page.locator('#animation-facing').selectOption('left');
  await y.fill('500');
  await y.press('Enter');
  expect(await downloadAnimation(page)).toBe(committed);
  expect(errors).toEqual([]);
});

test('ground two differently sized Actors through an explicit marker and keep paths authoritative while scrubbing', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installContacts(page);
  const source = {
    ...createEmptyScene({ id: 'contact-scene', duration: 1000 }),
    actors: [
      { id: 'a', character: { manifest: '../characters/demo-puppet/character.json' }, position: { x: -150, y: 20 } },
      {
        id: 'b',
        character: { manifest: '../characters/random-paperdoll-sketch/character.json' },
        position: { x: 180, y: -30 },
        facing: 'left' as const,
      },
    ],
    actions: [
      { id: 'walk', type: 'move' as const, actorId: 'a', time: 0, duration: 1000, destination: { x: 150, y: 60 } },
    ],
  };
  await page.goto('scene-editor/');
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'contacts.scene.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await sceneInspectorGroup(page, 'Actors');
  const panel = page.locator('.ground-guide-controls');
  await expect(panel).not.toHaveAttribute('open');
  await panel.locator('summary').click();
  await panel.getByLabel('Show ground guide', { exact: true }).check();
  await panel.getByLabel('Ground Y', { exact: true }).fill('100');
  await panel.getByLabel('Ground Y', { exact: true }).press('Enter');
  for (const actor of source.actors) {
    await page
      .getByLabel('Action tracks', { exact: true })
      .getByRole('button', { name: actor.id, exact: true })
      .click();
    const snap = panel.getByRole('button', { name: 'Snap Actor to Ground', exact: true });
    await expect(snap).toBeDisabled();
    await panel.getByRole('combobox', { name: 'Actor foot contact marker', exact: true }).selectOption('sole');
    await snap.click();
    await page.getByText('Actor properties', { exact: true }).click();
    const rig = parseRigDefinition(
      await (
        await page.request.get(
          actor.id === 'a' ? 'characters/demo-puppet/rig.json' : 'characters/random-paperdoll-sketch/rig.json',
        )
      ).json(),
    );
    const local = getFootContactWorldPosition(
      { id: 'sole', name: 'Main sole', boneId: 'rightFoot', localX: 8, localY: 12 },
      rig,
      new Map(),
    )!;
    await expect
      .poll(async () => Number(await page.getByRole('spinbutton', { name: 'Initial Y', exact: true }).inputValue()))
      .toBeCloseTo(100 - local.y, 3);
  }
  const exported = async () => {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download scene JSON' }).click();
    return parseSceneJson(await readFile(await (await waiting).path(), 'utf8'));
  };
  const aligned = await exported();
  expect(aligned.actions).toEqual(source.actions);
  expect(aligned.actors.map((actor) => actor.position.x)).toEqual(source.actors.map((actor) => actor.position.x));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Snap Actor to Ground', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Playhead (s)', exact: true }).fill('0.6');
  expect(await exported()).toEqual(aligned);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(errors).toEqual([]);
});
