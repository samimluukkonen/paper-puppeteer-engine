import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { decodePackageZip, encodePackageZip } from '../../src/engine/packageZip.js';
import type { RigDefinition } from '../../src/engine/types.js';
import { inspectorControl, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

test('rig mapping proposals, approval, project history, guide, recovery and ZIP import preserve correspondence', async ({
  page,
}, info) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name').fill('Mapping Film');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  for (const name of ['Source', 'Target']) {
    await page.getByRole('button', { name: '+ New Character', exact: true }).click();
    const character = page.getByRole('dialog', { name: 'New Character', exact: true });
    await character.getByLabel('Character name').fill(name);
    await character.getByRole('button', { name: 'Create Character', exact: true }).click();
    await expect(page.locator('.project-status')).toContainText('Empty character created');
  }
  const panel = page.locator('.project-rig-mapping');
  await expect(panel).not.toHaveAttribute('open');
  await panel.locator(':scope > summary').click();
  await panel.getByLabel('Source rig', { exact: true }).selectOption('source');
  await panel.getByLabel('Target rig', { exact: true }).selectOption('target');
  await expect(panel.getByRole('button', { name: 'Save Mapping', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Auto Suggest', exact: true }).click();
  await expect(panel.getByLabel('Target for root', { exact: true })).toHaveValue('root');
  await panel.getByRole('button', { name: 'Remove correspondence for root', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Save Mapping', exact: true })).toBeDisabled();
  await panel.getByLabel('Target for root', { exact: true }).selectOption('root');
  await panel.getByLabel('Mapping name', { exact: true }).fill('Shared root correspondence');
  await panel.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(panel).toContainText('Mapping validated');
  await expect(panel).toContainText('Mappable rig');
  await panel.getByRole('button', { name: 'Save Mapping', exact: true }).click();
  await expect(panel.locator('.project-mapping-saved li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo Project', exact: true }).click();
  await expect(panel.locator('.project-mapping-saved li')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo Project', exact: true }).click();
  await expect(panel.locator('.project-mapping-saved li')).toHaveCount(1);

  const guide = guideRegistry.getGuideById('project-rig-mapping')!;
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await catalog.getByRole('button', { name: 'Project Workspace', exact: true }).click();
  await catalog.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
  const tour = page.getByRole('dialog', { name: guide.title, exact: true });
  for (const [index, step] of guide.steps.entries()) {
    await expect(tour.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
    await expect(tour).not.toContainText('Target unavailable');
    if (index + 1 < guide.steps.length) await tour.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await tour.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(panel.locator('.project-mapping-saved li')).toHaveCount(1);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('rig-mapping.png') });
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await recovery.getByRole('button', { name: 'Recover Draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mapping Film', exact: true })).toBeVisible();
  await panel.locator(':scope > summary').click();
  await expect(panel.locator('.project-mapping-saved')).toContainText('Shared root correspondence');
  await panel.getByRole('button', { name: 'Review mapping', exact: true }).click();
  await expect(panel.getByLabel('Target for root', { exact: true })).toHaveValue('root');
  await expect(panel).toContainText('Mappable rig');

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const download = await pending;
  const path = await download.path();
  const files = decodePackageZip(new Uint8Array(await readFile(path)));
  const metadata = JSON.parse(new TextDecoder().decode(files.get('project.json'))) as {
    project: { rigMappings: unknown[] };
  };
  expect(metadata.project.rigMappings).toHaveLength(1);
  await page.getByLabel('Import Project', { exact: true }).setInputFiles(path);
  await expect(panel).not.toHaveAttribute('open');
  await panel.locator(':scope > summary').click();
  await expect(panel.locator('.project-mapping-saved')).toContainText('Mappable rig');
  await panel.getByRole('button', { name: 'Remove mapping', exact: true }).click();
  await expect(panel.locator('.project-mapping-saved li')).toHaveCount(0);
});

test('ambiguous targets require a manual choice and rig edits require explicit revision review', async ({ page }) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
  await dialog.getByLabel('Project name').fill('Ambiguous rigs');
  await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
  const rigs: [string, RigDefinition][] = [
    ['source', { root: 'root', bones: [{ id: 'root' }, { id: 'tip', parent: 'root', y: 10 }] }],
    [
      'target',
      {
        root: 'base',
        bones: [{ id: 'base' }, { id: 'one', parent: 'base', x: 10 }, { id: 'two', parent: 'base', y: 10 }],
      },
    ],
  ];
  for (const [id, rig] of rigs) {
    const documents = {
      'character.json': {
        version: 1,
        id,
        rig: 'rig.json',
        defaultSkin: 'default',
        skins: { default: 'skin.json' },
        animations: [],
        textures: {},
      },
      'rig.json': { version: 1, ...rig },
      'skin.json': { version: 1, name: 'default', slots: {} },
    };
    const zip = encodePackageZip(
      new Map(Object.entries(documents).map(([path, data]) => [path, new TextEncoder().encode(JSON.stringify(data))])),
    );
    await page
      .getByLabel('Import Character ZIP', { exact: true })
      .setInputFiles({ name: `${id}.zip`, mimeType: 'application/zip', buffer: Buffer.from(zip) });
    await expect(page.locator('.project-status')).toHaveText('Character registered.');
    await expect(page.getByRole('button', { name: 'Import Character ZIP', exact: true })).toBeEnabled();
  }
  const panel = page.locator('.project-rig-mapping');
  await panel.locator(':scope > summary').click();
  await panel.getByLabel('Source rig', { exact: true }).selectOption('source');
  await panel.getByLabel('Target rig', { exact: true }).selectOption('target');
  await panel.getByRole('button', { name: 'Auto Suggest', exact: true }).click();
  await expect(panel).toContainText('Ambiguous: one, two. Choose explicitly.');
  await expect(panel.getByLabel('Target for tip', { exact: true })).toHaveValue('');
  await panel.getByLabel('Target for tip', { exact: true }).selectOption('one');
  await panel.getByRole('button', { name: 'Save Mapping', exact: true }).click();
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).first().click();
  const frame = await (await page.locator('iframe:visible').elementHandle())?.contentFrame();
  if (!frame) throw new Error('Missing rig editor');
  await expect(frame.locator('#validation')).toHaveText('Validation: OK');
  await inspectorControl(frame, '#hierarchy');
  const root = frame.getByRole('treeitem', { name: 'root', exact: true });
  if ((await root.getAttribute('aria-selected')) !== 'true') await root.click();
  const x = await inspectorControl(frame, '#inspector [data-scope=bone][data-field=x]');
  await x.fill('12');
  await x.blur();
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await expect(panel.locator('.project-mapping-saved')).toContainText('Invalid or stale');
  await panel.getByRole('button', { name: 'Review mapping', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Save Mapping', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Review current revisions', exact: true }).click();
  await panel.getByRole('button', { name: 'Validate', exact: true }).click();
  await panel.getByRole('button', { name: 'Save Mapping', exact: true }).click();
  await expect(panel.locator('.project-mapping-saved')).toContainText('Mappable rig');
});
