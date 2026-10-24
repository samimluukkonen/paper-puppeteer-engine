import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { loadPackageDefinition } from '../../src/devtools/shared/package/characterPackage.js';
import { decodePackageZip } from '../../src/engine/packageZip.js';
import { parseSceneJson } from '../../src/engine/SceneDefinition.js';
import { validateScenePackage } from '../../src/engine/ScenePackage.js';
import { animationFileSchema, rigFileSchema } from '../../src/engine/schemas.js';
import { inspectorControl, rigFileAction, selectRigEntry, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

test('artist contact workflow from rig authoring through IK keys and portable two-character scene', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  for (const [index, bone] of ['rightFoot', 'leftFoot'].entries()) {
    await selectRigEntry(page, bone);
    const panel = await inspectorControl(page, '#rig-inspector .foot-contact-panel section');
    await panel.getByRole('button', { name: '+ Add Contact Marker', exact: true }).click();
    await panel.getByLabel('Contact name').fill(index ? 'Left sole' : 'Right sole');
    await panel.getByLabel('Contact name').press('Enter');
    for (const [label, value] of [
      ['Local X', '8'],
      ['Local Y', '12'],
    ] as const) {
      await panel.getByLabel(label, { exact: true }).fill(value);
      await panel.getByLabel(label, { exact: true }).press('Enter');
    }
  }
  await rigFileAction(page, '#reload-exported', (control) => control.click());
  const panel = await inspectorControl(page, '#rig-inspector .foot-contact-panel section');
  await panel.getByRole('button', { name: 'Right sole', exact: true }).click();
  await expect(panel.getByLabel('Local Y', { exact: true })).toHaveValue('12');
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('walk');
  const ground = await inspectorControl(page, '#animation-inspector .ground-guide-controls fieldset');
  await ground.getByLabel('Show ground guide', { exact: true }).check();
  await ground.getByRole('combobox', { name: 'Foot contact marker', exact: true }).selectOption('contact');
  await ground.getByRole('combobox', { name: 'Foot IK constraint', exact: true }).selectOption('rightLegIK');
  const distanceRow = ground
    .getByRole('list', { name: 'Contact ground distances' })
    .getByText('Right sole', { exact: false });
  await expect(distanceRow).toBeVisible();
  const initialDistance = await distanceRow.innerText();
  for (const time of ['0.25', '0.5', '0']) {
    await page.locator('#timeline-time-input').fill(time);
    await page.locator('#timeline-time-input').press('Enter');
    await expect(distanceRow).toBeVisible();
  }
  await expect(distanceRow).toHaveText(initialDistance);
  const y = ground.getByLabel('Ground Y', { exact: true });
  const distance = Number((await distanceRow.innerText()).match(/: ([-\d.]+)/)![1]);
  await y.fill(String(Number(await y.inputValue()) + distance - 5));
  await y.press('Enter');
  const exportClip = async () => {
    const waiting = page.waitForEvent('download');
    await page.locator('#animation-download').click();
    return readFile(await (await waiting).path(), 'utf8');
  };
  const original = await exportClip();
  await ground.getByRole('button', { name: 'Align Selected Foot Contact to Ground', exact: true }).click();
  await expect(ground.getByRole('status')).toContainText('Within tolerance');
  expect(await exportClip()).toBe(original);
  await ground.getByRole('button', { name: 'Apply IK target keys', exact: true }).click();
  await expect(distanceRow).toContainText('on ground');
  const committed = await exportClip();
  await page.locator('#animation-undo').click();
  expect(await exportClip()).toBe(original);
  await page.locator('#animation-redo').click();
  expect(await exportClip()).toBe(committed);
  await page.getByRole('tab', { name: 'Character package', exact: true }).click();
  const packages = page.locator('.package-tools');
  await packages.locator(':scope > summary').click();
  const waiting = page.waitForEvent('download');
  await packages.getByRole('button', { name: 'Download character ZIP', exact: true }).click();
  const files = decodePackageZip(await readFile(await (await waiting).path()));
  const loaded = await loadPackageDefinition(files);
  expect(loaded.rig.footContactMarkers).toHaveLength(2);
  expect(loaded.animations.find((clip) => clip.name === 'walk')?.tracks).toEqual(
    animationFileSchema.parse(JSON.parse(original)).tracks,
  );
  await packages.getByRole('button', { name: 'Reload exported package', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Package runtime preview', exact: true });
  await expect(preview).toContainText('runtime playback ready');
  await preview.getByRole('button', { name: 'Close preview' }).click();

  // Serve the exact exported package as an independent character dependency for the scene.
  await page.route('**/characters/contact-export/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/characters/contact-export/')[1]!;
    const bytes = files.get(decodeURIComponent(path));
    await route.fulfill({
      status: bytes ? 200 : 404,
      body: bytes ? Buffer.from(bytes) : '',
      contentType: path.endsWith('.json') ? 'application/json' : 'image/png',
    });
  });
  await page.route('**/characters/random-paperdoll-sketch/rig.json', async (route) => {
    const response = await route.fetch();
    const rig = rigFileSchema.parse(await response.json());
    await route.fulfill({ response, json: { ...rig, footContactMarkers: loaded.rig.footContactMarkers } });
  });
  await page.goto('scene-editor/');
  // Keep the saved character draft; this separate scene workflow uses its exported ZIP.
  await page
    .getByRole('dialog', { name: 'Recover unsaved work?', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  const source = {
    version: 2,
    id: 'contact-workflow',
    name: 'Contact workflow',
    duration: 1000,
    actors: [
      {
        id: 'first',
        character: { manifest: '../characters/contact-export/character.json' },
        position: { x: -150, y: 0 },
      },
      {
        id: 'second',
        character: { manifest: '../characters/random-paperdoll-sketch/character.json' },
        position: { x: 150, y: 0 },
        facing: 'left',
      },
    ],
    actions: [{ id: 'move', actorId: 'first', type: 'move', time: 0, duration: 1000, destination: { x: 100, y: 50 } }],
  };
  await page.getByLabel('Open scene JSON').setInputFiles({
    name: 'contacts.scene.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  const sceneGround = await inspectorControl(page, '.ground-guide-controls fieldset');
  await sceneGround.getByLabel('Show ground guide', { exact: true }).check();
  await sceneGround.getByLabel('Ground Y', { exact: true }).fill('100');
  await sceneGround.getByLabel('Ground Y', { exact: true }).press('Enter');
  for (const actor of source.actors) {
    await page
      .getByLabel('Action tracks', { exact: true })
      .getByRole('button', { name: actor.id, exact: true })
      .click();
    await sceneGround.getByRole('combobox', { name: 'Actor foot contact marker', exact: true }).selectOption('contact');
    await sceneGround.getByRole('button', { name: 'Snap Actor to Ground', exact: true }).click();
  }
  const exportScene = async () => {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
    return readFile(await (await waiting).path(), 'utf8');
  };
  const aligned = await exportScene();
  expect(parseSceneJson(aligned).actions).toEqual(source.actions);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Playhead (s)', exact: true }).fill('0.5');
  expect(await exportScene()).toBe(aligned);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const sceneWaiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download scene package', exact: true }).click();
  const scenePackage = await validateScenePackage(decodePackageZip(await readFile(await (await sceneWaiting).path())));
  expect(scenePackage.characters.size).toBe(2);
  for (const character of scenePackage.characters.values())
    expect(character.rig.footContactMarkers).toEqual(loaded.rig.footContactMarkers);
  await page
    .getByLabel('Open scene JSON')
    .setInputFiles({ name: 'aligned.scene.json', mimeType: 'application/json', buffer: Buffer.from(aligned) });
  expect(await exportScene()).toBe(aligned);
  expect(errors).toEqual([]);
});
