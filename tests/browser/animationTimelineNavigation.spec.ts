import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { timelineControl, animationMenuControl, test } from './fixtures.js';

async function openEditor(page: Page, duration = 10000): Promise<void> {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        duration,
        loop: false,
        playback: { mode: 'stepped', fps: 12 },
        tracks: {
          root:
            duration > 0
              ? [
                  { time: 0, x: 0 },
                  { time: duration * 0.4, x: 4 },
                  { time: duration * 0.5, x: 5, y: 10 },
                  { time: duration, x: 10 },
                ]
              : [{ time: 0, x: 0 }],
        },
        ikTracks: { rightArmIK: [{ time: duration * 0.5, x: 20 }] },
        events: [{ time: duration * 0.5, name: 'middle' }],
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
}

async function jump(page: Page, time: string): Promise<void> {
  await page.locator('#timeline-time-input').fill(time);
  await page.locator('#timeline-time-input').press('Enter');
}

async function pointerTime(page: Page, clientX: number): Promise<number> {
  return page.locator('#timeline').evaluate((element, x) => {
    const bounds = element.getBoundingClientRect();
    const duration = Number(document.querySelector('#timeline-ruler')!.getAttribute('aria-valuemax'));
    return ((x - bounds.left) / bounds.width) * duration;
  }, clientX);
}

async function checkAlignment(page: Page): Promise<void> {
  const difference = await page.evaluate(() => {
    const timeline = document.querySelector<HTMLElement>('#timeline')!;
    const playhead = document.querySelector<HTMLElement>('#timeline-playhead')!;
    const ruler = document.querySelector<HTMLElement>('#timeline-ruler')!;
    const width = timeline.getBoundingClientRect().width;
    const duration = Number(ruler.getAttribute('aria-valuemax'));
    const expected = (Number(ruler.getAttribute('aria-valuenow')) / duration) * width;
    const differences = Array.from(
      document.querySelectorAll<HTMLElement>('.timeline-keyframe, .timeline-event'),
      (marker) => Math.abs(parseFloat(marker.style.left) - (Number(marker.dataset.time) / duration) * width),
    );
    return Math.max(Math.abs(parseFloat(playhead.style.left) - expected), ...differences);
  });
  expect(difference).toBeLessThan(0.1);
}

