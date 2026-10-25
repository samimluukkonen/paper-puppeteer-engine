import { expect, type Page } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { animationFileAction, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });
const guide = guideRegistry.getGuideById('animation-preview-displacement')!;

async function snapshot(page: Page) {
  return {
    controls: await page.locator('.motion-preview-panel input, .motion-preview-panel select').evaluateAll((controls) =>
      controls.map((element) => {
        const input = element as HTMLInputElement;
        return { name: input.name, value: input.value, checked: input.checked };
      }),
    ),
    environment: await page
      .locator('.environment-preview-panel input, .environment-preview-panel select')
      .evaluateAll((controls) =>
        controls.map((element) => {
          const input = element as HTMLInputElement;
          return { value: input.value, checked: input.checked };
        }),
      ),
    clip: await page.locator('#animation-selection').inputValue(),
    time: await page.locator('#current-time').textContent(),
    dirty: await page.locator('#animation-dirty').textContent(),
    undo: await page.locator('#animation-undo').isEnabled(),
    redo: await page.locator('#animation-redo').isEnabled(),
    playing: await page.locator('#play-pause').textContent(),
    facing: await page.locator('#animation-facing').inputValue(),
  };
}

for (const configured of [false, true]) {
  test(`Preview Displacement guide reveals every target and preserves data; configured=${configured}`, async ({
    page,
  }) => {
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    await page.locator('#animation-selection').selectOption('walk');
    const panel = page.locator('.motion-preview-panel');
    await expect(panel).not.toHaveAttribute('open');
    if (configured) {
      await panel.locator('summary').click();
      await panel.getByRole('button', { name: 'Add position point', exact: true }).click();
      await page.locator('#timeline-time-input').fill('0.6');
      await page.locator('#timeline-time-input').press('Enter');
      await panel.getByRole('button', { name: 'Add position point', exact: true }).click();
      const point = panel.getByRole('form', { name: 'Preview point 2', exact: true });
      await point.getByLabel('Offset X', { exact: true }).fill('45');
      await point.getByLabel('Offset Y', { exact: true }).fill('-80');
      await point.getByRole('button', { name: 'Apply point 2', exact: true }).click();
      await panel.getByLabel('Trajectory interpolation', { exact: true }).selectOption('stepped');
      await panel.getByRole('checkbox', { name: 'Show preview trajectory', exact: true }).uncheck();
      await panel.getByRole('checkbox', { name: 'Use Preview-Only Displacement', exact: true }).check();
      await page.locator('#animation-facing').selectOption('left');
      await panel.locator('summary').click();
    }
    const json = async () => {
      const logged = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('{') });
      await animationFileAction(page, '#animation-log-json', (button) => button.click());
      return (await logged).text();
    };
    const authored = await json();
    await page.locator('#timeline-time-input').fill('0.25');
    await page.locator('#timeline-time-input').press('Enter');
    const before = await snapshot(page);
    let downloads = 0;
    page.on('download', () => downloads++);
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
      const hole = tour.locator('.guide-spotlight-hole');
      await expect(hole).toBeVisible();
      await expect
        .poll(async () => {
          const bounds = await target.boundingBox();
          const spot = await hole.boundingBox();
          if (!bounds || !spot) return false;
          const x = spot.x + spot.width / 2;
          const y = spot.y + spot.height / 2;
          return (
            x >= bounds.x - 4 &&
            x <= bounds.x + bounds.width + 4 &&
            y >= bounds.y - 4 &&
            y <= bounds.y + bounds.height + 4
          );
        })
        .toBe(true);
      await expect(tour.getByRole('status')).toHaveCount(0);
      await expect(tour.getByRole('button', { name: 'Try It', exact: true })).toHaveCount(0);
      if (index === 2) {
        await page.screenshot({
          path: test.info().outputPath(`displacement-guide-${configured ? 'configured' : 'empty'}.png`),
        });
        await tour.getByRole('button', { name: 'Back', exact: true }).click();
        await tour.getByRole('button', { name: 'Next', exact: true }).click();
      }
      await tour
        .getByRole('button', { name: index === guide.steps.length - 1 ? 'Finish' : 'Next', exact: true })
        .click();
    }
    await expect(tour).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Feature Guide', exact: true })).toBeFocused();
    expect(await snapshot(page)).toEqual(before);
    expect(downloads).toBe(0);
    expect(await json()).toBe(authored);
    const restarted = await launch();
    await restarted.getByRole('button', { name: 'Next', exact: true }).click();
    await restarted.getByRole('button', { name: 'Restart guide', exact: true }).click();
    await expect(restarted).toContainText('Step 1 of 7');
    await page.keyboard.press('Escape');
    await expect(restarted).toHaveCount(0);
    expect(await snapshot(page)).toEqual(before);
  });
}
