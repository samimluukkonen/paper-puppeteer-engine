import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { animationMenuControl, test } from './fixtures.js';

async function openEditor(page: Page, empty = false) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 2000,
        playback: { mode: 'smooth' },
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 500, x: 40 },
            { time: 2000, x: 20 },
          ],
        },
        events: empty
          ? []
          : [
              { time: 2000, name: 'end' },
              { time: 500, name: 'step-left', data: { foot: 'left', count: 1 } },
              { time: 0, name: 'start' },
              { time: 500, name: 'step-right', data: ['right', null] },
            ],
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
}
const event = (page: Page, name: string) => page.locator(`.timeline-event[data-event-name="${name}"]`);
const key = (page: Page) => page.getByRole('button', { name: 'Select root x key at 0.5 s', exact: true });

for (const { field, value, modifiers } of [
  { field: 'name', value: 'edited-step', modifiers: [] },
  { field: 'data', value: '{"foot":"edited","count":2}', modifiers: ['Shift'] },
  { field: 'time', value: '0.75', modifiers: ['ControlOrMeta'] },
] as const) {
  test(`event ${field} drafts commit before keyframe selection`, async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
    await event(page, 'step-left').click();
    await page.locator(`#animation-event-${field}`).fill(value);
    await key(page).click({ modifiers: [...modifiers] });
    await expect(key(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
    const edited = event(page, field === 'name' ? value : 'step-left');
    await edited.click();
    if (field === 'data') {
      expect(JSON.parse(await page.locator('#animation-event-data').inputValue())).toEqual({
        foot: 'edited',
        count: 2,
      });
    } else await expect(page.locator(`#animation-event-${field}`)).toHaveValue(value);
    await page.locator('#animation-undo').click();
    await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
    await page.locator('#animation-redo').click();
    await expect(page.locator('#animation-dirty')).toHaveText('Unsaved changes');
  });
}

test('event draft commits before acquiring a keyframe drag', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await event(page, 'step-left').click();
  await page.locator('#animation-event-name').fill('edited-step');
  await key(page).scrollIntoViewIfNeeded();
  const bounds = (await page.locator('#timeline').boundingBox())!;
  const marker = (await key(page).boundingBox())!;
  await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await page.mouse.down();
  await expect(event(page, 'edited-step')).toHaveCount(1);
  await page.mouse.move(bounds.x + bounds.width * 0.4, marker.y + marker.height / 2, { steps: 5 });
  await page.mouse.up();
  const moved = page.locator('.timeline-keyframe[aria-pressed="true"]');
  await expect.poll(async () => Number(await moved.getAttribute('data-time'))).toBeCloseTo(0.8, 2);
  await page.locator('#animation-undo').click();
  await expect(key(page)).toBeVisible();
  await expect(event(page, 'edited-step')).toHaveCount(1);
  await page.locator('#animation-undo').click();
  await expect(event(page, 'step-left')).toHaveCount(1);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('event markers align with ruler endpoints on resize, and same-time events remain independently selectable', async ({
  page,
}) => {
  await openEditor(page);
  await expect(page.locator('.timeline-event')).toHaveCount(4);
  await expect(page.locator('#timeline-tracks > :first-child')).toHaveClass(/timeline-event-track/);
  for (const width of [1600, 620]) {
    await page.setViewportSize({ width, height: 1400 });
    const bounds = await page.locator('#timeline').boundingBox();
    if (!bounds) throw new Error('Missing timeline.');
    for (const [name, time] of [
      ['start', 0],
      ['step-left', 0.5],
      ['step-right', 0.5],
      ['end', 2],
    ] as const) {
      const marker = await event(page, name).boundingBox();
      expect(marker!.x + marker!.width / 2).toBeCloseTo(bounds.x + (time / 2) * bounds.width, 0);
    }
  }
  await page.setViewportSize({ width: 1600, height: 1400 });
  const left = await event(page, 'step-left').boundingBox();
  const right = await event(page, 'step-right').boundingBox();
  expect(right!.y - left!.y).toBe(30);
  await page.locator('#play-pause').click();
  await event(page, 'step-left').click();
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0.5');
  await expect(event(page, 'step-left')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-event-name')).toHaveValue('step-left');
  await expect(page.locator('#animation-event-time')).toHaveValue('0.5');
  await expect(page.locator('#animation-event-data')).toHaveValue(/"foot": "left"/);
  const pose = await page.locator('#animation-stage canvas').screenshot();
  await event(page, 'step-right').click();
  await expect(event(page, 'step-left')).toHaveAttribute('aria-pressed', 'false');
  await expect(event(page, 'step-right')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-event-name')).toHaveValue('step-right');
  await expect(page.locator('#animation-event-data')).toHaveValue(/"right"/);
  await event(page, 'end').click({ position: { x: 4, y: 12 } });
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '2');
  expect((await page.locator('#animation-stage canvas').screenshot()).equals(pose)).toBe(false);
  await expect(page.locator('#animation-event-data')).toHaveValue('');
  await event(page, 'start').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0');
  await expect(event(page, 'start')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('event-track.png') });
});

test('event/key selection stays exclusive; scrubbing, playback, key editing and history preserve authored events', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await key(page).click();
  await expect(key(page)).toHaveAttribute('aria-pressed', 'true');
  await event(page, 'step-left').click();
  await expect(key(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#timeline-delete-key')).toBeEnabled();
  await expect(page.locator('#timeline-delete-key')).toHaveText('Delete Event');
  await expect(page.locator('#animation-event-inspector')).toBeVisible();
  await expect(page.locator('#animation-bone-inspector')).toBeHidden();
  const ruler = page.locator('#timeline-ruler');
  await ruler.focus();
  await page.keyboard.press('End');
  await expect(ruler).toHaveAttribute('aria-valuenow', '2');
  await expect(event(page, 'step-left')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-event-time')).toHaveValue('0.5');
  await expect(page.locator('#animation-bone-inspector')).toBeHidden();
  await key(page).click();
  await expect(event(page, 'step-left')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#animation-event-inspector')).toBeHidden();
  await expect(page.locator('#animation-bone-inspector')).toBeVisible();
  const field = page.locator('#animation-bone-fields input[data-property="x"]');
  await field.fill('44');
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  await event(page, 'step-right').click();
  await page.locator('#animation-undo').click();
  await expect(event(page, 'step-right')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-redo')).toBeEnabled();
  await page.locator('#preview-loop').click();
  await page.locator('#play-pause').click();
  await expect.poll(async () => Number(await ruler.getAttribute('aria-valuenow'))).not.toBe(0.5);
  await expect(event(page, 'step-right')).toHaveAttribute('data-time', '0.5');
  await event(page, 'step-right').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.timeline-event')).toHaveCount(3);
  await page.locator('#animation-undo').click();
  await expect(page.locator('.timeline-event')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(page.locator('#animation-event-inspector')).toBeHidden();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('empty event track stays visible without markers or a selected inspector', async ({ page }) => {
  await openEditor(page, true);
  await expect(page.getByRole('button', { name: 'Select events track', exact: true })).toBeVisible();
  await expect(page.locator('.timeline-event')).toHaveCount(0);
  await expect(page.locator('#animation-event-inspector')).toBeHidden();
  await page.getByRole('button', { name: 'Select events track', exact: true }).click();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('event creation, field commits, JSON validation, same-time edits and exact deletion history', async ({ page }) => {
  await openEditor(page);
  const ruler = page.locator('#timeline-ruler');
  await ruler.focus();
  // Keyboard scrubbing uses continuous time and avoids dependence on pixel rounding.
  for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.locator('#timeline-add-event').click();
  await expect(event(page, 'event')).toHaveAttribute('data-time', /0\.75/);
  const name = page.locator('#animation-event-name');
  const data = page.locator('#animation-event-data');
  const time = page.locator('#animation-event-time');
  await expect(name).toBeFocused();
  await name.fill('authored');
  await expect(event(page, 'event')).toHaveCount(1);
  await name.press('Enter');
  await expect(event(page, 'authored')).toHaveCount(1);
  await page.locator('#animation-undo').click();
  await expect(event(page, 'event')).toHaveCount(1);
  await page.locator('#animation-redo').click();
  await expect(name).toHaveValue('authored');
  await data.fill('{invalid');
  await data.press('Control+Enter');
  await expect(page.locator('#animation-event-error')).toContainText('valid JSON');
  await expect(data).toHaveValue('{invalid');
  await data.fill('{"nested":[null,true,{"number":2}]}');
  await data.press('Control+Enter');
  await expect(page.locator('#animation-event-error')).toBeEmpty();
  // Input arrows/Delete retain native editing instead of moving or deleting the event.
  await name.focus();
  await name.press('ArrowRight');
  await expect(event(page, 'authored')).toHaveAttribute('data-time', /0\.75/);
  await time.fill('0.5');
  await time.press('Enter');
  await expect(event(page, 'authored')).toHaveAttribute('data-time', '0.5');
  await expect(page.locator('.timeline-event[data-time="0.5"]')).toHaveCount(3);
  await expect(data).toHaveValue(/"nested"/);
  await name.fill('');
  await name.press('Enter');
  await expect(page.locator('#animation-event-error')).not.toBeEmpty();
  await expect(event(page, 'authored')).toHaveCount(1);
  await name.press('Escape');
  await expect(name).toHaveValue('authored');
  await page.locator('#animation-delete-event').click();
  await expect(event(page, 'authored')).toHaveCount(0);
  await expect(page.locator('#animation-event-inspector')).toBeHidden();
  await expect(page.locator('#timeline-add-event')).toBeFocused();
  await page.locator('#animation-undo').click();
  await event(page, 'authored').click();
  await expect(data).toHaveValue(/"nested"/);
  await expect(time).toHaveValue('0.5');
  await page.locator('#animation-redo').click();
  await expect(event(page, 'authored')).toHaveCount(0);
});

test('event drag uses shared snap policy, follows playhead, nudges, cancels and clamps endpoints', async ({ page }) => {
  await openEditor(page);
  const marker = event(page, 'step-left');
  const time = page.locator('#animation-event-time');
  const ruler = page.locator('#timeline-ruler');
  await page.locator('#timeline-snap-enabled').check();
  for (const mode of ['keyframes', 'events', 'playhead']) await page.locator(`#timeline-snap-${mode}`).uncheck();
  async function dragTo(target: number, commit = true, bypass = false) {
    const bounds = (await page.locator('#timeline').boundingBox())!;
    const box = (await marker.boundingBox())!;
    // Endpoint marker centers lie on clipped lane edges; start in the visible hit area.
    const startX = Math.max(bounds.x + 2, Math.min(bounds.x + bounds.width - 2, box.x + box.width / 2));
    // Overshoot the lane within the viewport so Chrome still delivers pointer events.
    const targetX = Math.max(1, Math.min(page.viewportSize()!.width - 1, bounds.x + (bounds.width * target) / 2));
    await page.mouse.move(startX, box.y + box.height / 2);
    await page.mouse.down();
    if (bypass) await page.keyboard.down('Shift');
    await page.mouse.move(targetX, box.y + box.height / 2, { steps: 5 });
    if (commit) await page.mouse.up();
    if (bypass) await page.keyboard.up('Shift');
  }
  await dragTo(0.704);
  await expect(marker).toHaveAttribute('data-time', '0.7');
  await expect(time).toHaveValue('0.7');
  await expect(ruler).toHaveAttribute('aria-valuenow', '0.7');
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await page.locator('#animation-undo').click();
  await expect(marker).toHaveAttribute('data-time', '0.5');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#animation-redo').click();
  await expect(marker).toHaveAttribute('data-time', '0.7');
  await marker.focus();
  await page.keyboard.press('ArrowRight');
  await expect(marker).toHaveAttribute('data-time', '0.8');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(marker).toHaveAttribute('data-time', '0');
  await dragTo(0.735, true, true);
  await expect.poll(async () => Number(await marker.getAttribute('data-time'))).toBeCloseTo(0.735, 2);
  await dragTo(1.3, false);
  await expect(time).toHaveValue('1.3');
  await expect(ruler).toHaveAttribute('aria-valuenow', '1.3');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => Number(await marker.getAttribute('data-time'))).toBeCloseTo(0.735, 2);
  await time.fill('2');
  await time.press('Enter');
  await expect(marker).toHaveAttribute('data-time', '2');
  await expect(page.locator('.timeline-event[data-time="2"]')).toHaveCount(2);
  await dragTo(-0.5);
  await expect(marker).toHaveAttribute('data-time', '0');
  await dragTo(2.5);
  await expect(marker).toHaveAttribute('data-time', '2');
  await marker.focus();
  await page.keyboard.press('Delete');
  await expect(marker).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(marker).toHaveCount(1);
});

test('event clipboard shortcuts/buttons preserve payloads, same-time identities, selection and history', async ({
  page,
}) => {
  await openEditor(page);
  await event(page, 'step-left').click();
  await expect(page.locator('#timeline-copy-keys')).toHaveText('Copy Event');
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#timeline-paste-keys')).toHaveText('Paste Event');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(event(page, 'step-left')).toHaveCount(2);
  await expect(event(page, 'step-left').last()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.timeline-event[data-time="0.5"]')).toHaveCount(3);
  await expect(page.locator('#animation-event-data')).toHaveValue(/"foot": "left"/);
  await (await animationMenuControl(page, '#timeline-duplicate-keys')).click();
  await expect(event(page, 'step-left')).toHaveCount(3);
  await expect(page.locator('.timeline-event[data-time="0.51"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#animation-event-time')).toHaveValue('0.51');
  await page.locator('#animation-undo').click();
  await expect(event(page, 'step-left')).toHaveCount(2);
  await page.locator('#animation-undo').click();
  await expect(event(page, 'step-left')).toHaveCount(1);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-redo').click();
  await page.locator('#animation-redo').click();
  await expect(event(page, 'step-left')).toHaveCount(3);
  await page.locator('#animation-undo').click();
  await page.locator('#animation-undo').click();
  await page.getByRole('button', { name: 'Expand root properties' }).click();
  await key(page).click();
  await expect(page.locator('#animation-event-inspector')).toBeHidden();
  // Paste follows clipboard content, even when keys are selected.
  await (await animationMenuControl(page, '#timeline-paste-keys')).click();
  await expect(page.locator('#animation-event-inspector')).toBeVisible();
  await expect(key(page)).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#animation-undo').click();
  await key(page).click();
  await (await animationMenuControl(page, '#timeline-copy-keys')).click();
  await event(page, 'step-left').click();
  await expect(page.locator('#timeline-paste-keys')).toHaveText('Paste Keys');
});

test('event clipboard persists across animations and respects native name/JSON clipboard shortcuts', async ({
  page,
}) => {
  await openEditor(page);
  await event(page, 'step-left').click();
  await (await animationMenuControl(page, '#timeline-copy-keys')).click();
  const native = await page.evaluate(() =>
    ['#animation-event-name', '#animation-event-data'].flatMap((selector) =>
      ['c', 'v', 'd'].map((key) =>
        document
          .querySelector(selector)!
          .dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key })),
      ),
    ),
  );
  expect(native.every(Boolean)).toBe(true);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.locator('#animation-selection').selectOption('walk');
  await page.locator('#timeline-ruler').press('End');
  const destination = await page.locator('#timeline-ruler').getAttribute('aria-valuenow');
  await (await animationMenuControl(page, '#timeline-paste-keys')).click();
  await expect(page.locator('#animation-event-name')).toHaveValue('step-left');
  await expect(page.locator('#animation-event-time')).toHaveValue(destination!);
  await expect(page.locator('#animation-event-data')).toHaveValue(/"count": 1/);
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
