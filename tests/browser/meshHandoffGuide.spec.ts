import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { createRectangleMeshAttachment } from '../../src/engine/meshAttachments.js';
import { decodePackageZip, encodePackageZip } from '../../src/engine/packageZip.js';
import { artworkFixture } from '../helpers/scenePackageFixtures.js';
import { test } from './fixtures.js';

const guide = guideRegistry.getGuideById('project-mesh-handoff')!;
const startName = `Start Guide: ${guide.title}`;

async function catalog(page: Page) {
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await dialog.getByRole('button', { name: 'Project Workspace', exact: true }).click();
  await dialog.getByRole('searchbox', { name: 'Search guides', exact: true }).fill('mesh');
  return dialog;
}

async function snapshot(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  return decodePackageZip(new Uint8Array(await readFile(await (await pending).path())));
}

function meshCharacterZip() {
  const { documents } = artworkFixture();
  const rig = { root: 'root', bones: [{ id: 'root' }], slots: [{ id: 'cloth', bone: 'root' }] };
  const mesh = createRectangleMeshAttachment({ id: 'cloth', texture: 'paper' }, { width: 1, height: 1 }, rig);
  documents['rig.json'] = { version: 1, ...rig, attachments: [mesh] };
  documents['skins/default.json'] = { version: 1, name: 'default', slots: { cloth: 'cloth' } };
  documents['animations/wave.json'] = {
    version: 1,
    name: 'wave',
    duration: 1000,
    loop: false,
    tracks: {},
    deformationTracks: {
      cloth: [
        { time: 0, offsets: {} },
        { time: 500, offsets: { 'top-left': { x: 0.25, y: 0.1 } } },
        { time: 1000, offsets: {} },
      ],
    },
  };
  const encoder = new TextEncoder();
  return Buffer.from(
    encodePackageZip(
      new Map(
        Object.entries(documents).map(([path, value]) => [
          path,
          value instanceof Uint8Array ? value : encoder.encode(JSON.stringify(value)),
        ]),
      ),
    ),
  );
}

for (const populated of [false, true]) {
  test(`mesh handoff tour spotlights project controls and preserves ${populated ? 'a deformable character' : 'an empty project'}`, async ({
    page,
  }) => {
    await page.goto('project/');
    const missing = await catalog(page);
    await expect(missing.getByRole('button', { name: startName, exact: true })).toBeDisabled();
    await expect(missing).toContainText('Create or import a project first');
    await missing.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'New Project', exact: true });
    await create.getByLabel('Project name').fill('Mesh handoff');
    await create.getByRole('button', { name: 'Create Project', exact: true }).click();
    if (populated) {
      await page
        .getByLabel('Import Character ZIP', { exact: true })
        .setInputFiles({ name: 'mesh.zip', mimeType: 'application/zip', buffer: meshCharacterZip() });
      await expect(page.getByRole('status')).toContainText('Character registered.');
    }
    const before = await snapshot(page);
    const validation = page.getByRole('region', { name: 'Project validation', exact: true });
    const validationBefore = await validation.textContent();
    const history = [
      await page.getByRole('button', { name: 'Undo Project', exact: true }).isEnabled(),
      await page.getByRole('button', { name: 'Redo Project', exact: true }).isEnabled(),
    ];
    await page.getByRole('tab', { name: 'Local draft', exact: true }).click();
    const picker = await catalog(page);
    await expect(picker.locator('.feature-guide-entry h4')).toHaveText([guide.title]);
    await picker.getByRole('button', { name: startName, exact: true }).click();
    const tour = page.getByRole('dialog', { name: guide.title, exact: true });
    let downloads = 0;
    const onDownload = () => downloads++;
    page.on('download', onDownload);
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
      const target = page.locator(`[data-guide-id="${step.targetId}"]`);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
      await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
      await expect(tour).not.toContainText('Target unavailable');
      await expect(tour.getByRole('button', { name: 'Try It', exact: true })).toHaveCount(0);
      if (index + 1 < guide.steps.length) await tour.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(page.getByRole('tab', { name: 'Project', exact: true })).toHaveAttribute('aria-selected', 'true');
    await tour.getByRole('button', { name: 'Restart guide', exact: true }).click();
    await expect(tour).toContainText('Step 1 of 9');
    await tour.getByRole('button', { name: 'Next', exact: true }).click();
    await tour.getByRole('button', { name: 'Back', exact: true }).click();
    await tour.getByRole('button', { name: 'Choose another guide', exact: true }).click();
    await picker.getByRole('button', { name: startName, exact: true }).click();
    for (let index = 1; index < guide.steps.length; index++)
      await tour.getByRole('button', { name: 'Next', exact: true }).click();
    await tour.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
    page.off('download', onDownload);
    expect(downloads).toBe(0);
    await expect(page.locator('iframe.project-editor-host')).toHaveCount(0);
    expect(await validation.textContent()).toBe(validationBefore);
    expect([
      await page.getByRole('button', { name: 'Undo Project', exact: true }).isEnabled(),
      await page.getByRole('button', { name: 'Redo Project', exact: true }).isEnabled(),
    ]).toEqual(history);
    await expect(page.getByText('Project metadata: Exported', { exact: true })).toBeVisible();
    const after = await snapshot(page);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [path, bytes] of before) expect(after.get(path)).toEqual(bytes);
  });
}
