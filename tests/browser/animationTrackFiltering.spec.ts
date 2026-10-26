import { expect, type Page } from '@playwright/test';
import { timelineControl, animationMenuControl, test } from './fixtures.js';

async function openEditor(page: Page) {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(page.locator('#animation-stage canvas')).toBeVisible();
}

test('search, keyed/IK/event filters, expansion and playback preserve the authored timeline', async ({ page }) => {
  await openEditor(page);
  const labels = page.locator('#timeline-track-labels');
  const allBones = await labels.locator('.timeline-bone-track').count();
  await page.getByRole('button', { name: 'Expand torso properties', exact: true }).click();
  await (await timelineControl(page, '#timeline-search')).fill('FOREARM');
  const bones = await labels
    .locator('.timeline-bone-track:visible')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-bone-id')));
  expect(bones).toEqual(['root', 'pelvis', 'torso', 'leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm']);
  await expect(labels.locator('[data-bone-id="torso"][data-filter-context="true"]')).toBeVisible();
  await expect(labels.locator('.timeline-property-track:visible')).toHaveCount(10);
  await (await timelineControl(page, '#timeline-filter')).selectOption('keyed');
  expect(await labels.locator('.timeline-property-track:visible').count()).toBeGreaterThan(0);
  await expect(labels.locator('.timeline-property-track[data-has-keys="false"]:visible')).toHaveCount(0);
  await (await animationMenuControl(page, '#timeline-show-ik')).uncheck();
  await expect(labels.locator('.timeline-ik-track:visible')).toHaveCount(0);
  await (await animationMenuControl(page, '#timeline-collapse-all')).click();
  await expect(labels.locator('.timeline-property-track:visible')).toHaveCount(0);
  await (await animationMenuControl(page, '#timeline-expand-all')).click();
  expect(await labels.locator('.timeline-property-track:visible').count()).toBeGreaterThan(0);
  await (await animationMenuControl(page, '#timeline-show-events')).uncheck();
  await expect(labels.locator('.timeline-event-track')).toBeHidden();
  await page.locator('#timeline-ruler').press('End');
  await page.locator('#reset-time').click();
  await page.locator('#play-pause').click();
  const unchanged = await page.evaluate(async () => {
    let mutations = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    for (const selector of ['#timeline-track-labels', '#timeline-tracks', '#timeline-filter-status'])
      observer.observe(document.querySelector(selector)!, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
    const before = document.querySelector('#current-time')!.textContent;
    for (let frame = 0; frame < 10; frame++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const count = mutations + observer.takeRecords().length;
    observer.disconnect();
    return { count, changed: before !== document.querySelector('#current-time')!.textContent };
  });
  expect(unchanged).toEqual({ count: 0, changed: true });
  await page.locator('#play-pause').click();
  await (await timelineControl(page, '#timeline-search')).fill('missing-track-name');
  await expect(page.locator('#timeline-filter-empty')).toBeVisible();
  await expect(labels.locator('.timeline-track-label:visible')).toHaveCount(0);
  await (await animationMenuControl(page, '#timeline-clear-filters')).click();
  await expect(labels.locator('.timeline-bone-track:visible')).toHaveCount(allBones);
  await expect(labels.locator('.timeline-property-track[data-bone-id="torso"]')).toHaveCount(5);
  await expect(labels.locator('.timeline-property-track[data-bone-id="rightForearm"]')).toHaveCount(0);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('hidden selected keys retain their count, deletion scope and reveal behavior', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    await route.fulfill({
      json: {
        version: 1,
        name: 'idle',
        duration: 2000,
        loop: false,
        tracks: { root: [{ time: 0, x: 1 }], rightForearm: [{ time: 0, rotation: 0.4 }] },
        ikTracks: { rightArmIK: [{ time: 0, x: 60, mix: 0.5 }] },
        events: [{ time: 500, name: 'step' }],
      },
    });
  });
  await openEditor(page);
  for (const bone of ['root', 'rightForearm'])
    await page.getByRole('button', { name: `Expand ${bone} properties`, exact: true }).click();
  await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).click();
  await page
    .getByRole('button', { name: 'Select rightForearm rotation key at 0 s', exact: true })
    .click({ modifiers: ['ControlOrMeta'] });
  await (await timelineControl(page, '#timeline-search')).fill('forearm');
  await expect(page.locator('#timeline-delete-key')).toHaveText('Delete 2 Selected Keys (1 hidden)');
  await expect(page.locator('#timeline-selection-status')).toContainText('Commands affect all selected keys');
  await (await animationMenuControl(page, '#timeline-copy-keys')).click();
  await (await timelineControl(page, '#timeline-reveal-selection')).click();
  await expect(page.locator('#timeline-search')).toHaveValue('');
  await expect(page.locator('.timeline-keyframe[aria-pressed="true"]:visible')).toHaveCount(2);
  await (await timelineControl(page, '#timeline-search')).fill('forearm');
  await (await animationMenuControl(page, '#timeline-delete-key')).click();
  await expect(page.locator('.timeline-keyframe[data-time="0"]')).toHaveCount(0);
  await page.locator('#animation-undo').click();
  await (await animationMenuControl(page, '#timeline-clear-filters')).click();
  await expect(page.locator('.timeline-keyframe[data-time="0"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Expand rightArmIK properties', exact: true }).click();
  await page.getByRole('button', { name: 'Select rightArmIK mix key at 0 s', exact: true }).click();
  await (await animationMenuControl(page, '#timeline-show-ik')).uncheck();
  await expect(page.locator('#timeline-delete-key')).toHaveText('Delete 1 Selected Key (1 hidden)');
  await (await timelineControl(page, '#timeline-reveal-selection')).click();
  await expect(page.getByRole('button', { name: 'Select rightArmIK mix key at 0 s', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Select event step at 0.5 s', exact: true }).click();
  await (await animationMenuControl(page, '#timeline-show-events')).uncheck();
  await expect(page.locator('#timeline-selection-status')).toContainText('1 selected event (hidden)');
  await (await timelineControl(page, '#timeline-reveal-selection')).click();
  await expect(page.getByRole('button', { name: 'Select event step at 0.5 s', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
