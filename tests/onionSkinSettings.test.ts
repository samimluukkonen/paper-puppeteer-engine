import { assert, test } from 'vitest';
import {
  DEFAULT_ONION_SKIN_SETTINGS,
  updateOnionSkinSettings,
} from '../src/devtools/animation-editor/onionSkinSettings.js';

test('onion preferences are frozen detached snapshots with sensible independent defaults', () => {
  const defaults = DEFAULT_ONION_SKIN_SETTINGS;
  assert.isTrue(Object.isFrozen(defaults));
  assert.isFalse(defaults.enabled);
  assert.equal(defaults.previousCount, 1);
  assert.equal(defaults.nextCount, 1);
  assert.equal(defaults.previousOpacity, 0.22);
  assert.equal(defaults.nextOpacity, 0.22);
  assert.notEqual(defaults.previousTint, defaults.nextTint);
  const next = updateOnionSkinSettings(defaults, { enabled: true, previousCount: 0 });
  assert.isTrue(Object.isFrozen(next));
  assert.isTrue(next.enabled);
  assert.equal(next.previousCount, 0);
  assert.equal(next.nextCount, 1);
  assert.isFalse(defaults.enabled);
  assert.equal(defaults.previousCount, 1);
});

test('finite settings clamp and round within counts, spacing, opacity and RGB bounds', () => {
  assert.deepEqual(
    updateOnionSkinSettings(DEFAULT_ONION_SKIN_SETTINGS, {
      previousCount: -10,
      nextCount: 100,
      frameSpacing: 0,
      previousOpacity: -1,
      nextOpacity: 10,
      previousTint: -1,
      nextTint: 0x1000000,
    }),
    {
      enabled: false,
      previousCount: 0,
      nextCount: 3,
      frameSpacing: 1,
      previousOpacity: 0.05,
      nextOpacity: 0.6,
      previousTint: 0,
      nextTint: 0xffffff,
    },
  );
  const rounded = updateOnionSkinSettings(DEFAULT_ONION_SKIN_SETTINGS, {
    previousCount: 1.8,
    nextCount: 0.2,
    frameSpacing: 99,
  });
  assert.equal(rounded.previousCount, 2);
  assert.equal(rounded.nextCount, 0);
  assert.equal(rounded.frameSpacing, 5);
});

test.each([NaN, Infinity, -Infinity])('nonfinite preferences %s retain existing settings', (value) => {
  const current = updateOnionSkinSettings(DEFAULT_ONION_SKIN_SETTINGS, {
    enabled: true,
    previousCount: 2,
    nextOpacity: 0.5,
  });
  assert.deepEqual(
    updateOnionSkinSettings(current, {
      previousCount: value,
      nextCount: value,
      frameSpacing: value,
      previousOpacity: value,
      nextOpacity: value,
      previousTint: value,
      nextTint: value,
    }),
    current,
  );
  assert.deepEqual(updateOnionSkinSettings(current, {}), current);
});
