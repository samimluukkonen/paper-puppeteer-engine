import { expect } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationFileAction, test } from './fixtures.js';

for (const selected of [false, true]) {
  test(`Graph Editor Feature Guide reveals real controls without authoring; selection=${selected}`, async ({
    page,
  }) => {
    await page.route('**/animations/idle.json', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        json: {
          ...animationFileSchema.parse(await response.json()),
          duration: 1000,
          playback: { mode: 'smooth' },
          events: [],
          ikTracks: {},
          tracks: selected
            ? {
                root: [
                  {
                    time: 0,
                    x: 0,
                    curves: { x: { mode: 'bezier', control1: { x: 0.3, y: 0 }, control2: { x: 0.7, y: 1 } } },
                  },
                  { time: 1000, x: 10 },
                ],
              }
            : {},
        },
      });
    });
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    const json = async () => {
      const logged = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
      await animationFileAction(page, '#animation-log-json', (button) => button.click());
      return (await logged).text();
    };
    const before = await json();
    if (selected) {
      await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
      await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).click();
      await page.locator('#timeline-time-input').fill('0.25');
      await page.locator('#timeline-time-input').press('Tab');
      await page.locator('#animation-bone-fields input[data-property="x"]').fill('41');
    }
    const time = await page.locator('#current-time').textContent();
    const dirty = await page.locator('#animation-dirty').textContent();
    const undo = await page.locator('#animation-undo').isEnabled();
    let downloads = 0;
    page.on('download', () => downloads++);
    await expect(page.locator('#graph-editor')).toBeHidden();
    const launch = async (title: string) => {
      await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
      await page.getByRole('button', { name: `Start Guide: ${title}`, exact: true }).click();
      return page.getByRole('dialog', { name: title, exact: true });
    };
    const guide = guideRegistry.getGuideById('animation-graph-editor')!;
    const tour = await launch(guide.title);
    for (const [index, step] of guide.steps.entries()) {
      await expect(tour).toContainText(`Step ${index + 1} of ${guide.steps.length}`);
      const target = page.locator(`[data-guide-id="${step.targetId}"]`);
      await expect(target).toBeVisible();
      await expect(tour.locator('.guide-spotlight-hole')).toBeVisible();
      await expect
        .poll(async () => {
          const control = await target.boundingBox();
          const spotlight = await tour.locator('.guide-spotlight-hole').boundingBox();
          if (!control || !spotlight) return false;
          const x = spotlight.x + spotlight.width / 2;
          const y = spotlight.y + spotlight.height / 2;
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
      if (index === 1) {
        await expect(page.locator('#graph-editor')).toBeVisible();
        if (!selected) await expect(page.locator('#graph-status')).toContainText('Select a bone or IK constraint');
        await tour.getByRole('button', { name: 'Back', exact: true }).click();
        await tour.getByRole('button', { name: 'Next', exact: true }).click();
      }
      if (index === 4) {
        await expect(page.locator('.graph-tangent-details')).toHaveAttribute('open', '');
        if (selected) await page.screenshot({ path: test.info().outputPath('graph-editor-feature-guide.png') });
      }
      await tour
        .getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true })
        .click();
    }
    await expect(tour).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
    await expect(page.locator('#current-time')).toHaveText(time!);
    await expect(page.locator('#animation-dirty')).toHaveText(dirty!);
    expect(await page.locator('#animation-undo').isEnabled()).toBe(undo);
    if (selected) {
      await expect(page.locator('#graph-key-time')).toHaveValue('0');
      await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveValue('41');
      await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveAttribute(
        'data-temporary',
        'true',
      );
    }
    expect(downloads).toBe(0);
    // A subsequent timeline tour must reveal its hidden lanes without toggling the view manually.
    const timeline = await launch('Timeline Navigation');
    await timeline.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('#timeline-ruler')).toBeVisible();
    await expect(page.locator('#graph-editor')).toBeHidden();
    await page.keyboard.press('Escape');
    expect(await json()).toBe(before);
    await launch(guide.title);
    await page.keyboard.press('Escape');
    await expect(tour).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
  });
}

test('Graph Editor Feature Guide explains a missing animation prerequisite', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.locator('#animation-selection').selectOption('');
  await page.getByRole('button', { name: 'Feature Guide', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start Guide: Graph Editor', exact: true });
  await expect(start).toBeDisabled();
  await expect(start.locator('..')).toContainText('Create or select an animation first.');
});
