import { assert, test } from 'vitest';
import { placeGuideCard, spotlightRectangle } from '../src/ui/guidePositioning.js';

const viewport = { width: 1280, height: 900 };
const card = { width: 360, height: 300 };

test('spotlights pad visible targets, clip at viewport edges, and reject missing/offscreen/invalid geometry', () => {
  assert.deepEqual(spotlightRectangle({ x: 20, y: 30, width: 100, height: 40 }, viewport), {
    x: 16,
    y: 26,
    width: 108,
    height: 48,
  });
  assert.deepEqual(spotlightRectangle({ x: -20, y: 880, width: 100, height: 40 }, viewport), {
    x: 0,
    y: 876,
    width: 84,
    height: 24,
  });
  for (const rect of [
    null,
    { x: 1280, y: 10, width: 10, height: 10 },
    { x: 10, y: -50, width: 10, height: 20 },
    { x: NaN, y: 10, width: 10, height: 10 },
    { x: 10, y: 10, width: 0, height: 10 },
  ]) {
    assert.isNull(spotlightRectangle(rect, viewport));
  }
});

test('cards use right, left, below, or above space without obscuring the spotlight', () => {
  assert.deepEqual(placeGuideCard({ x: 20, y: 50, width: 100, height: 100 }, card, viewport), { left: 136, top: 50 });
  assert.deepEqual(placeGuideCard({ x: 1100, y: 50, width: 100, height: 100 }, card, viewport), { left: 724, top: 50 });
  assert.deepEqual(placeGuideCard({ x: 300, y: 50, width: 680, height: 100 }, card, viewport), { left: 300, top: 166 });
  assert.deepEqual(placeGuideCard({ x: 300, y: 750, width: 680, height: 100 }, card, viewport), {
    left: 300,
    top: 434,
  });
});

test('large targets, resized cards, and missing targets keep the entire card inside the desktop viewport', () => {
  for (const target of [null, { x: 0, y: 0, ...viewport }, { x: 1200, y: 850, width: 80, height: 50 }]) {
    for (const size of [card, { width: 500, height: 700 }]) {
      const placed = placeGuideCard(target, size, viewport);
      assert.isAtLeast(placed.left, 16);
      assert.isAtLeast(placed.top, 16);
      assert.isAtMost(placed.left + size.width, viewport.width - 16);
      assert.isAtMost(placed.top + size.height, viewport.height - 16);
    }
  }
  assert.deepEqual(placeGuideCard(null, card, viewport), { left: 460, top: 300 });
});
