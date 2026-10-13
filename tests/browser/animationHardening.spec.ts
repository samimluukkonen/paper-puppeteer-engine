import { expect } from '@playwright/test';
import { animationMenuControl, test } from './fixtures.js';

async function openEditor(page: import('@playwright/test').Page) {
  await page.route('**/animations/idle.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        name: 'idle',
        duration: 2000,
        loop: false,
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 1000, x: 10 },
          ],
        },
        ikTracks: { rightArmIK: [{ time: 500, x: 30, y: 70, mix: 0.5 }] },
        events: [{ time: 1000, name: 'cue' }],
      },
    }),
  );
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
}

test('context commands explain selection requirements and toolbar IK deletion matches keyboard', async ({ page }) => {
  await openEditor(page);
  const retime = await animationMenuControl(page, '#animation-retime-open');
  await expect(retime).toBeDisabled();
  await expect(retime).toHaveAttribute('title', /Select bone keyframes or an IK channel key/);
  await page.locator('#animation-authoring-tools > summary').click();
  await expect(page.locator('#timeline-fit-selection')).toBeDisabled();
  await expect(page.locator('#timeline-fit-selection')).toHaveAttribute('title', /Select bone keys/);
  await page.getByRole('button', { name: 'Expand rightArmIK properties', exact: true }).click();
  const key = page.locator(
    '.timeline-ik-property-track[data-constraint-id="rightArmIK"][data-property="x"] .timeline-keyframe',
  );
  await key.press('Enter');
  await expect(page.locator('#animation-ik-inspector')).toBeVisible();
  await animationMenuControl(page, '#timeline-copy-keys');
  await expect(page.locator('#timeline-copy-keys')).toBeDisabled();
  await expect(page.locator('#timeline-copy-keys')).toHaveAttribute('title', /IK clipboard/);
  await (await animationMenuControl(page, '#timeline-delete-key')).click();
  await expect(key).toHaveCount(0);
  await expect(page.locator('#animation-undo')).toBeEnabled();
  await page.locator('#animation-undo').click();
  await expect(key).toHaveCount(1);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await key.press('Enter');
  await key.press('Escape');
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#timeline-fit-selection')).toBeDisabled();
  await key.press('Enter');
  await key.press('Delete');
  await expect(key).toHaveCount(0);
  await page.locator('#animation-undo').click();
  await expect(key).toHaveCount(1);
});

test('retiming panel Escape, arrows and Delete preserve background selection and history', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  const keys = page.locator('.timeline-track-lane[data-bone-id="root"][data-property="x"] .timeline-keyframe');
  await keys.first().press('Enter');
  await keys.last().click({ modifiers: ['Control'] });
  await (await animationMenuControl(page, '#animation-retime-open')).click();
  const panel = page.locator('#animation-retime-panel');
  const preview = panel.getByRole('button', { name: 'Preview', exact: true });
  await preview.click();
  await expect(panel.locator('tbody tr')).toHaveCount(2);
  for (const command of ['ArrowRight', 'Delete', 'Backspace']) await preview.press(command);
  await expect(keys).toHaveCount(2);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await preview.press('Escape');
  await expect(panel).not.toHaveAttribute('open');
  await expect(
    page.locator(
      '.timeline-track-lane[data-bone-id="root"][data-property="x"] .timeline-keyframe[aria-pressed="true"]',
    ),
  ).toHaveCount(2);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await (await animationMenuControl(page, '#animation-retime-open')).click();
  await expect(panel.locator('table')).toHaveCount(0);
  await panel.getByLabel('Time scale (×)').fill('0');
  await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toHaveAttribute(
    'aria-describedby',
    'animation-retime-reason',
  );
});
