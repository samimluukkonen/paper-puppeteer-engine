import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { animationControl, animationFileAction, selectAnimationBone, test } from './fixtures.js';

async function exported(page: Page): Promise<unknown> {
  const pending = page.waitForEvent('download');
  await (await animationControl(page, '#animation-download')).click();
  const path = await (await pending).path();
  if (!path) throw new Error('Missing exported animation');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

test('create, preview/cancel, edit independently, undo/redo and reload a scaled variation', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    const source = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      json: {
        ...source,
        duration: 1000,
        loop: false,
        playback: { mode: 'smooth' },
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 1000, x: 50 },
          ],
        },
        events: [{ time: 250, name: 'impact', data: { damage: [2, 3] } }],
        ikTracks: {
          rightArmIK: [
            { time: 0, mix: 0 },
            { time: 1000, mix: 0.5 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  const source = await exported(page);
  const dialog = page.locator('#animation-variation-dialog');
  await page.locator('#animation-variation').click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Source: idle');
  await dialog.getByLabel('Time scale', { exact: true }).fill('2');
  await dialog.getByLabel('Preview position').fill('0.75');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await page.screenshot({ path: test.info().outputPath('variation-preview.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(await exported(page)).toEqual(source);

  await page.locator('#animation-variation').click();
  await dialog.getByLabel('New name / ID').fill('idle');
  await dialog.getByRole('button', { name: 'Create Variation', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('already registered');
  await dialog.getByLabel('New name / ID').fill('idle-heavy');
  await dialog.getByLabel('Time scale', { exact: true }).fill('2');
  await dialog.getByRole('button', { name: 'Create Variation', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#animation-selection')).toHaveValue('idle-heavy');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-selection option:checked')).toContainText('New');
  expect(await exported(page)).toMatchObject({
    name: 'idle-heavy',
    duration: 2000,
    events: [{ time: 500, name: 'impact', data: { damage: [2, 3] } }],
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 2000, x: 50 },
      ],
    },
    ikTracks: {
      rightArmIK: [
        { time: 0, mix: 0 },
        { time: 2000, mix: 0.5 },
      ],
    },
  });
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).click();
  await page.locator('#graph-toggle').click();
  await page.locator('#graph-key-value').fill('10');
  await page.locator('#graph-apply').click();
  await page.locator('#graph-interpolation').selectOption('bezier');
  await expect(page.locator('.graph-handle')).toHaveCount(2);
  const authored = await exported(page);
  await page.locator('#animation-undo').click();
  await expect(page.locator('.graph-handle')).toHaveCount(0);
  await page.locator('#animation-redo').click();
  await expect(page.locator('.graph-handle')).toHaveCount(2);
  expect(await exported(page)).toEqual(authored);
  await animationFileAction(page, '#animation-reload-export', (control) => control.click());
  expect(await exported(page)).toEqual(authored);
  await page.locator('#animation-selection').selectOption('idle');
  expect(await exported(page)).toEqual(source);
  await page.locator('#animation-selection').selectOption('idle-heavy');
  await page.locator('#animation-variation').click();
  await dialog.getByRole('button', { name: 'Create Variation', exact: true }).click();
  await expect(page.locator('#animation-selection')).toHaveValue('idle-heavy-variation');
});

for (const draft of [false, true]) {
  test(`variation Feature Guide highlights controls without creating or previewing; draft=${draft}`, async ({
    page,
  }) => {
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    const json = async () => {
      const logged = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
      await animationFileAction(page, '#animation-log-json', (button) => button.click());
      return (await logged).text();
    };
    if (draft) {
      await selectAnimationBone(page, 'root');
      await page.locator('#animation-bone-fields input[data-property="x"]').fill('23');
      await page.getByRole('button', { name: 'Set X key', exact: true }).click();
    }
    const before = await json();
    if (draft) {
      await page.locator('#timeline-time-input').fill('0.25');
      await page.locator('#timeline-time-input').press('Tab');
      await page.locator('#animation-bone-fields input[data-property="x"]').fill('41');
      await expect(page.locator('#animation-variation')).toBeDisabled();
    }
    const ids = () =>
      page
        .locator('#animation-selection option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    const beforeIds = await ids();
    const selection = await page.locator('#animation-selection').inputValue();
    const time = await page.locator('#current-time').textContent();
    const dirty = await page.locator('#animation-dirty').textContent();
    const undo = await page.locator('#animation-undo').isEnabled();
    const redo = await page.locator('#animation-redo').isEnabled();
    let downloads = 0;
    page.on('download', () => downloads++);
    const guide = guideRegistry.getGuideById('animation-variation')!;
    const launch = async () => {
      await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
      await page.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true }).click();
      return page.getByRole('dialog', { name: guide.title, exact: true });
    };
    const tour = await launch();
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour).toContainText(`Step ${index + 1} of ${guide.steps.length}`);
      const target = page.locator(`[data-guide-id="${step.targetId}"]`);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
      await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
      await expect
        .poll(async () => {
          const control = await target.boundingBox();
          const hole = await tour.locator('.guide-spotlight-hole').boundingBox();
          if (!control || !hole) return false;
          const x = hole.x + hole.width / 2,
            y = hole.y + hole.height / 2;
          return (
            x >= control.x - 4 &&
            x <= control.x + control.width + 4 &&
            y >= control.y - 4 &&
            y <= control.y + control.height + 4
          );
        })
        .toBe(true);
      await expect(tour.getByRole('status')).toHaveCount(0);
      await expect(tour.getByRole('button', { name: 'Try It', exact: true })).toHaveCount(0);
      await expect(page.locator('#animation-variation-dialog')).not.toBeVisible();
      await expect(page.locator('#animation-selection')).toHaveValue(selection);
      if (index === 1) {
        await tour.getByRole('button', { name: 'Back', exact: true }).click();
        await tour.getByRole('button', { name: 'Next', exact: true }).click();
      }
      await tour
        .getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true })
        .click();
    }
    await expect(tour).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
    await launch();
    await page.keyboard.press('Escape');
    await expect(tour).toHaveCount(0);
    expect(await ids()).toEqual(beforeIds);
    await expect(page.locator('#current-time')).toHaveText(time!);
    await expect(page.locator('#animation-dirty')).toHaveText(dirty!);
    expect(await page.locator('#animation-undo').isEnabled()).toBe(undo);
    expect(await page.locator('#animation-redo').isEnabled()).toBe(redo);
    if (draft) {
      await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveValue('41');
      await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveAttribute(
        'data-temporary',
        'true',
      );
    }
    expect(downloads).toBe(0);
    expect(await json()).toBe(before);
  });
}

test('variation Feature Guide explains the missing source prerequisite', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('');
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start Guide: Create an Animation Variation', exact: true });
  await expect(start).toBeDisabled();
  await expect(start.locator('..')).toContainText('Create or select an animation first.');
});
