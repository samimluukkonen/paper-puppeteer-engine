import { expect, type Locator, type Page } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationFileAction, animationHierarchy, animationMenuControl, test } from './fixtures.js';

const guides = guideRegistry.getGuidesForEditor('animation');
test.setTimeout(240_000);

async function launch(page: Page, title: string) {
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  await page.getByRole('button', { name: `Start Guide: ${title}`, exact: true }).click();
  return page.getByRole('dialog', { name: title, exact: true });
}

async function aligned(tour: Locator, target: Locator) {
  const hole = tour.locator('.guide-spotlight-hole');
  await expect(hole).toBeVisible();
  await expect
    .poll(async () => {
      // The resolver clips to scroll containers; compare the visible spotlight center with its real target.
      const bounds = await target.boundingBox();
      const spot = await hole.boundingBox();
      if (!bounds || !spot) return false;
      const center = { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2 };
      return (
        center.x >= bounds.x - 4 &&
        center.x <= bounds.x + bounds.width + 4 &&
        center.y >= bounds.y - 4 &&
        center.y <= bounds.y + bounds.height + 4
      );
    })
    .toBe(true);
  await expect(tour.getByRole('status')).toHaveCount(0);
}

for (const existing of [true, false]) {
  test(`every Animation Editor guide preserves authored data and resolves its targets; existing=${existing}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (!existing)
      await page.route('**/animations/idle.json', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          json: { ...animationFileSchema.parse(await response.json()), tracks: {}, ikTracks: {}, events: [] },
        });
      });
    else
      await page.route('**/animations/idle.json', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          json: {
            ...animationFileSchema.parse(await response.json()),
            ikTracks: {
              rightArmIK: [
                { time: 0, x: 22, y: -42 },
                { time: 500, x: 30, y: -30 },
              ],
            },
          },
        });
      });
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    await expect(page.locator('#animation-inspector details[open]')).toHaveCount(0);
    const loggedClip = async () => {
      const logged = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
      await animationFileAction(page, '#animation-log-json', (button) => button.click());
      return animationFileSchema.parse(JSON.parse((await logged).text()));
    };
    const before = await loggedClip();
    if (existing) {
      await (await animationHierarchy(page)).getByRole('button', { name: 'root', exact: true }).click();
      await page.locator('#animation-bone-fields input[data-property="x"]').fill('23');
      await page.getByRole('button', { name: 'Set X key', exact: true }).click();
    }
    const expected = existing ? { ...before, tracks: { ...before.tracks, root: [{ time: 0, x: 23 }] } } : before;
    const dirty = await page.locator('#animation-dirty').textContent();
    const undo = await page.locator('#animation-undo').isEnabled();
    const groundMetadata = () =>
      page.evaluate(() =>
        Object.entries(localStorage).filter(([key]) => key.startsWith('paper-puppeteer:ground-guide:')),
      );
    const metadataBefore = await groundMetadata();
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    for (const guide of guides) {
      if (guide.id === 'animation-ik-targets')
        await page.getByRole('button', { name: 'Select IK target rightArmIK', exact: true }).click();
      await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
      const start = page.getByRole('button', { name: `Start Guide: ${guide.title}`, exact: true });
      if (!existing && ['animation-keyframe-editing', 'animation-ik-baking'].includes(guide.id)) {
        await expect(start).toBeDisabled();
        await page.keyboard.press('Escape');
        continue;
      }
      await start.click();
      const tour = page.getByRole('dialog', { name: guide.title, exact: true });
      for (const [index, step] of guide.steps.entries()) {
        await expect(tour).toContainText(`Step ${index + 1} of ${guide.steps.length}`);
        const target = page.locator(`[data-guide-id="${step.targetId}"]`);
        await expect(target).toHaveCount(1);
        await aligned(tour, target);
        // A previous step's floating menu must not obscure the currently highlighted controls.
        expect(
          await target.evaluate((element) =>
            [
              ...document.querySelectorAll(
                '.animation-workspace [data-workspace-menu][open], .animation-workspace [data-tool-panel][open]',
              ),
            ].every((panel) => panel.contains(element) || element.contains(panel)),
          ),
        ).toBe(true);
        if (step.targetId === 'animation-mirror-actions')
          await expect(page.getByRole('button', { name: 'Mirror Current Pose', exact: true })).toBeInViewport();
        if (step.targetId === 'animation-bake-actions')
          await expect(page.getByRole('button', { name: 'Bake IK', exact: true })).toBeInViewport();
        if (step.targetId === 'animation-ik-inspector')
          await expect(page.locator('#animation-ik-inspector fieldset')).toBeVisible();
        const card = (await tour.locator('.guide-step-card').boundingBox())!;
        const spot = (await tour.locator('.guide-spotlight-hole').boundingBox())!;
        expect(
          card.x >= spot.x + spot.width ||
            card.x + card.width <= spot.x ||
            card.y >= spot.y + spot.height ||
            card.y + card.height <= spot.y,
        ).toBe(true);
        if (existing && (index === Math.min(2, guide.steps.length - 1) || guide.id === 'animation-ground-reference'))
          await page.screenshot({ path: testInfo.outputPath(`${guide.id}-${step.id}.png`) });
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
      await expect(page.locator('#animation-dirty')).toHaveText(dirty!);
      expect(await page.locator('#animation-undo').isEnabled()).toBe(undo);
      expect(downloads).toEqual([]);
      await launch(page, guide.title);
      await page.keyboard.press('Escape');
      await expect(tour).toHaveCount(0);
    }
    expect(await loggedClip()).toEqual(expected);
    expect(await groundMetadata()).toEqual(metadataBefore);
    if (existing) {
      await page.locator('#animation-undo').click();
      expect(await loggedClip()).toEqual(before);
      await page.locator('#animation-redo').click();
      expect(await loggedClip()).toEqual(expected);
    }
  });
}

test('spotlights follow timeline zoom, scroll, expansion, selection, inspector and preview layout; unmount cleans up', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#timeline-zoom').selectOption('4');
  await (await animationMenuControl(page, '#timeline-expand-all')).click();
  let tour = await launch(page, 'Timeline Navigation');
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  const target = page.locator('#timeline-ruler');
  await aligned(tour, target);
  await page.locator('#timeline').evaluate((element) => {
    element.scrollLeft = 100;
    element.scrollTop = 30;
  });
  await aligned(tour, target);
  await page.setViewportSize({ width: 1920, height: 1100 });
  await aligned(tour, target);
  await page.keyboard.press('Escape');
  await page.locator('#animation-selection').selectOption('walk');
  tour = await launch(page, 'Onion Skinning');
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await aligned(tour, page.locator('.animation-onion-panel'));
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await page.locator('#animation-stage').evaluate((element) => {
    (element as HTMLElement).style.transform = 'translateY(12px)';
  });
  await aligned(tour, page.locator('#animation-stage'));
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Rig Editor', exact: true }).click();
  await page.getByRole('link', { name: 'Animation Editor', exact: true }).click();
  tour = await launch(page, 'Create Your First Keyframe');
  await aligned(tour, page.locator('.animation-bone-list'));
  await page.goto('./');
  await expect(page.locator('.guide-spotlight')).toHaveCount(0);
});
