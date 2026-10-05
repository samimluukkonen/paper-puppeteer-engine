import { assert, test } from 'vitest';
import {
  demoCharacterProfiles,
  demoPuppetProfile,
  getDemoCharacterProfile,
  sketchProfile,
} from '../src/demo/demoCharacterProfiles.js';
import { demoIK } from '../src/demo/demoIK.js';
import { characterChoices } from '../src/ui/characterSelection.js';

test('character selection and presentation resolve the same registered profiles', () => {
  assert.deepEqual(
    characterChoices,
    demoCharacterProfiles.map(({ id, label }) => ({ id, label })),
  );
  assert.strictEqual(getDemoCharacterProfile('demo-puppet'), demoPuppetProfile);
  assert.strictEqual(getDemoCharacterProfile('random-paperdoll-sketch'), sketchProfile);
  assert.throws(() => getDemoCharacterProfile('unknown'), /No demo presentation profile/);
});

test('shared presentation settings are immutable and own their IK definitions', () => {
  for (const profile of demoCharacterProfiles) {
    assert.isTrue(Object.isFrozen(profile));
    assert.isTrue(Object.isFrozen(profile.katana.gripOffset));
    assert.isTrue(Object.isFrozen(profile.feet.sway));
    assert.isTrue(Object.isFrozen(profile.clips));
    assert.isTrue(Object.isFrozen(profile.upperBody.mask));
    assert.isTrue(Object.isFrozen(profile.appearance));
    assert.isTrue(Object.isFrozen(profile.ikChains));
    assert.notStrictEqual(profile.ikChains, demoIK);
    for (const [index, chain] of profile.ikChains.entries()) {
      assert.notStrictEqual(chain, demoIK[index]);
      assert.isTrue(Object.isFrozen(chain));
    }
  }
  assert.isFalse(Object.isFrozen(demoIK));
});
