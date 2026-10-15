import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationHierarchy, animationControl, animationFileAction, test } from './fixtures.js';

const animation = {
  version: 1,
  name: 'roundTrip',
  duration: 1500,
  loop: false,
  interpolation: 'linear',
  playback: { mode: 'stepped', fps: 12.5 },
  tracks: {
    root: [
      { time: 0, x: 20, y: 0 },
      { time: 600, x: 55 },
      { time: 1500, x: -10 },
    ],
    torso: [
      { time: 0, rotation: 0.2 },
      { time: 1000, rotation: -0.2 },
    ],
  },
  events: [
    { time: 0, name: 'start' },
    { time: 500, name: 'first', data: { nested: [null, true, { value: 0.30000000000000004 }] } },
    { time: 500, name: 'second', data: null },
    { time: 500, name: 'second', data: null },
    { time: 1500, name: 'end' },
  ],
};
async function paste(page: Page, json: string) {
  await animationFileAction(page, '#animation-import-paste', (control) => control.click());
  await animationFileAction(page, '#animation-import-text', (control) => control.fill(json));
  const acceptReplacement = (dialog: import('@playwright/test').Dialog): void => {
    void dialog.accept();
  };
  page.on('dialog', acceptReplacement);
  try {
    await animationFileAction(page, '#animation-import-submit', (control) => control.click());
  } finally {
    page.off('dialog', acceptReplacement);
  }
}
async function download(page: Page) {
  const waiting = page.waitForEvent('download');
  await (await animationControl(page, '#animation-download')).click();
  const downloaded = await waiting;
  const path = await downloaded.path();
  if (!path) throw new Error('Missing local animation download.');
  return { path, json: await readFile(path, 'utf8') };
}
async function editRoot(page: Page, value: string) {
  await (await animationHierarchy(page)).getByRole('button', { name: 'root', exact: true }).click();
  await page.locator('#animation-bone-fields input[data-property="x"]').fill(value);
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
}

