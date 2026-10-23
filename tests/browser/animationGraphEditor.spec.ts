import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { animationControl, animationFileAction, test } from './fixtures.js';

async function openGraph(page: Page) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    const source = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      json: {
        ...source,
        duration: 1000,
        loop: false,
        playback: { mode: 'smooth' },
        events: [],
        ikTracks: {
          rightArmIK: [
            { time: 0, x: 10, y: -20, mix: 0 },
            { time: 1000, x: 40, y: -50, mix: 1 },
          ],
        },
        tracks: {
          root: [
            { time: 0, x: -10, y: 3, rotation: (170 * Math.PI) / 180 },
            { time: 500, x: 0 },
            { time: 1000, x: 10, y: 5, rotation: (-170 * Math.PI) / 180 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).click();
  await page.locator('#graph-toggle').click();
  await expect(page.locator('#graph-editor')).toBeVisible();
}
async function dragHandle(page: Page, dx: number, dy: number, cancel = false) {
  const handle = page.locator('[data-handle="control1"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error('Missing tangent handle');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

test('graph tangents update the held preview, cancel, share one Undo, and round-trip export/reload', async ({
  page,
}) => {
  await openGraph(page);
  await expect(page.locator('.graph-tangent-details')).not.toHaveAttribute('open', '');
  await page.locator('#graph-interpolation').selectOption('bezier');
  await expect(page.locator('.graph-handle')).toHaveCount(2);
  await page.locator('#timeline-time-input').fill('0.125');
  await page.locator('#timeline-time-input').press('Tab');
  const boneX = page.locator('#animation-bone-fields input[data-property="x"]');
  const before = await boneX.inputValue();
  await dragHandle(page, 0, -35);
  const after = await boneX.inputValue();
  expect(after).not.toBe(before);
  await page.locator('#animation-undo').click();
  await expect(boneX).toHaveValue(before);
  await page.locator('#animation-redo').click();
  await expect(boneX).toHaveValue(after);
  const curve = await page.locator('.graph-curve').getAttribute('d');
  await dragHandle(page, 20, 10, true);
  await expect(page.locator('.graph-curve')).toHaveAttribute('d', curve!);
  await expect(boneX).toHaveValue(after);
  const pendingDownload = page.waitForEvent('download');
  await (await animationControl(page, '#animation-download')).click();
  const download = await pendingDownload;
  const path = await download.path();
  if (!path) throw new Error('Missing animation export');
  const data = JSON.parse(await readFile(path, 'utf8')) as {
    tracks: { root: { curves?: { x?: { mode: string; control1: { y: number } } } }[] };
  };
  expect(data.tracks.root[0]!.curves!.x!.mode).toBe('bezier');
  expect(data.tracks.root[0]!.curves!.x!.control1.y).toBeGreaterThan(0);
  await animationFileAction(page, '#animation-reload-export', (control) => control.click());
  await expect(page.locator('#animation-file-import-feedback')).toContainText('Imported');
  await page.locator('#graph-toggle').click();
  await expect(page.getByRole('button', { name: 'Select root x key at 0 s', exact: true })).toHaveAttribute(
    'data-interpolation',
    'bezier',
  );
  await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).click();
  await page.locator('#graph-toggle').click();
  await expect(page.locator('.graph-handle')).toHaveCount(2);
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('graph-editor.png') });
});

test('graph key selection, precision editing, collisions and keyboard deletion synchronize with timeline', async ({
  page,
}) => {
  await openGraph(page);
  await page.getByRole('button', { name: 'Select root x graph key at 0.5 s', exact: true }).click();
  await expect(page.locator('#graph-key-time')).toHaveValue('0.5');
  await page.locator('#timeline-snap-enabled').check();
  const point = await page.locator('.graph-key[data-graph-key="1"]').boundingBox();
  if (!point) throw new Error('Missing graph key');
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2 + 60, point.y + point.height / 2 - 8, { steps: 4 });
  await page.mouse.up();
  const moved = Number(await page.locator('#graph-key-time').inputValue());
  expect(moved).toBeGreaterThan(0.5);
  expect(moved * 10).toBeCloseTo(Math.round(moved * 10), 8);
  await page.locator('#animation-undo').click();
  await expect(page.locator('#graph-key-time')).toHaveValue('');
  await page.getByRole('button', { name: 'Select root x graph key at 0.5 s', exact: true }).click();
  await page.locator('#graph-key-time').fill('0');
  await page.locator('#graph-apply').click();
  await expect(page.locator('#graph-status')).toContainText('neighboring keys');
  await expect(page.locator('.graph-key')).toHaveCount(3);
  await page.locator('#graph-key-time').fill('0.6');
  await page.locator('#graph-key-value').fill('-2');
  await page.locator('#graph-apply').click();
  await expect(page.locator('#graph-key-time')).toHaveValue('0.6');
  await page.locator('#graph-canvas').press('ArrowRight');
  await expect(page.locator('#graph-key-time')).toHaveValue('0.7');
  await page.locator('#graph-canvas').press('Delete');
  await expect(page.locator('.graph-key')).toHaveCount(2);
  await page.locator('#animation-undo').click();
  await expect(page.locator('.graph-key')).toHaveCount(3);
  await page.locator('#graph-toggle').click();
  await expect(page.getByRole('button', { name: 'Select root x key at 0.7 s', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select root rotation key at 0 s', exact: true }).click();
  await page.locator('#graph-toggle').click();
  await expect(page.locator('#graph-property')).toHaveValue('rotation');
  await expect(page.locator('#graph-key-value')).toHaveValue('170');
  await page.locator('#graph-property').selectOption('scaleX');
  await expect(page.locator('#graph-status')).toContainText('No keys on this property');
});

test('zoom, pan, resize and graph switching preserve curves and avoid playback DOM rebuilds', async ({ page }) => {
  await openGraph(page);
  const initial = await page.locator('.graph-curve').getAttribute('d');
  await page.locator('#graph-zoom-in').click();
  expect(await page.locator('.graph-curve').getAttribute('d')).not.toBe(initial);
  const canvas = await page.locator('#graph-canvas').boundingBox();
  if (!canvas) throw new Error('Missing graph canvas');
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(canvas.x + canvas.width / 2 + 50, canvas.y + canvas.height / 2 + 10);
  await page.mouse.up({ button: 'middle' });
  await page.locator('#graph-fit').click();
  await expect(page.locator('.graph-curve')).toHaveAttribute('d', initial!);
  await page.setViewportSize({ width: 1800, height: 1500 });
  await expect.poll(() => page.locator('.graph-curve').getAttribute('d')).not.toBe(initial);
  await page.locator('.graph-curve').evaluate((element) => {
    element.setAttribute('data-playback-probe', 'retained');
  });
  await page.locator('#play-pause').click();
  await expect.poll(() => page.locator('#timeline-time-input').inputValue()).not.toBe('0');
  await page.locator('#play-pause').click();
  await expect(page.locator('.graph-curve')).toHaveAttribute('data-playback-probe', 'retained');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#graph-toggle').click();
  await page.locator('#graph-toggle').click();
  await expect(page.locator('.graph-key')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(page.locator('#graph-editor')).toBeHidden();
});

test('IK graph channels, bounded precision tangents and influence edits share the IK inspector', async ({ page }) => {
  await openGraph(page);
  await page.locator('#graph-toggle').click();
  await page.getByRole('button', { name: 'Select IK target rightArmIK', exact: true }).click();
  await page.locator('#graph-toggle').click();
  await expect(page.locator('#graph-property option')).toHaveText(['IK target X', 'IK target Y', 'IK influence']);
  await page.locator('#graph-property').selectOption('mix');
  await page.getByRole('button', { name: 'Select rightArmIK mix graph key at 0 s', exact: true }).click();
  await page.locator('#graph-interpolation').selectOption('bezier');
  await page.locator('.graph-tangent-details > summary').click();
  await page.locator('#graph-control1-x').fill('0.9');
  await page.locator('#graph-apply-handles').click();
  await expect(page.locator('#graph-status')).not.toBeEmpty();
  await expect(page.locator('#graph-control1-x')).toHaveValue('0.3333333333333333');
  await page.locator('#graph-control1-x').fill('0.2');
  await page.locator('#graph-control1-y').fill('0.4');
  await page.locator('#graph-apply-handles').click();
  await page.locator('#graph-reset-handles').click();
  await expect(page.locator('#graph-control1-y')).toHaveValue('0');
  await page.locator('#graph-key-value').fill('1.5');
  await page.locator('#graph-apply').click();
  await expect(page.locator('#graph-status')).toContainText('between 0 and 1');
  await page.locator('#graph-key-value').fill('0.2');
  await page.locator('#graph-apply').click();
  await expect(page.locator('#animation-ik-inspector [data-ik-property="mix"]')).toHaveValue('0.2');
  await page.locator('#graph-interpolation').selectOption('stepped');
  await page.locator('#timeline-time-input').fill('0.5');
  await page.locator('#timeline-time-input').press('Tab');
  await expect(page.locator('#animation-ik-inspector [data-ik-property="mix"]')).toHaveValue('0.2');
});
