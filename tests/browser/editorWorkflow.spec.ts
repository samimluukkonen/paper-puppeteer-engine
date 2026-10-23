import { expect, type Frame, type Page } from '@playwright/test';
import { test } from './fixtures.js';
test.use({ actionTimeout: 15_000 });

async function activeFrame(page: Page): Promise<Frame> {
  const element = await page.locator('iframe:visible').elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error('Missing project editor frame.');
  return frame;
}

test('workspace guides, editor identity, native focus, export access and live rig context at desktop sizes', async ({
  page,
}) => {
  await page.goto('project/');
  await expect(page.getByRole('heading', { name: 'No project open' })).toBeVisible();
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const projectGuide = page.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await expect(projectGuide).toContainText('Create a project and add a character');
  await expect(projectGuide.locator('.feature-guide-categories button')).toHaveCount(3);
  await expect(projectGuide.getByRole('button', { name: 'Start Guide: Creating Bones', exact: true })).toBeDisabled();
  await projectGuide.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'New Project', exact: true });
  await project.getByLabel('Project name').fill('Forest Story');
  await project.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Character', exact: true }).click();
  const character = page.getByRole('dialog', { name: 'New Character', exact: true });
  await character.getByLabel('Character name').fill('Hero');
  await character.getByRole('button', { name: 'Create Character', exact: true }).click();
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('project-feature-guide.png') });
  await projectGuide.getByRole('button', { name: 'Start Guide: Creating Bones', exact: true }).click();
  const frame = await activeFrame(page);
  await expect(frame.getByRole('button', { name: 'Exit', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Exit', exact: true }).click();
  await frame.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const catalog = frame.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await expect(catalog).toBeVisible();
  await expect(catalog.getByRole('button', { name: 'Rig Editor', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(frame.locator('#validation')).toHaveText('Validation: OK');
  await expect(frame.getByRole('region', { name: 'Editor context' })).toContainText('Project: Forest Story');
  await expect(frame.getByRole('region', { name: 'Editor context' })).toContainText('Character: Hero');
  // The Creating Bones tour explicitly reveals its hierarchy target. Other panels stay collapsed.
  const revealed = frame.locator('#rig-inspector details[open]');
  await expect(revealed).toHaveCount(1);
  await expect(revealed.locator('#hierarchy')).toBeVisible();
  await revealed.locator(':scope > summary').click();
  await expect(frame.locator('#rig-inspector details[open]')).toHaveCount(0);
  await expect(frame.getByText('No artwork assigned.', { exact: false })).toBeVisible();
  for (const details of await frame.locator('#hierarchy').locator('xpath=ancestor::details').all())
    await details.evaluate((node) => {
      (node as HTMLDetailsElement).open = true;
    });
  await frame.getByRole('treeitem', { name: 'root', exact: true }).click();
  // Real controls retain native keyboard behavior; no export dialog steals their focus.
  const x = frame.locator('#inspector [data-scope=bone][data-field=x]');
  for (const details of await x.locator('xpath=ancestor::details').all())
    await details.evaluate((node) => {
      (node as HTMLDetailsElement).open = true;
    });
  await x.fill('42');
  await x.press('Control+s');
  await expect(frame.locator('#rig-tools-dialog')).not.toBeVisible();
  await x.blur();
  const heading = frame.getByRole('heading', { name: 'Rig Editor Bind Pose', exact: true });
  await heading.focus();
  await heading.press('Control+z');
  await expect(x).toHaveValue('0');
  await heading.press('Control+y');
  await expect(x).toHaveValue('42');
  await heading.press('Control+s');
  await expect(frame.locator('#rig-tools-dialog')).toBeVisible();
  await frame.locator('#rig-tools-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await frame.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  await expect(frame.getByRole('region', { name: 'Editor context' })).toContainText('Editor: Animation');
  await expect(frame.locator('canvas')).toHaveCount(1);
  await expect(frame.locator('#animation-status')).toContainText('Choose + New Animation');
  await frame.getByRole('button', { name: '+ New Animation', exact: true }).click();
  const clip = frame.getByRole('dialog', { name: 'Create new animation', exact: true });
  await clip.getByLabel('Animation name / ID').fill('walk-cycle');
  await clip.getByRole('button', { name: 'Create Animation', exact: true }).click();
  await expect(frame.getByRole('region', { name: 'Editor context' })).toContainText('Animation: walk-cycle');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(frame.getByRole('button', { name: 'Feature Guide', exact: true })).toBeInViewport();
  await expect(frame.locator('#animation-stage canvas')).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('animation-desktop.png') });
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await expect(page.getByText('hero · Document modified')).toBeVisible();
  await page.getByText('Project Settings', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Forest Story Revised');
  await page.getByRole('button', { name: 'Apply name', exact: true }).click();
  await page.getByRole('button', { name: 'Rig Editor', exact: true }).click();
  await expect(frame.getByRole('region', { name: 'Editor context' })).toContainText('Project: Forest Story Revised');
  await expect(x).toHaveValue('42');
  await frame.getByRole('button', { name: '← Project', exact: true }).click();
  await page.getByRole('button', { name: '+ New Scene', exact: true }).click();
  const scene = page.getByRole('dialog', { name: 'New Scene', exact: true });
  await scene.getByLabel('Scene name').fill('Opening');
  await scene.getByRole('button', { name: 'Create Scene', exact: true }).click();
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await projectGuide.getByRole('button', { name: 'Scene Editor', exact: true }).click();
  await projectGuide.getByRole('button', { name: 'Start Guide: Adding an Actor', exact: true }).click();
  const sceneFrame = await activeFrame(page);
  await expect(sceneFrame.getByRole('button', { name: 'Exit', exact: true })).toBeVisible();
  await sceneFrame.getByRole('button', { name: 'Exit', exact: true }).click();
  await sceneFrame.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const sceneCatalog = sceneFrame.getByRole('dialog', { name: 'Feature Guide', exact: true });
  await expect(sceneCatalog).toBeVisible();
  await expect(sceneCatalog.getByRole('button', { name: 'Scene Editor', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await sceneCatalog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sceneFrame.locator('.scene-inspector details[open]')).toHaveCount(0);
  await expect(sceneFrame.getByRole('region', { name: 'Editor context' })).toContainText('Scene: Opening');
  await sceneFrame.getByRole('button', { name: '+ Add Actor', exact: true }).click();
  await sceneFrame
    .getByRole('dialog', { name: 'Add Actor', exact: true })
    .getByRole('button', { name: 'Add actor', exact: true })
    .click();
  await expect(sceneFrame.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await sceneFrame.getByRole('combobox', { name: 'Action type', exact: true }).selectOption('wait');
  await sceneFrame.getByRole('button', { name: 'Add action', exact: true }).click();
  const tracks = sceneFrame.getByLabel('Action tracks', { exact: true });
  await tracks.focus();
  await tracks.press('Delete');
  await expect(sceneFrame.locator('.scene-action')).toHaveCount(0);
  await tracks.press('Control+z');
  await expect(sceneFrame.locator('.scene-action')).toHaveCount(1);
  await tracks.press('Control+y');
  await expect(sceneFrame.locator('.scene-action')).toHaveCount(0);
  await tracks.press('Control+z');
  await tracks.press('Space');
  await expect(sceneFrame.getByLabel('Scene playback status')).toContainText('playing');
  await tracks.press('Space');
  await expect(sceneFrame.getByLabel('Scene playback status')).toContainText('paused');
  const download = page.waitForEvent('download');
  await tracks.press('Control+s');
  await download;
  await expect(sceneFrame.getByRole('region', { name: 'Editor context' })).toContainText(
    'Matches loaded / exported checkpoint',
  );
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  await page.screenshot({ path: test.info().outputPath('scene-desktop.png') });
});