test('pointer zoom, pan, zoomed scrubbing and dragging retain the shared time projection', async ({ page }) => {
  test.setTimeout(60000);
  await openEditor(page);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await page
    .getByRole('button', { name: 'Expand rightArmIK properties', exact: true })
    .evaluate((element) => (element as HTMLElement).click());
  await (await timelineControl(page, '#timeline-zoom')).selectOption('4');
  await jump(page, '5');
  const inset = (await page.locator('.timeline-inset').boundingBox())!;
  const labels = (await page.locator('.timeline-label-column').boundingBox())!;
  const ruler = (await page.locator('#timeline-ruler').boundingBox())!;
  const x = inset.x + labels.width + (inset.width - labels.width) * 0.6;
  const before = await pointerTime(page, x);
  await page.mouse.move(x, ruler.y + 18);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  // Native wheel coordinates/scroll offsets can round to a CSS pixel; compare the anchored pixel.
  await expect
    .poll(async () => {
      const width = (await page.locator('#timeline').boundingBox())!.width;
      return (Math.abs((await pointerTime(page, x)) - before) / 10) * width;
    })
    .toBeLessThan(1);
  await expect(page.locator('#timeline-zoom')).not.toHaveValue('4');
  const scroll = await page.locator('.timeline-inset').evaluate((element) => element.scrollLeft);
  await page.locator('.timeline-inset').evaluate((element) => {
    (element as HTMLElement).dataset.scrollEnded = 'false';
    element.addEventListener(
      'scrollend',
      () => {
        (element as HTMLElement).dataset.scrollEnded = 'true';
      },
      { once: true },
    );
  });
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Shift');
  await expect
    .poll(() => page.locator('.timeline-inset').evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(scroll);
  await expect(page.locator('.timeline-inset')).toHaveAttribute('data-scroll-ended', 'true');
  const scrubTime = await pointerTime(page, x);
  await page.mouse.click(x, ruler.y + 18);
  await expect
    .poll(() => page.locator('#timeline-ruler').getAttribute('aria-valuenow').then(Number))
    .toBeCloseTo(scrubTime, 5);
  await checkAlignment(page);
  await (await timelineControl(page, '#timeline-zoom')).selectOption('4');
  await jump(page, '5');
  const marker = page.getByRole('button', { name: 'Select root x key at 4 s', exact: true });
  const box = (await marker.boundingBox())!;
  const width = (await page.locator('#timeline').boundingBox())!.width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + width * 0.025, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(
        await page
          .locator(
            '.timeline-property-track[data-bone-id="root"][data-property="x"] .timeline-keyframe[aria-pressed="true"]',
          )
          .getAttribute('data-time'),
      ),
    )
    .toBeCloseTo(4.25, 6);
  await page.locator('#animation-undo').click();
  await expect(marker).toBeVisible();
  await (await animationMenuControl(page, '#timeline-fit-animation')).click();
  await expect(page.locator('#timeline-zoom')).toHaveValue('1');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('fit includes hidden keys across properties; time and frame jumps, shortcuts and resizing preserve selection', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await page.getByRole('button', { name: 'Select root x key at 4 s', exact: true }).click();
  await page.getByRole('button', { name: 'Select root y key at 5 s', exact: true }).click({ modifiers: ['Control'] });
  await (await timelineControl(page, '#timeline-search')).fill('no matches');
  await (await animationMenuControl(page, '#timeline-fit-selection')).click();
  await expect(page.locator('#timeline-zoom')).toHaveValue('8');
  const bounds = (await page.locator('.timeline-inset').boundingBox())!;
  const labels = (await page.locator('.timeline-label-column').boundingBox())!;
  const viewCenter = bounds.x + labels.width + (bounds.width - labels.width) / 2;
  expect(await pointerTime(page, viewCenter)).toBeCloseTo(4.5, 2);
  await jump(page, '4.123456789');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '4.123456789');
  await page.locator('#timeline-frame-input').fill('59');
  await page.locator('#timeline-frame-input').press('Enter');
  await expect
    .poll(() => page.locator('#timeline-ruler').getAttribute('aria-valuenow').then(Number))
    .toBeCloseTo(59 / 12, 10);
  await expect(page.locator('.timeline-keyframe[aria-pressed="true"]')).toHaveCount(2);
  await (await animationMenuControl(page, '#timeline-center-playhead')).click();
  await checkAlignment(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect
    .poll(async () => {
      const viewport = (await page.locator('.timeline-inset').boundingBox())!;
      const labels = (await page.locator('.timeline-label-column').boundingBox())!;
      return pointerTime(page, viewport.x + labels.width + (viewport.width - labels.width) / 2);
    })
    .toBeCloseTo(59 / 12, 1);
  await checkAlignment(page);
  await page.locator('#timeline-ruler').press('End');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '10');
  await page.locator('#timeline-ruler').press('Home');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0');
  await page.locator('#timeline-ruler').press('f');
  await expect(page.locator('#timeline-zoom')).toHaveValue('1');
  await page.locator('#timeline-ruler').press('=');
  await expect(page.locator('#timeline-zoom')).toHaveValue('2');
  await page.locator('#timeline-ruler').press('-');
  await expect(page.locator('#timeline-zoom')).toHaveValue('1');
  await page.locator('#timeline-time-input').press('End');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#animation-undo')).toBeDisabled();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('playhead follow can be disabled and scrolls near an edge when enabled', async ({ page }) => {
  await openEditor(page);
  await (await timelineControl(page, '#timeline-zoom')).selectOption('8');
  await (await animationMenuControl(page, '#timeline-follow')).uncheck();
  await page.locator('#play-pause').click();
  await expect
    .poll(() => page.locator('#timeline-ruler').getAttribute('aria-valuenow').then(Number))
    .toBeGreaterThan(1.3);
  expect(await page.locator('.timeline-inset').evaluate((element) => element.scrollLeft)).toBe(0);
  await (await animationMenuControl(page, '#timeline-follow')).check();
  await expect.poll(() => page.locator('.timeline-inset').evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.locator('#play-pause').click();
  await checkAlignment(page);
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('empty animation selection keeps zero-duration navigation finite and controls disabled', async ({ page }) => {
  await openEditor(page);
  await (await timelineControl(page, '#timeline-zoom')).selectOption('128');
  await page.locator('#animation-selection').selectOption('');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuemax', '0');
  await expect(page.locator('#current-time')).toHaveText('0.000 / 0.000 s');
  for (const selector of [
    '#play-pause',
    '#timeline-zoom',
    '#timeline-time-input',
    '#timeline-fit-selection',
    '#timeline-fit-animation',
    '#timeline-center-playhead',
  ])
    await expect(page.locator(selector)).toBeDisabled();
  await expect(page.locator('#timeline-frame-control')).toBeHidden();
  await expect(page.locator('#timeline-zoom')).toHaveValue('1');
  await expect(page.locator('#timeline-playhead')).toHaveCSS('left', '0px');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
