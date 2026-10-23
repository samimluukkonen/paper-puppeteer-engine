import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

async function openEditor(page: Page) {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration: 1000,
        playback: { mode: 'smooth' },
        events: [],
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 250, x: 10 },
            { time: 500, x: 20, y: 3 },
            { time: 750, x: 30 },
          ],
          torso: [
            { time: 500, rotation: 0.4 },
            { time: 750, rotation: 0.8 },
          ],
        },
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  for (const bone of ['root', 'torso'])
    await page.getByRole('button', { name: `Expand ${bone} properties`, exact: true }).click();
}
const lane = (page: Page, bone = 'root', property = 'x') =>
  page.locator(`#timeline-tracks .timeline-track-lane[data-bone-id="${bone}"][data-property="${property}"]`);
const key = (page: Page, time: number, bone = 'root', property = 'x') =>
  lane(page, bone, property).locator(`[data-time="${time}"]`);
const selected = (page: Page) => page.locator('.timeline-keyframe[aria-pressed="true"]');
const time = async (page: Page) => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow'));
async function marquee(page: Page, additive = false) {
  const inset = page.locator('.timeline-inset');
  await inset.scrollIntoViewIfNeeded();
  const x = await lane(page).boundingBox();
  const rotation = await lane(page, 'torso', 'rotation').boundingBox();
  if (!x || !rotation) throw new Error('Missing lanes');
  // Start on blank space above the root x marker center; finish below torso rotation's center.
  await page.mouse.move(x.x + x.width * 0.4, x.y + 3);
  if (additive) await page.keyboard.down('Control');
  await page.mouse.down();
  await page.mouse.move(x.x + x.width * 0.6, rotation.y + rotation.height - 3, { steps: 8 });
  await expect(page.locator('.timeline-marquee')).toBeVisible();
  await page.mouse.up();
  if (additive) await page.keyboard.up('Control');
  await expect(page.locator('.timeline-marquee')).toHaveCount(0);
}

test('normal/Ctrl/Cmd/Shift selection, primary context, clear, and playback stay clean', async ({ page }) => {
  await openEditor(page);
  await page.locator('#preview-loop').click();
  await page.locator('#play-pause').click();
  await key(page, 0.25).click();
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await expect(selected(page)).toHaveCount(1);
  await expect(key(page, 0.25)).toHaveAttribute('data-primary', 'true');
  await key(page, 0.5, 'torso', 'rotation').click({ modifiers: ['Meta'] });
  await expect(selected(page)).toHaveCount(2);
  expect(await time(page)).toBe(0.25);
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: root');
  await key(page, 0.75).click({ modifiers: ['Control'] });
  await expect(selected(page)).toHaveCount(3);
  await key(page, 0.25).click({ modifiers: ['Control'] });
  await expect(selected(page)).toHaveCount(2);
  // Also exercise macOS's follow-up event on platforms that do not emit it natively.
  await key(page, 0.25).evaluate((element) =>
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ctrlKey: true })),
  );
  await expect(selected(page)).toHaveCount(2);
  await expect(key(page, 0.5, 'torso', 'rotation')).toHaveAttribute('data-primary', 'true');
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: torso');
  expect(await time(page)).toBe(0.25);
  await key(page, 0).click();
  await key(page, 0.75).click({ modifiers: ['Shift'] });
  await expect(selected(page)).toHaveCount(4);
  await expect(key(page, 0.75)).toHaveAttribute('data-primary', 'true');
  await page.locator('#timeline').press('ArrowRight');
  await expect(key(page, 0.76)).toHaveAttribute('data-primary', 'true');
  await expect(selected(page)).toHaveCount(4);
  await page.locator('#animation-undo').click();
  await page.locator('#timeline').press('Escape');
  await expect(selected(page)).toHaveCount(0);
  await key(page, 0.5).click();
  await lane(page).click({ position: { x: 20, y: 3 }, modifiers: ['Control'] });
  await expect(selected(page)).toHaveCount(1);
  await lane(page).click({ position: { x: 20, y: 3 } });
  await expect(selected(page)).toHaveCount(0);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await key(page, 0.25).click();
  await key(page, 0.5).click({ modifiers: ['Meta'] });
  await key(page, 0.75).dispatchEvent('contextmenu', { button: 2 });
  await expect(selected(page)).toHaveCount(1);
  await expect(key(page, 0.75)).toHaveAttribute('data-primary', 'true');
  await page.locator('#animation-selection').selectOption('walk');
  await expect(selected(page)).toHaveCount(0);
});

