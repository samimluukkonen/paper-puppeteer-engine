import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { guideRegistry } from '../../src/devtools/shared/guides/registry.js';
import { animationFileAction, test } from './fixtures.js';

test.use({ actionTimeout: 15_000 });
const guide = guideRegistry.getGuideById('animation-environment-preview')!;

async function snapshot(page: Page) {
  return {
    controls: await page.locator('.environment-preview-panel input').evaluateAll((inputs) =>
      inputs.map((element) => {
        const input = element as HTMLInputElement;
        return { name: input.name, type: input.type, value: input.value, checked: input.checked };
      }),
    ),
    image: await page.locator('.environment-preview-panel select').inputValue(),
    ground: await page.evaluate(() =>
      Object.entries(localStorage).filter(([key]) => key.startsWith('paper-puppeteer:ground-guide:')),
    ),
    animation: await page.locator('#animation-selection').inputValue(),
    time: await page.locator('#current-time').textContent(),
    dirty: await page.locator('#animation-dirty').textContent(),
    undo: await page.locator('#animation-undo').isEnabled(),
    redo: await page.locator('#animation-redo').isEnabled(),
  };
}

for (const configured of [false, true]) {
  test(`Environment Preview guide reveals every control without changing data; background=${configured}`, async ({
    page,
  }) => {
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    await page.locator('#animation-selection').selectOption('walk');
    const panel = page.locator('.environment-preview-panel');
    await expect(panel).not.toHaveAttribute('open');
    if (configured) {
      await panel.locator('summary').click();
      await panel.getByLabel('Import environment image').setInputFiles({
        name: 'paper-torso.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('../../public/characters/demo-puppet/images/paper-torso.png', import.meta.url)),
      });
      await expect(panel.getByRole('status')).toContainText('imported');
      await panel.getByRole('checkbox', { name: 'Environment Preview', exact: true }).check();
      await panel.getByRole('checkbox', { name: 'Show Ground Reference', exact: true }).check();
      await panel.getByLabel('Background X', { exact: true }).fill('380');
      await panel.getByLabel('Background Y', { exact: true }).fill('435');
      await panel.getByLabel('Scale', { exact: true }).fill('0.5');
      await panel.getByRole('button', { name: 'Apply background transform', exact: true }).click();
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
      if (index === 3) {
        await tour.getByRole('button', { name: 'Back', exact: true }).click();
        await tour.getByRole('button', { name: 'Next', exact: true }).click();
      }
      if (index === 4 && configured)
        await page.screenshot({ path: test.info().outputPath('environment-preview-guide.png') });
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