test('paste and downloaded file imports restore authored data, timeline and rendered pose; normal edits still undo/redo', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await paste(page, JSON.stringify(animation));
  await expect(page.locator('#animation-selection')).toHaveValue('roundTrip');
  await expect(page.locator('#animation-import-panel')).toBeHidden();
  await expect(page.locator('#current-time')).toHaveText('0.000 / 1.500 s');
  await expect(await animationControl(page, '#animation-fps')).toHaveValue('12.5');
  await expect(await animationControl(page, '#animation-interpolation')).toHaveValue('linear');
  await expect(page.locator('.timeline-event')).toHaveCount(5);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  const lane = page.locator('#timeline-tracks [data-bone-id="root"][data-property="x"]');
  await expect(lane.locator('.timeline-keyframe')).toHaveCount(3);
  await expect(lane.locator('.timeline-keyframe[data-interpolation="linear"]')).toHaveCount(2);
  const canvas = page.locator('#animation-stage canvas');
  const original = await canvas.screenshot({ path: test.info().outputPath('original-pose.png') });
  const exported = await download(page);
  await editRoot(page, '130');
  await paste(
    page,
    JSON.stringify({ ...animation, name: 'modified', duration: 2000, tracks: { root: [{ time: 0, x: 130 }] } }),
  );
  expect((await canvas.screenshot()).equals(original)).toBe(false);
  await paste(page, exported.json);
  await expect(page.locator('#animation-selection')).toHaveValue('roundTrip');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-redo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect
    .poll(async () => (await canvas.screenshot({ path: test.info().outputPath('paste-pose.png') })).equals(original))
    .toBe(true);
  expect((await download(page)).json).toBe(exported.json);
  await editRoot(page, '140');
  await page.locator('#play-pause').click();
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  await Promise.all([
    page.waitForEvent('dialog').then((dialog) => dialog.accept()),
    animationFileAction(page, '#animation-import-file', (control) => control.setInputFiles(exported.path)),
  ]);
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await expect(page.locator('#current-time')).toHaveText('0.000 / 1.500 s');
  await expect(page.locator('#animation-bone-title')).toHaveText('Select a bone');
  await expect(page.locator('.timeline-keyframe[aria-pressed="true"]')).toHaveCount(0);
  expect((await download(page)).json).toBe(exported.json);
  await expect
    .poll(async () => (await canvas.screenshot({ path: test.info().outputPath('file-pose.png') })).equals(original))
    .toBe(true);
  // Key add/move, clip interpolation and event edits remain normal history transactions.
  await editRoot(page, '35');
  await page.getByRole('button', { name: 'Select root x key at 0 s', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await (await animationControl(page, '#animation-interpolation')).selectOption('');
  await page.locator('#timeline-add-event').click();
  await page.locator('#animation-event-name').fill('afterImport');
  await page.locator('#animation-event-name').press('Tab');
  const edited = (await download(page)).json;
  for (let i = 0; i < 5; i++) await page.locator('#animation-undo').click();
  expect((await download(page)).json).toBe(exported.json);
  for (let i = 0; i < 5; i++) await page.locator('#animation-redo').click();
  expect((await download(page)).json).toBe(edited);
  await animationFileAction(page, '#animation-reload-export', (control) => control.click());
  await expect(page.locator('#animation-undo')).toBeDisabled();
  expect((await download(page)).json).toBe(edited);
});

test('invalid JSON, versions and bones retain working animation and usable history; Cancel retains edits', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await paste(page, JSON.stringify(animation));
  await editRoot(page, '80');
  const working = (await download(page)).json;
  for (const [json, error] of [
    ['{bad', 'Invalid JSON'],
    [JSON.stringify({ ...animation, version: 99 }), 'Unsupported animation format version 99'],
    [JSON.stringify({ ...animation, tracks: { missing: [{ time: 0, x: 2 }] } }), 'missing'],
  ]) {
    await paste(page, json!);
    await expect(page.locator('#animation-import-feedback')).toContainText(error!);
    await expect(page.locator('#animation-import-panel')).toBeVisible();
    await expect(page.locator('#animation-undo')).toBeEnabled();
    await expect(page.locator('#animation-selection')).toHaveValue('roundTrip');
    expect((await download(page)).json).toBe(working);
  }
  await animationFileAction(page, '#animation-import-cancel', (control) => control.click());
  await expect(page.locator('#animation-import-panel')).toBeHidden();
  await page.locator('#animation-undo').click();
  expect(animationFileSchema.parse(JSON.parse((await download(page)).json)).tracks.root![0]!.x).toBe(20);
});

test('import cancels an active marquee and clears temporary event inspector edits', async ({ page }) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await paste(page, JSON.stringify(animation));
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  const lane = page.locator('#timeline-tracks [data-bone-id="root"][data-property="x"]');
  await lane.scrollIntoViewIfNeeded();
  const bounds = await lane.boundingBox();
  if (!bounds) throw new Error('Missing root x lane.');
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + 24);
  await expect(page.locator('.timeline-marquee')).toHaveCount(1);
  await page.evaluate((json) => {
    document.querySelector<HTMLTextAreaElement>('#animation-import-text')!.value = json;
    document.querySelector<HTMLButtonElement>('#animation-import-submit')!.click();
  }, JSON.stringify(animation));
  await expect(page.locator('.timeline-marquee')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.timeline-keyframe[aria-pressed="true"]')).toHaveCount(0);
  await page.locator('#timeline-add-event').click();
  await page.locator('#animation-event-data').fill('{invalid');
  await Promise.all([
    page.waitForEvent('dialog').then((dialog) => dialog.accept()),
    animationFileAction(page, '#animation-reload-export', (control) => control.click()),
  ]);
  await expect(page.locator('#animation-event-inspector')).toBeHidden();
  await expect(page.locator('#animation-event-data')).toHaveValue('');
  await expect(page.locator('#animation-event-error')).toHaveText('');
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('reimporting a clip with a previous browser draft starts clean without a recovery prompt', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    if (!dialog.message().startsWith('Import or reload this animation?')) {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    }
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await paste(page, JSON.stringify(animation));
  await editRoot(page, '99');
  await paste(page, JSON.stringify({ ...animation, name: 'other' }));
  await paste(page, JSON.stringify(animation));
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  expect(dialogs).toEqual([]);
});
