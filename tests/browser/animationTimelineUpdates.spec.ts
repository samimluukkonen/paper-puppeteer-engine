import { expect } from '@playwright/test';
import { animationFileSchema } from '../../src/engine/schemas.js';
import { test } from './fixtures.js';

test('edits and selection leave unrelated dense timeline markers untouched', async ({ page }) => {
  await page.route('**/animations/idle.json', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...animationFileSchema.parse(await response.json()),
        tracks: {
          root: Array.from({ length: 128 }, (_, index) => ({ time: index * 10, x: index })),
          torso: [{ time: 0, y: 0 }],
        },
        events: [],
      },
    });
  });
  await page.goto('animation-editor/');
  await expect(page.locator('#animation-status')).toHaveText('Validation: OK');
  for (const bone of ['root', 'torso'])
    await page.getByRole('button', { name: `Expand ${bone} properties`, exact: true }).click();
  await page.getByRole('button', { name: 'Select torso x track', exact: true }).click();
  const edit = await page.evaluate(() => {
    const lane = document.querySelector('#timeline-tracks [data-bone-id="root"][data-property="x"]')!;
    const label = document.querySelector('#timeline-track-labels [data-bone-id="root"][data-property="x"]')!;
    const observer = new MutationObserver(() => {});
    for (const element of [lane, label])
      observer.observe(element, { subtree: true, attributes: true, childList: true, characterData: true });
    document
      .querySelector<HTMLInputElement>('#animation-bone-fields [data-property="x"]')!
      .closest('.animation-property')!
      .querySelector<HTMLButtonElement>('button')!
      .click();
    const mutations = observer.takeRecords().length;
    observer.disconnect();
    return mutations;
  });
  expect(edit).toBe(0);
  await expect(page.locator('#animation-undo')).toBeEnabled();
  const reads = await page.evaluate(() => {
    // oxlint-disable-next-line typescript/unbound-method -- Instrument the method and preserve its receiver with call below.
    const getAttribute = Element.prototype.getAttribute;
    let markerReads = 0;
    Element.prototype.getAttribute = function (name: string) {
      if (this.classList.contains('timeline-keyframe')) markerReads++;
      return getAttribute.call(this, name);
    };
    try {
      const lane = document.querySelector('#timeline-tracks [data-bone-id="root"][data-property="x"]')!;
      lane.querySelector<HTMLButtonElement>('.timeline-keyframe')!.click();
      return markerReads;
    } finally {
      Element.prototype.getAttribute = getAttribute;
    }
  });
  expect(reads).toBeLessThan(10);
  await expect(page.locator('.timeline-keyframe[aria-pressed="true"]')).toHaveCount(1);
  await page.locator('#animation-undo').click();
  await expect(page.locator('#animation-dirty')).toHaveText('No unsaved changes');
});
