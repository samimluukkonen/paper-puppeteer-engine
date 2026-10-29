import { readFile } from 'node:fs/promises';
import { expect, type Frame, type Page } from '@playwright/test';
import { animationControl, inspectorControl, sceneTimelineGroup, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });

async function editor(page: Page): Promise<Frame> {
  const iframe = await page.locator('iframe:visible').elementHandle();
  const frame = await iframe?.contentFrame();
  if (!frame) throw new Error('Missing active editor');
  return frame;
}

test('editor library metadata, preview, direct reuse and independent copies preserve source exports', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const exported = async () => {
    const pending = page.waitForEvent('download');
    await (await animationControl(page, '#animation-download')).click();
    const path = await (await pending).path();
    return JSON.parse(await readFile(path, 'utf8')) as { name: string; library?: { displayName?: string } };
  };
  const before = await exported();
  const library = page.getByRole('dialog', { name: 'Animation Library', exact: true });
  await page.getByRole('button', { name: 'Animation Library', exact: true }).click();
  await library.getByText('Library metadata · idle', { exact: true }).click();
  await library.getByLabel('Display name', { exact: true }).fill('Sword Cut');
  await library.getByLabel('Tags (comma separated, optional)', { exact: true }).fill('sword, combat');
  await library.getByRole('button', { name: 'Save library metadata', exact: true }).click();
  await library.locator('.animation-library > summary').click();
  await library.getByRole('searchbox', { name: 'Search animations' }).fill('sword combat');
  await expect(library.locator('.animation-library-list li')).toHaveCount(1);
  await library.getByRole('button', { name: 'Preview animation', exact: true }).click();
  await expect(library).not.toBeVisible();
  await (await animationControl(page, '#play-pause')).click();
  const source = await exported();
  expect(source).toMatchObject({ ...before, library: { displayName: 'Sword Cut' } });
  await page.getByRole('button', { name: 'Animation Library', exact: true }).click();
  await library.getByRole('button', { name: 'Create Independent Copy', exact: true }).click();
  await expect(page.locator('#animation-selection')).toHaveValue('idle-variation');
  await page.getByRole('button', { name: 'Animation Library', exact: true }).click();
  await library.getByLabel('Display name', { exact: true }).fill('Independent sword cut');
  await library.getByRole('button', { name: 'Save library metadata', exact: true }).click();
  await library.getByRole('button', { name: 'Close library', exact: true }).click();
  await page.locator('#animation-undo').click();
  expect((await exported()).library?.displayName).toBe('Sword Cut');
  await page.locator('#animation-redo').click();
  expect((await exported()).library?.displayName).toBe('Independent sword cut');
  await page.getByRole('button', { name: 'Animation Library', exact: true }).click();
  await library
    .locator('.animation-library-list li')
    .filter({ has: page.locator('strong', { hasText: /^Sword Cut$/ }) })
    .getByRole('button', { name: 'Use Existing Animation', exact: true })
    .click();
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  expect(await exported()).toEqual(source);
});

test('project library previews runtime assets, blocks other rigs, creates a variation and reuses it in scenes', async ({
  page,
}) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name').fill('Library Film');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const character = page.getByRole('dialog', { name: 'New Character', exact: true });
  await character.getByLabel('Character name').fill('Hero');
  await character.getByRole('button', { name: 'Create Character', exact: true }).click();
  await page.getByRole('button', { name: 'Animation Editor', exact: true }).click();
  const frame = await editor(page);
  await frame.getByRole('button', { name: '+ New Animation', exact: true }).click();
  const animation = frame.getByRole('dialog', { name: 'Create new animation', exact: true });
  await animation.getByLabel('Animation name / ID').fill('sword-cut');
  await animation.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  await character.getByLabel('Character name').fill('Friend');
  await character.getByRole('button', { name: 'Create Character', exact: true }).click();
  const library = page.getByRole('region', { name: 'Project animation library', exact: true });
  await library.locator('.animation-library > summary').click();
  await library.getByRole('searchbox').fill('sword-cut');
  await library.getByLabel('Compatible character / rig').selectOption('friend');
  await expect(library.getByRole('button', { name: 'Use Existing Animation', exact: true })).toBeDisabled();
  await expect(library).toContainText('Incompatible rig identity');
  await library.getByLabel('Compatible character / rig').selectOption('hero');
  await library.getByRole('button', { name: 'Preview animation', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Animation runtime preview', exact: true });
  await expect(preview.getByRole('status')).toContainText('Runtime preview ready');
  await preview.getByRole('button', { name: 'Play', exact: true }).click();
  await preview.getByRole('button', { name: 'Pause', exact: true }).click();
  await preview.getByLabel('Loop preview').check();
  await preview.getByRole('button', { name: 'Stop / Restart', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('library-runtime-preview.png') });
  await preview.getByRole('button', { name: 'Close preview', exact: true }).click();
  await library.getByRole('button', { name: 'Create Independent Copy', exact: true }).click();
  const copyEditor = await editor(page);
  await expect(copyEditor.locator('#animation-selection')).toHaveValue('sword-cut-variation');
  await copyEditor.getByRole('button', { name: '← Project', exact: true }).click();
  await expect(library.locator('.animation-library-list li')).toHaveCount(2);
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const scene = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await scene.getByLabel('Scene name').fill('Opening');
  await scene.getByRole('button', { name: 'Create Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  const sceneEditor = await editor(page);
  await (await inspectorControl(sceneEditor, '[data-guide-id="scene-add-actor"]')).click();
  await sceneEditor
    .getByRole('dialog', { name: 'Add Actor', exact: true })
    .getByRole('button', { name: 'Add actor', exact: true })
    .click();
  await sceneTimelineGroup(sceneEditor, 'Actions');
  const timeline = sceneEditor.locator('[data-editor-tab-panel="scene-timeline-actions"]');
  await timeline.locator('.animation-library > summary').click();
  await timeline.getByRole('searchbox').fill('variation');
  await timeline.getByRole('button', { name: 'Use Existing Animation', exact: true }).click();
  const token = new URL(sceneEditor.url()).searchParams.get('projectSession')!;
  await expect
    .poll(() =>
      page.evaluate(
        (token) =>
          window
            .paperProjectEditor?.(token)
            ?.scenes?.workingScene?.actions.map((action) => (action.type === 'animation' ? action.animation : '')),
        token,
      ),
    )
    .toEqual(['sword-cut-variation']);
  await sceneEditor.getByRole('button', { name: '← Project', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Project', exact: true }).click();
  const path = await (await pending).path();
  await page.getByLabel('Import Project', { exact: true }).setInputFiles(path);
  await expect(page.getByLabel('Select project').locator('option')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Library Film', exact: true })).toBeVisible();
  const restored = page.getByRole('region', { name: 'Project animation library', exact: true });
  await restored.locator('.animation-library > summary').click();
  await restored.getByRole('searchbox').fill('sword-cut');
  await expect(restored.locator('.animation-library-list li')).toHaveCount(2);
});
