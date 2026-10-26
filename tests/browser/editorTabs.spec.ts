import { expect } from '@playwright/test';
import { sceneTimelineGroup, inspectorControl, sceneInspectorGroup, test, timelineControl } from './fixtures.js';

test('scene inspector groups wrap, preserve drafts and reveal selections after collapse', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('scene-editor/');
  await page.getByRole('button', { name: 'New Scene', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'New Scene' })
    .getByRole('button', { name: 'Create scene', exact: true })
    .click();
  const inspector = page.getByRole('complementary', { name: 'Scene inspector' });
  const tabs = inspector.getByRole('tablist', { name: 'Scene inspector groups' });
  const scene = tabs.getByRole('tab', { name: 'Scene', exact: true });
  const actors = tabs.getByRole('tab', { name: 'Actors', exact: true });
  await expect(scene).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.locator('details[open]')).toHaveCount(0);
  await expect(inspector.getByRole('tabpanel')).toHaveCount(1);
  await inspector.getByText('Scene properties', { exact: true }).click();
  const name = inspector.getByLabel('Name', { exact: true });
  const original = await name.elementHandle();
  await name.fill('Unfinished scene name');
  await scene.press('ArrowRight');
  await expect(actors).toBeFocused();
  await expect(actors).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.locator('[data-guide-id="scene-actors"]')).not.toHaveAttribute('open');
  await actors.press('End');
  await expect(tabs.getByRole('tab', { name: 'Transitions', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(scene).toBeFocused();
  await expect(name).toHaveValue('Unfinished scene name');
  expect(await name.evaluate((element, initial) => element === initial, original)).toBe(true);
  await scene.press('End');
  await page.keyboard.press('Home');
  await expect(scene).toBeFocused();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await (
    await inspectorControl(page, '[data-guide-id="scene-actors"]')
  )
    .getByRole('button', { name: '+ Add Actor', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Add Actor', exact: true })
    .getByRole('button', { name: 'Add actor', exact: true })
    .click();
  await expect(actors).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.locator('[data-guide-id="scene-actor-properties"]')).not.toHaveAttribute('open');
  await sceneInspectorGroup(page, 'Scene');
  await inspector.getByRole('button', { name: 'Collapse inspector groups', exact: true }).click();
  await expect(inspector.getByRole('tabpanel')).toHaveCount(0);
  await sceneTimelineGroup(page, 'Actions');
  await page.getByRole('button', { name: 'Add action', exact: true }).click();
  await expect(actors).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.getByRole('tabpanel', { name: 'Actors', exact: true })).toBeVisible();
  await expect(inspector.locator('[data-guide-id="scene-action-properties"]')).not.toHaveAttribute('open');
  await page.locator('#scene-inspector-divider').focus();
  await page.locator('#scene-inspector-divider').press('Home');
  expect(
    await tabs
      .getByRole('tab')
      .evaluateAll((buttons) => new Set(buttons.map((b) => b.getBoundingClientRect().top)).size),
  ).toBeGreaterThan(1);
  const bounds = (await tabs.boundingBox())!;
  for (const tab of await tabs.getByRole('tab').all()) {
    const box = (await tab.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await page.screenshot({ path: info.outputPath('scene-inspector-groups.png') });
});

test('timeline tabs preserve filters and preferences, support keys and keep playback visible', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const timeline = page.getByRole('region', { name: 'Animation timeline', exact: true });
  const tabs = timeline.getByRole('tablist', { name: 'Timeline tools' });
  const tracks = tabs.getByRole('tab', { name: 'Tracks & keys', exact: true });
  const view = tabs.getByRole('tab', { name: 'View', exact: true });
  const snapping = tabs.getByRole('tab', { name: 'Snapping', exact: true });
  const search = page.locator('#timeline-search');
  const searchHost = await search.elementHandle();
  await expect(tracks).toHaveAttribute('aria-selected', 'true');
  await expect(timeline.getByRole('tabpanel')).toHaveCount(0);
  expect((await timeline.locator('.editor-tabs-heading').boundingBox())!.height).toBeLessThanOrEqual(44);
  const inset = page.locator('.timeline-inset');
  const initialHeight = (await inset.boundingBox())!.height;
  await tracks.click();
  await expect(timeline.getByRole('tabpanel')).toHaveCount(1);
  await search.fill('root');
  await tracks.focus();
  await tracks.press('ArrowRight');
  await expect(view).toBeFocused();
  await page.locator('#timeline-zoom').selectOption('4');
  await view.focus();
  await view.press('End');
  await expect(snapping).toBeFocused();
  await page.locator('#timeline-snap-enabled').check();
  await page.locator('#timeline-snap-events').uncheck();
  await snapping.focus();
  await snapping.press('ArrowRight');
  await expect(tracks).toBeFocused();
  await expect(search).toHaveValue('root');
  expect(await search.evaluate((element, original) => element === original, searchHost)).toBe(true);
  const expandedHeight = (await inset.boundingBox())!.height;
  expect(initialHeight).toBeGreaterThan(expandedHeight + 20);
  await timeline.getByRole('button', { name: 'Collapse timeline tools', exact: true }).click();
  await expect(timeline.getByRole('tabpanel')).toHaveCount(0);
  expect((await inset.boundingBox())!.height).toBeGreaterThan(expandedHeight + 20);
  for (const id of ['play-pause', 'reset-time', 'preview-loop', 'timeline-time-input', 'graph-toggle'])
    await expect(page.locator(`#${id}`)).toBeVisible();
  await page.locator('#timeline-ruler').focus();
  await page.locator('#timeline-ruler').press('-');
  await expect(page.locator('#timeline-zoom')).toHaveValue('2');
  await view.click();
  await expect(page.locator('#timeline-zoom')).toHaveValue('2');
  await view.press('ArrowRight');
  await expect(page.locator('#timeline-snap-enabled')).toBeChecked();
  await expect(page.locator('#timeline-snap-events')).not.toBeChecked();
  await snapping.press('Home');
  await expect(tracks).toBeFocused();
  await expect(search).toHaveValue('root');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await timeline.getByRole('button', { name: 'Collapse timeline tools', exact: true }).click();
  await page.screenshot({ path: info.outputPath('animation-timeline-tabs.png') });
});

test('timeline guides reveal the appropriate tool tab after collapse', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(page.getByRole('button', { name: 'Expand timeline tools', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.getByRole('button', { name: 'Start Guide: Timeline Navigation', exact: true }).click();
  const tour = page.getByRole('dialog', { name: 'Timeline Navigation', exact: true });
  const next = tour.getByRole('button', { name: 'Next', exact: true });
  for (let step = 0; step < 3; step++) await next.click();
  const tabs = page.getByRole('tablist', { name: 'Timeline tools' });
  await expect(tabs.getByRole('tab', { name: 'View', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#timeline-zoom')).toBeVisible();
  await expect(tour.getByRole('status')).toHaveCount(0);
  await next.click();
  await expect(tabs.getByRole('tab', { name: 'Tracks & keys', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#timeline-search')).toBeVisible();
  await next.click();
  await expect(tabs.getByRole('tab', { name: 'View', exact: true })).toHaveAttribute('aria-selected', 'true');
  await tour.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('rig inspector tabs wrap, preserve drafts and support keyboard navigation', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  const inspector = page.locator('#rig-inspector');
  const tabs = inspector.getByRole('tablist', { name: 'Rig inspector sections' });
  const hierarchy = tabs.getByRole('tab', { name: 'Hierarchy', exact: true });
  const selection = tabs.getByRole('tab', { name: 'Selection details', exact: true });
  const reset = tabs.getByRole('tab', { name: 'Reset', exact: true });
  await expect(hierarchy).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.getByRole('tabpanel', { name: 'Hierarchy', exact: true })).toBeVisible();
  await expect(inspector.getByRole('tabpanel')).toHaveCount(1);
  const tree = inspector.getByRole('tree');
  const original = await tree.elementHandle();
  const head = tree.getByRole('treeitem', { name: 'head', exact: true });
  await head.click();
  await expect(head).toBeFocused();
  await expect(hierarchy).toHaveAttribute('aria-selected', 'true');
  await selection.click();
  const x = inspector.locator('input[data-scope="bone"][data-field="x"]');
  await x.fill('12');
  await x.blur();
  await hierarchy.click();
  const boneId = inspector.getByLabel('New bone ID', { exact: true });
  await boneId.fill('draft-bone');
  await hierarchy.press('End');
  await expect(reset).toBeFocused();
  await expect(reset).toHaveAttribute('aria-selected', 'true');
  await reset.press('ArrowRight');
  await expect(hierarchy).toBeFocused();
  await expect(boneId).toHaveValue('draft-bone');
  expect(await tree.evaluate((element, initial) => element === initial, original)).toBe(true);
  await hierarchy.press('ArrowRight');
  await expect(selection).toBeFocused();
  await expect(x).toHaveValue('12');
  await page.locator('#undo').click();
  await expect(x).toHaveValue('0');
  await page.locator('#redo').click();
  await expect(x).toHaveValue('12');
  await inspector.getByRole('button', { name: 'Collapse inspector sections', exact: true }).click();
  await expect(inspector.getByRole('tabpanel')).toHaveCount(0);
  // The desktop divider can leave only 320px for the left column.
  await page.locator('#rig-preview-divider').focus();
  await page.locator('#rig-preview-divider').press('End');
  await expect
    .poll(() =>
      tabs.getByRole('tab').evaluateAll((buttons) => new Set(buttons.map((b) => b.getBoundingClientRect().top)).size),
    )
    .toBeGreaterThan(1);
  const bounds = (await tabs.boundingBox())!;
  for (const tab of await tabs.getByRole('tab').all()) {
    const box = (await tab.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  await hierarchy.click();
  await expect(boneId).toHaveValue('draft-bone');
  await page.screenshot({ path: info.outputPath('rig-inspector-wrapped-tabs.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

test('animation inspector tabs wrap, retain drafts and skip inactive mode tabs', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const inspector = page.locator('#animation-inspector');
  const tabs = inspector.getByRole('tablist', { name: 'Animation inspector sections' });
  const bones = tabs.getByRole('tab', { name: 'Bones', exact: true });
  const selection = tabs.getByRole('tab', { name: 'Selection details', exact: true });
  await expect(bones).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.getByRole('tabpanel')).toHaveCount(1);
  await expect(inspector.getByRole('tabpanel', { name: 'Bones', exact: true })).toBeVisible();
  const hierarchy = page.locator('#animation-bones');
  const hierarchyHost = await hierarchy.elementHandle();
  await hierarchy.getByRole('button', { name: 'head', exact: true }).click();
  await expect(bones).toHaveAttribute('aria-selected', 'true');
  await hierarchy.getByRole('button', { name: 'head', exact: true }).press('ArrowDown');
  await expect(hierarchy.locator(':focus')).toHaveCount(1);
  await selection.click();
  const x = page.locator('#animation-bone-fields input[data-property="x"]');
  await x.fill('23');
  await expect(x).toHaveAttribute('data-temporary', 'true');
  const fieldHost = await x.elementHandle();
  await tabs.getByRole('tab', { name: 'Environment Preview', exact: true }).click();
  const camera = inspector.locator('.environment-camera-panel');
  await expect(camera).not.toHaveAttribute('open');
  await camera.locator('summary').click();
  await camera.getByLabel('Camera X', { exact: true }).fill('417');
  await selection.click();
  await expect(x).toHaveValue('23');
  await tabs.getByRole('tab', { name: 'Environment Preview', exact: true }).click();
  await expect(camera.getByLabel('Camera X', { exact: true })).toHaveValue('417');
  await selection.click();
  await page.locator('#animation-cancel-transform').click();
  await tabs.getByRole('tab', { name: 'Environment Preview', exact: true }).click();
  await page.locator('#editor-mode').selectOption('rig-tweak');
  await expect(tabs.getByRole('tab', { name: 'Rig Tweak', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await tabs.getByRole('tab', { name: 'Rig Tweak', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(tabs.getByRole('tab', { name: 'Attachments & skins', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Rig Tweak', exact: true })).toBeFocused();
  await page.locator('#editor-mode').selectOption('animation');
  await tabs.getByRole('tab', { name: 'Environment Preview', exact: true }).click();
  await expect(camera.getByLabel('Camera X', { exact: true })).toHaveValue('417');
  expect(await hierarchy.evaluate((element, initial) => element === initial, hierarchyHost)).toBe(true);
  expect(await x.evaluate((element, initial) => element === initial, fieldHost)).toBe(true);
  await bones.focus();
  await bones.press('ArrowRight');
  await expect(selection).toBeFocused();
  await selection.press('End');
  await expect(tabs.getByRole('tab', { name: 'Artwork import & replacement', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(bones).toBeFocused();
  await inspector.getByRole('button', { name: 'Collapse inspector sections', exact: true }).click();
  await expect(inspector.getByRole('tabpanel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select root motion', exact: true }).click();
  await expect(tabs.getByRole('tab', { name: 'Root Motion', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Select IK target rightArmIK', exact: true }).click();
  await expect(tabs.getByRole('tab', { name: 'IK target', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#animation-ik-inspector')).toBeVisible();
  await selection.click();
  await expect(page.locator('#animation-selection-empty')).toBeVisible();
  await inspector.getByRole('button', { name: 'Collapse inspector sections', exact: true }).click();
  // Event creation must reveal Selection details before focusing the new field.
  await (await timelineControl(page, '#timeline-add-event')).click();
  await expect(selection).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#animation-event-name')).toBeFocused();
  await expect(page.locator('#animation-event-name')).toHaveValue('event');
  await page.locator('#animation-preview-divider').focus();
  await page.locator('#animation-preview-divider').press('End');
  expect(
    await tabs
      .getByRole('tab')
      .evaluateAll((buttons) => new Set(buttons.map((b) => b.getBoundingClientRect().top)).size),
  ).toBeGreaterThan(1);
  const bounds = (await tabs.boundingBox())!;
  for (const tab of await tabs.getByRole('tab').all()) {
    const box = (await tab.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await page.screenshot({ path: info.outputPath('animation-inspector-wrapped-tabs.png') });
});

for (const editor of ['rig', 'animation', 'scene'] as const) {
  test(`${editor} tabs preserve controls, support keys and reclaim desktop height`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${editor}-editor/`);
    if (editor !== 'scene')
      await expect(page.locator(editor === 'rig' ? '#validation' : '#animation-status')).toHaveText('Validation: OK');
    const tabs = page.getByRole('tablist', {
      name: `${editor === 'rig' ? 'Rig' : editor === 'animation' ? 'Animation' : 'Scene'} editor controls`,
    });
    const edit = tabs.getByRole('tab', { name: 'Edit', exact: true });
    const draft = tabs.getByRole('tab', { name: 'Local draft', exact: true });
    const panel = page.locator(`#${editor}-edit-panel`);
    await expect(edit).toHaveAttribute('aria-selected', 'true');
    const control =
      editor === 'rig'
        ? page.locator('#grid-snap')
        : editor === 'animation'
          ? page.locator('#animation-selection')
          : page.getByLabel('Select scene');
    const original = await control.elementHandle();
    if (editor === 'rig') await control.selectOption('5');
    if (editor === 'animation') await control.selectOption('walk');
    const chrome = tabs.locator('..').locator('..');
    const expandedHeight = (await chrome.boundingBox())!.height;
    await page.getByRole('button', { name: 'Collapse editor controls', exact: true }).click();
    await expect(panel).toBeHidden();
    expect((await chrome.boundingBox())!.height).toBeLessThan(expandedHeight - 20);
    await edit.focus();
    await edit.press('End');
    await expect(draft).toBeFocused();
    await expect(draft).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Local save status')).toBeVisible();
    await expect(panel).toBeHidden();
    await draft.press('Home');
    await expect(edit).toBeFocused();
    await expect(panel).toBeVisible();
    expect(await control.evaluate((element, initial) => element === initial, original)).toBe(true);
    if (editor === 'rig') await expect(control).toHaveValue('5');
    if (editor === 'animation') await expect(control).toHaveValue('walk');
    await edit.press('ArrowLeft');
    await expect(draft).toBeFocused();
    await draft.press('ArrowRight');
    await expect(edit).toBeFocused();
    if (editor !== 'scene') {
      await tabs.getByRole('tab', { name: 'Character package', exact: true }).click();
      await expect(page.locator('.package-tools')).toBeVisible();
      await expect(panel).toBeHidden();
      await edit.click();
    }
    await expect(
      page.locator(editor === 'scene' ? '.scene-inspector details[open]' : `#${editor}-inspector details[open]`),
    ).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
    expect(errors).toEqual([]);
  });
}

test('tab reveal opens a hidden panel while controls are collapsed', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Collapse editor controls', exact: true }).click();
  await page.locator('#rig-package-panel').evaluate((panel) => {
    panel.dispatchEvent(new CustomEvent('workspace:reveal-tab', { bubbles: true, detail: 'rig-package' }));
  });
  await expect(page.getByRole('tab', { name: 'Character package', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.package-tools')).toBeVisible();
});

test('Project Workspace shares tabs and keeps local save controls behind Local draft', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('project/');
  const tabs = page.getByRole('tablist', { name: 'Project workspace controls' });
  await expect(tabs.getByRole('tab', { name: 'Project', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
  await dialog.getByLabel('Project name').fill('Tab workspace');
  await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tab workspace', exact: true })).toBeVisible();
  await expect(page.getByLabel('Local save status')).toBeHidden();
  await tabs.getByRole('tab', { name: 'Local draft', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Project', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Collapse editor controls', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toBeHidden();
  await tabs.getByRole('tab', { name: 'Project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export Project', exact: true })).toBeVisible();
  await expect(page.locator('.project-settings')).not.toHaveAttribute('open');
  await page.screenshot({ path: info.outputPath('project-tabs.png') });
});

test('startup recovery stays visible when the Local draft tab is inactive', async ({ page }) => {
  await page.goto('project/');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New Project', exact: true });
  await create.getByLabel('Project name').fill('Recovered tabs');
  await create.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved work?', exact: true });
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: 'Close recovery', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Project', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Project', exact: true })).toBeVisible();
});

test('Feature Guide reveals the Character package tab without changing editor data', async ({ page }) => {
  await page.goto('rig-editor/');
  await expect(page.locator('#validation')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Collapse editor controls', exact: true }).click();
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.getByRole('button', { name: 'Start Guide: Creating a New Character', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'Creating a New Character', exact: true });
  await guide.getByRole('button', { name: 'Next', exact: true }).click();
  await guide.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Character package', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.package-tools')).toBeVisible();
  await expect(guide.locator('.guide-spotlight-hole')).toBeVisible();
  await guide.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#dirty-status')).toHaveText('No changes');
});

test('scene timeline tabs reclaim track space and retain controls across collapse and keyboard navigation', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('scene-editor/');
  await page.getByRole('button', { name: 'New Scene', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'New Scene' })
    .getByRole('button', { name: 'Create scene', exact: true })
    .click();
  const timeline = page.getByRole('region', { name: 'Scene timeline', exact: true });
  const tabs = timeline.getByRole('tablist', { name: 'Scene timeline tools' });
  const actions = tabs.getByRole('tab', { name: 'Actions', exact: true });
  const view = tabs.getByRole('tab', { name: 'View', exact: true });
  const tracks = page.getByLabel('Action tracks', { exact: true });
  await page.getByRole('separator', { name: 'Scene timeline height', exact: true }).press('Home');
  await expect(actions).toHaveAttribute('aria-selected', 'true');
  await expect(timeline.getByRole('tabpanel')).toHaveCount(0);
  await expect(timeline.getByRole('tabpanel', { includeHidden: true })).toHaveCount(6);
  expect((await timeline.locator('.editor-tabs-heading').boundingBox())!.height).toBeLessThanOrEqual(44);
  const collapsedHeight = (await tracks.boundingBox())!.height;
  expect(collapsedHeight).toBeGreaterThan(160);
  await actions.click();
  const kind = page.getByRole('combobox', { name: 'Action type', exact: true });
  const original = await kind.elementHandle();
  await kind.selectOption('wait');
  await actions.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Camera', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Set Camera Key', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('combobox', { name: 'Effect type', exact: true }).selectOption('fade-out');
  await sceneTimelineGroup(page, 'Audio');
  await page.getByRole('combobox', { name: 'Track category', exact: true }).selectOption('voice');
  await page.getByLabel('Mute preview audio', { exact: true }).check();
  await sceneTimelineGroup(page, 'View');
  await page.getByLabel('Timeline zoom', { exact: true }).fill('4');
  await page.getByLabel('Snap', { exact: true }).uncheck();
  await page.getByLabel('Scene playback speed', { exact: true }).selectOption('0.5');
  await expect(timeline.locator('.scene-timeline-help')).not.toHaveAttribute('open');
  expect((await tracks.boundingBox())!.height).toBeLessThan(collapsedHeight - 20);
  await timeline.getByRole('button', { name: 'Collapse scene timeline controls', exact: true }).click();
  await expect(timeline.getByRole('tabpanel')).toHaveCount(0);
  expect((await tracks.boundingBox())!.height).toBeCloseTo(collapsedHeight, 0);
  for (const name of ['Play', 'Restart', 'Stop'])
    await expect(timeline.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByLabel('Playhead (s)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Scene playback status', { exact: true })).toBeVisible();
  await view.press('ArrowRight');
  await expect(actions).toBeFocused();
  await expect(kind).toHaveValue('wait');
  expect(await kind.evaluate((element, initial) => element === initial, original)).toBe(true);
  await actions.press('End');
  await expect(view).toBeFocused();
  await expect(page.getByLabel('Timeline zoom', { exact: true })).toHaveValue('4');
  await expect(page.getByLabel('Snap', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Scene playback speed', { exact: true })).toHaveValue('0.5');
  await view.press('Home');
  await expect(actions).toBeFocused();
  await sceneTimelineGroup(page, 'Transitions');
  await expect(page.getByRole('combobox', { name: 'Effect type', exact: true })).toHaveValue('fade-out');
  await sceneTimelineGroup(page, 'Audio');
  await expect(page.getByRole('combobox', { name: 'Track category', exact: true })).toHaveValue('voice');
  await expect(page.getByLabel('Mute preview audio', { exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.locator('.scene-inspector details[open]')).toHaveCount(0);
  await timeline.getByRole('button', { name: 'Collapse scene timeline controls', exact: true }).click();
  await page.screenshot({ path: info.outputPath('scene-timeline-tabs.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
  expect((await tracks.boundingBox())!.height).toBeGreaterThanOrEqual(120);
});