test('multi-track marquee/delete/Undo/Redo preserves unrelated keys and commits one history action', async ({
  page,
}) => {
  await openEditor(page);
  // Reveal all rows involved in the marquee without scrolling during the gesture.
  await page.addStyleTag({ content: '.timeline-inset { max-height: 650px; }' });
  await marquee(page);
  await expect(selected(page)).toHaveCount(3);
  await expect(key(page, 0.5)).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page, 0.5, 'root', 'y')).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page, 0.5, 'torso', 'rotation')).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page, 0.75)).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.timeline-panel').screenshot({ path: test.info().outputPath('multi-key-selection.png') });
  await page.locator('#timeline').press('Delete');
  await expect(selected(page)).toHaveCount(0);
  await expect(key(page, 0.5)).toHaveCount(0);
  await expect(key(page, 0.5, 'root', 'y')).toHaveCount(0);
  await expect(key(page, 0.5, 'torso', 'rotation')).toHaveCount(0);
  await expect(key(page, 0.75)).toHaveCount(1);
  await page.locator('#animation-undo').click();
  await expect(key(page, 0.5)).toHaveCount(1);
  await expect(key(page, 0.5, 'root', 'y')).toHaveCount(1);
  await expect(key(page, 0.5, 'torso', 'rotation')).toHaveCount(1);
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await page.locator('#animation-redo').click();
  await expect(key(page, 0.5)).toHaveCount(0);
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
});

test('marquee coordinates follow scrolling and resize; additive union, cancel, and switching release capture', async ({
  page,
}) => {
  await openEditor(page);
  await page.setViewportSize({ width: 1100, height: 1900 });
  await page.addStyleTag({
    content:
      '.timeline-inset { max-width: 600px; max-height: 310px; overflow-x: auto; grid-template-columns: 160px 520px; }',
  });
  await page.locator('.timeline-inset').evaluate((element) => {
    element.scrollLeft = 70;
    element.scrollTop = 60;
  });
  expect(await page.locator('.timeline-inset').evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.locator('.timeline-inset').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await key(page, 0.25).click();
  await marquee(page, true);
  await expect(selected(page)).toHaveCount(4);
  expect(await time(page)).toBe(0.25);
  await page.setViewportSize({ width: 1400, height: 1600 });
  await marquee(page);
  await expect(selected(page)).toHaveCount(3);
  const x = await lane(page).boundingBox();
  if (!x) throw new Error('Missing lane');
  await page.mouse.move(x.x + x.width * 0.1, x.y + 3);
  await page.mouse.down();
  await page.mouse.move(x.x + x.width * 0.8, x.y + 25);
  await expect(page.locator('.timeline-marquee')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.timeline-marquee')).toHaveCount(0);
  await expect(selected(page)).toHaveCount(3);
  await page.locator('#animation-dirty').scrollIntoViewIfNeeded();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  // A switch during a live gesture cancels its transient rectangle and pointer capture.
  await lane(page).scrollIntoViewIfNeeded();
  const fresh = await lane(page).boundingBox();
  await page.mouse.move(fresh!.x + fresh!.width * 0.1, fresh!.y + 3);
  await page.mouse.down();
  await page.mouse.move(fresh!.x + fresh!.width * 0.8, fresh!.y + 25);
  await page.locator('#animation-selection').selectOption('walk');
  await expect(page.locator('.timeline-marquee')).toHaveCount(0);
  await page.mouse.up();
  await expect(selected(page)).toHaveCount(0);
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('a live marquee follows resize and scroll; interrupted pointers preserve prior selection', async ({ page }) => {
  await openEditor(page);
  await page.setViewportSize({ width: 800, height: 1900 });
  await page.addStyleTag({
    content: '.timeline-inset { max-height: 310px; grid-template-columns: 160px minmax(0, 1fr); }',
  });
  await page.locator('.timeline-inset').scrollIntoViewIfNeeded();
  let root = await lane(page).boundingBox();
  if (!root) throw new Error('Missing lane');
  await page.mouse.move(root.x + root.width * 0.4, root.y + 3);
  await page.mouse.down();
  await page.mouse.move(root.x + root.width * 0.6, root.y + 25);
  await page.setViewportSize({ width: 1100, height: 1900 });
  await page.locator('.timeline-inset').evaluate((element) => {
    element.scrollTop = 60;
  });
  root = await lane(page).boundingBox();
  const torso = await lane(page, 'torso', 'rotation').boundingBox();
  if (!root || !torso) throw new Error('Missing resized lanes');
  await page.mouse.move(root.x + root.width * 0.6, torso.y + torso.height - 3);
  await expect(page.locator('.timeline-marquee')).toBeVisible();
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await page.mouse.up();
  await expect(selected(page)).toHaveCount(3);
  for (const ending of ['pointercancel', 'lostpointercapture', 'blur', 'hidden']) {
    const row = await lane(page, 'root', 'y').boundingBox();
    if (!row) throw new Error('Missing cancellation lane');
    await page.mouse.move(row.x + row.width * 0.2, row.y + 3);
    await page.mouse.down();
    await page.mouse.move(row.x + row.width * 0.7, row.y + 25);
    await expect(page.locator('.timeline-marquee')).toBeVisible();
    await page.locator('#timeline').evaluate((element, name) => {
      if (name === 'blur') window.dispatchEvent(new Event('blur'));
      else if (name === 'hidden') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Reflect.deleteProperty(document, 'hidden');
      } else element.dispatchEvent(new PointerEvent(name, { pointerId: 1, bubbles: true }));
    }, ending);
    await page.mouse.up();
    await expect(page.locator('.timeline-marquee')).toHaveCount(0);
    await expect(selected(page)).toHaveCount(3);
  }
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
