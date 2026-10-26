import { expect, type Page } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { timelineControl, animationHierarchy, test, inspectorControl } from './fixtures.js';

async function openEditor(page: Page): Promise<void> {
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-selection')).toHaveValue('idle');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  await expect(page.locator('#animation-stage canvas')).toBeVisible();
}

test('demo tracks match hierarchy order and synchronize bone/property selection with all surfaces', async ({
  page,
}) => {
  await openEditor(page);
  const labels = page.locator('#timeline-track-labels');
  const expectedBones = await (await animationHierarchy(page)).locator('.tree-entry').allTextContents();
  expect(
    await labels
      .locator('.timeline-bone-track')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-bone-id'))),
  ).toEqual(expectedBones);
  const timeline = page.locator('#timeline');
  await timeline.press('Shift+ArrowRight');
  const initialTime = await page.locator('#timeline-ruler').getAttribute('aria-valuenow');
  await (await animationHierarchy(page)).getByRole('button', { name: 'rightForearm', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
  await expect(labels.getByRole('button', { name: 'Select bone rightForearm', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await labels.getByRole('button', { name: 'Expand rightForearm properties', exact: true }).click();
  await expect(
    labels.locator('.timeline-property-track[data-bone-id="rightForearm"] .timeline-track-select'),
  ).toHaveText(['x', 'y', 'rotation', 'scaleX', 'scaleY']);
  await labels.getByRole('button', { name: 'Select rightForearm rotation track', exact: true }).click();
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: rightForearm');
  await expect(
    (await animationHierarchy(page)).getByRole('button', { name: 'rightForearm', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(labels.getByRole('button', { name: 'Select rightForearm rotation track', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.locator('#timeline-tracks [data-bone-id="rightForearm"][data-property="rotation"]'),
  ).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('#timeline-ruler')).toHaveAttribute('aria-valuenow', initialTime!);

  await labels.getByRole('button', { name: 'Select bone torso', exact: true }).click();
  await expect((await animationHierarchy(page)).getByRole('button', { name: 'torso', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(labels.getByRole('button', { name: 'Select rightForearm rotation track', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: torso');

  await timeline.press('Home');
  const canvas = page.locator('#animation-stage canvas');
  // Camera fitting changes the projected root position. Locate its rendered selection ring,
  // switch selection away, then pick that same point through the actual canvas input path.
  await (await animationHierarchy(page)).getByRole('button', { name: 'root', exact: true }).click();
  await inspectorControl(page, '#animation-bone-inspector');
  let rootPoint: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      const screenshot = await canvas.screenshot();
      rootPoint = await page.evaluate(
        async (url) => {
          const image = new Image();
          image.src = url;
          await image.decode();
          const bitmap = document.createElement('canvas');
          bitmap.width = image.width;
          bitmap.height = image.height;
          const context = bitmap.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
          let x = 0;
          let y = 0;
          let count = 0;
          for (let index = 0; index < data.length; index += 4) {
            if (data[index] !== 0xb7 || data[index + 1] !== 0x54 || data[index + 2] !== 0x3a) continue;
            const pixel = index / 4;
            x += pixel % bitmap.width;
            y += Math.floor(pixel / bitmap.width);
            count++;
          }
          return count ? { x: x / count, y: y / count } : null;
        },
        `data:image/png;base64,${screenshot.toString('base64')}`,
      );
      return rootPoint !== null;
    })
    .toBe(true);
  if (!rootPoint) throw new Error('Missing rendered root selection ring.');
  await labels.getByRole('button', { name: 'Select bone torso', exact: true }).click();
  await (await timelineControl(page, '#timeline-search')).fill('IK:');
  await canvas.click({ position: rootPoint });
  await expect(page.locator('#animation-bone-title')).toHaveText('Bone: root');
  await expect(page.locator('#timeline-selection-status')).toContainText('The selected track is hidden');
  await (await timelineControl(page, '#timeline-reveal-selection')).click();
  await expect(page.locator('#timeline-search')).toHaveValue('');
  await expect(labels.getByRole('button', { name: 'Select bone root', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect((await animationHierarchy(page)).getByRole('button', { name: 'root', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const collapse = labels.getByRole('button', { name: 'Collapse rightForearm properties', exact: true });
  await collapse.focus();
  await page.keyboard.press('Space');
  await expect(labels.getByRole('button', { name: 'Expand rightForearm properties', exact: true })).toBeFocused();
  await expect(labels.locator('.timeline-property-track[data-bone-id="rightForearm"]')).toHaveCount(0);
  await expect(page.locator('#play-pause')).toHaveText('Play');
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
  await expect(page.locator('#animation-undo')).toBeDisabled();
});

test('labels and full-width lanes stay aligned through expansion, scrolling, playback, scrubbing and resize', async ({
  page,
}) => {
  await openEditor(page);
  for (const bone of ['root', 'torso', 'rightUpperArm'])
    await page.getByRole('button', { name: `Expand ${bone} properties`, exact: true }).click();
  await page.getByRole('button', { name: 'Select torso y track', exact: true }).click();
  const alignment = async () => {
    const result = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('#timeline-track-labels .timeline-track-label'));
      const lanes = Array.from(document.querySelectorAll('#timeline-tracks .timeline-track-lane'));
      const ruler = document.querySelector('#timeline-ruler')!.getBoundingClientRect();
      return (
        labels.length === lanes.length &&
        labels.every((label, index) => {
          const a = label.getBoundingClientRect();
          const b = lanes[index]!.getBoundingClientRect();
          return (
            Math.abs(a.top - b.top) < 0.1 &&
            a.height === b.height &&
            Math.abs(b.left - ruler.left) < 0.1 &&
            Math.abs(b.width - ruler.width) < 0.1
          );
        })
      );
    });
    expect(result).toBe(true);
  };
  await page.locator('.timeline-inset').evaluate((element) => {
    element.scrollTop = 90;
  });
  await alignment();
  const timeline = page.locator('#timeline');
  const box = await timeline.boundingBox();
  const viewport = await page.locator('.timeline-inset').boundingBox();
  if (!box || !viewport) throw new Error('Missing timeline bounds.');
  const scrollBeforeScrub = await page.locator('.timeline-inset').evaluate((element) => element.scrollTop);
  const pageScrollBeforeScrub = await page.evaluate(() => window.scrollY);
  // Scrub a visible lane beneath the floating ruler.
  await page.mouse.click(box.x + box.width * 0.4, viewport.y + 60);
  expect(await page.locator('.timeline-inset').evaluate((element) => element.scrollTop)).toBe(scrollBeforeScrub);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeScrub);
  expect(Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow'))).toBeCloseTo(1.8 * 0.4, 2);
  const playhead = await page.locator('#timeline-playhead').boundingBox();
  expect(playhead!.x).toBeCloseTo(box.x + box.width * 0.4, 0);
  const lastLane = await page.locator('#timeline-tracks .timeline-track-lane').last().boundingBox();
  expect(playhead!.y + playhead!.height).toBeCloseTo(lastLane!.y + lastLane!.height, 0);

  await page.locator('#preview-loop').click();
  await page.locator('#play-pause').click();
  const scrollTop = await page.locator('.timeline-inset').evaluate((element) => element.scrollTop);
  const time = Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow'));
  await expect
    .poll(async () => Number(await page.locator('#timeline-ruler').getAttribute('aria-valuenow')))
    .not.toBe(time);
  await expect(page.getByRole('button', { name: 'Select torso y track', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Collapse torso properties', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(await page.locator('.timeline-inset').evaluate((element) => element.scrollTop)).toBe(scrollTop);
  await page.getByRole('button', { name: 'Expand head properties', exact: true }).click();
  await expect(page.locator('#play-pause')).toHaveText('Pause');
  await page.locator('#play-pause').click();
  await alignment();
  await page.locator('.timeline-inset').screenshot({ path: test.info().outputPath('timeline-tracks-desktop.png') });
  await page.setViewportSize({ width: 620, height: 1100 });
  await alignment();
  await timeline.press('End');
  // ResizeObserver publishes the new projection asynchronously after viewport layout.
  await expect
    .poll(async () => {
      const resized = await timeline.boundingBox();
      const endHead = await page.locator('#timeline-playhead').boundingBox();
      return Math.abs(endHead!.x - resized!.x - resized!.width);
    })
    .toBeLessThan(0.5);
  await page.locator('.timeline-inset').screenshot({ path: test.info().outputPath('timeline-tracks-narrow.png') });
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});

test('unkeyed bones/properties remain available, key presence refreshes, and no selection stays navigable', async ({
  page,
}) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...animationFileSchema.parse(await response.json()), tracks: {}, events: [] } });
  });
  await openEditor(page);
  const labels = page.locator('#timeline-track-labels');
  expect(await labels.locator('.timeline-bone-track').count()).toBeGreaterThan(1);
  await expect(labels.locator('[data-has-keys="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand root properties', exact: true }).click();
  await page.getByRole('button', { name: 'Select root x track', exact: true }).click();
  await page.getByRole('button', { name: 'Set X key', exact: true }).click();
  await expect(labels.locator('[data-bone-id="root"][data-property="x"]')).toHaveAttribute('data-has-keys', 'true');
  await expect(labels.locator('.timeline-bone-track[data-bone-id="root"]')).toHaveAttribute('data-has-keys', 'true');
  await page.locator('#animation-undo').click();
  await expect(labels.locator('[data-has-keys="true"]')).toHaveCount(0);
  await page.locator('#animation-selection').selectOption('');
  await expect(page.locator('#timeline')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#current-time')).toHaveText('0.000 / 0.000 s');
  await expect(page.getByRole('button', { name: 'Collapse root properties', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: 'Select root rotation track', exact: true }).click();
  await expect((await animationHierarchy(page)).getByRole('button', { name: 'root', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
