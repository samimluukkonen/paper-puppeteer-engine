import { expect, type Page } from '@playwright/test';
import {
  selectAnimationBone,
  animationHierarchy,
  animationMenuControl,
  animationControl,
  animationFileAction,
  test,
} from './fixtures.js';

async function editRoot(page: Page, value: string) {
  await selectAnimationBone(page, 'root');
  await page.locator('#animation-bone-fields input[data-property="x"]').fill(value);
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
}

test('switch, file import, round-trip reload and source revert confirm dirty replacement and retain cancelled edits', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-session-status')).toHaveText('Animation: idle · Status: Clean');
  await editRoot(page, '130');
  await expect(page.locator('#animation-session-status')).toHaveText('Animation: idle · Status: Modified');
  const file = {
    name: 'replacement.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        name: 'replacement',
        duration: 1000,
        loop: false,
        tracks: { root: [{ time: 0, x: 22 }] },
      }),
    ),
  };
  for (const action of [
    () => animationFileAction(page, '#animation-import-file', (control) => control.setInputFiles(file)),
    () => animationFileAction(page, '#animation-reload-export', (control) => control.click()),
    () => animationFileAction(page, '#animation-revert', (control) => control.click()),
  ]) {
    await Promise.all([page.waitForEvent('dialog').then((dialog) => dialog.dismiss()), action()]);
    await expect(page.locator('#animation-selection')).toHaveValue('idle');
    await expect(page.locator('#animation-bone-fields input[data-property="x"]')).toHaveValue('130');
    await expect(page.locator('#animation-undo')).toBeEnabled();
    await expect(page.locator('#animation-session-status')).toContainText('Modified');
  }
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('#animation-session-status')).toHaveText('Animation: walk · Status: Clean');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#animation-selection').selectOption('idle');
  await expect(page.locator('#animation-session-status')).toContainText('Modified');
  await expect(page.locator('#animation-undo')).toBeEnabled();
});

test('revert restores loaded source after export and pauses/resets preview without network reload', async ({
  page,
}) => {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await (await animationHierarchy(page)).getByRole('button', { name: 'root', exact: true }).click();
  const x = page.locator('#animation-bone-fields input[data-property="x"]');
  const original = await x.inputValue();
  await editRoot(page, '130');
  await Promise.all([page.waitForEvent('download'), (await animationControl(page, '#animation-download')).click()]);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#play-pause').click();
  const fetchedAssets: string[] = [];
  page.on('request', (request) => {
    // Autosave legitimately reads artwork bytes. Source revert must not reload authored metadata.
    if (request.url().includes('/characters/') && new URL(request.url()).pathname.endsWith('.json'))
      fetchedAssets.push(request.url());
  });
  await animationFileAction(page, '#animation-revert', (control) => control.click());
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await expect(page.locator('#current-time')).toContainText('0.000 /');
  await expect(page.locator('#animation-bone-title')).toHaveText('Select a bone');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-redo')).toBeDisabled();
  await (await animationHierarchy(page)).getByRole('button', { name: 'root', exact: true }).click();
  await expect(x).toHaveValue(original);
  expect(fetchedAssets).toEqual([]);
});

for (const mode of ['smooth', 'stepped']) {
  test(`${mode} rendered poses at keys, between keys and endpoints survive export/reload with facing and IK preview`, async ({
    page,
  }) => {
    // Sixteen canvas captures plus import/reload need a full workflow budget with software rendering.
    test.setTimeout(180_000);
    await page.goto('animation-editor/');
    await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
    await animationFileAction(page, '#animation-import-paste', (control) => control.click());
    await animationFileAction(page, '#animation-import-text', (control) =>
      control.fill(
        JSON.stringify({
          version: 1,
          name: 'visual',
          duration: 1033,
          loop: false,
          interpolation: 'linear',
          playback: mode === 'stepped' ? { mode, fps: 12.5 } : { mode },
          tracks: {
            root: [
              { time: 0, x: 0 },
              { time: 400, x: 25 },
              { time: 1033, x: -20 },
            ],
            torso: [
              { time: 0, rotation: 0.2 },
              { time: 800, rotation: -0.2 },
            ],
          },
          events: [
            { time: 0, name: 'start' },
            { time: 500, name: 'first', data: { value: [null, true, 0.3] } },
            { time: 500, name: 'second' },
            { time: 1033, name: 'end' },
          ],
        }),
      ),
    );
    await animationFileAction(page, '#animation-import-submit', (control) => control.click());
    await page.locator('#animation-show-bones').uncheck();
    await page.locator('#animation-facing').selectOption('left');
    await (await animationMenuControl(page, '#animation-ik-preview')).check();
    await expect(page.getByLabel('Local save status')).toContainText('Local draft saved');
    const canvas = page.locator('#animation-stage canvas');
    const timeInput = page.locator('#timeline-time-input');
    const times = [0, 0.04, 0.08, 0.2, 0.4, 0.8, 1.032, 1.033];
    const capture = async (time: number): Promise<Buffer> => {
      // Compare identical authored times; pixel ruler positions can land on opposite
      // sides of a key boundary after layout changes during autosave/export.
      await timeInput.fill(String(time));
      await timeInput.press('Enter');
      await page.evaluate(() => window.scrollTo(0, 0));
      // Compare scene pixels, excluding antialiasing of the panel's rounded corners.
      return canvas.screenshot({ style: '#animation-stage { border-radius: 0 !important; }' });
    };
    const poses: Buffer[] = [];
    for (const time of times) poses.push(await capture(time));
    await animationFileAction(page, '#animation-reload-export', (control) => control.click());
    await expect(page.locator('.timeline-event')).toHaveCount(4);
    for (let index = 0; index < times.length; ++index)
      await expect.poll(async () => (await capture(times[index]!)).equals(poses[index]!)).toBe(true);
    await expect(page.locator('#animation-session-status')).toHaveText('Animation: visual · Status: Clean');
  });
}
