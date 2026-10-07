import { readFileSync } from 'node:fs';
import { assert, test } from 'vitest';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { parseTwoBoneIKDefinition } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { Rig } from '../src/engine/Rig.js';
import { characterCatalog } from '../src/shared/characterCatalog.js';
import { getCharacterPreviewSettings } from '../src/shared/characterPreviewSettings.js';
import { paperDollIK } from '../src/shared/paperDollIK.js';

test.each(characterCatalog)('preview chains match the shipped $id rig', ({ id }) => {
  const input: unknown = JSON.parse(
    readFileSync(new URL(`../public/characters/${id}/rig.json`, import.meta.url), 'utf8'),
  );
  const rig = new Rig(parseRigDefinition(input));
  const { ikChains } = getCharacterPreviewSettings(id);
  assert.equal(ikChains.length, 4);
  for (const chain of ikChains) assert.deepEqual(parseTwoBoneIKDefinition(chain, rig), chain);
});

test('preview settings own immutable chain snapshots and reuse them between views', () => {
  const settings = getCharacterPreviewSettings('demo-puppet');
  assert.strictEqual(getCharacterPreviewSettings('demo-puppet'), settings);
  assert.strictEqual(getCharacterPreviewSettings('random-paperdoll-sketch'), settings);
  assert.isTrue(Object.isFrozen(settings));
  assert.isTrue(Object.isFrozen(settings.ikChains));
  assert.notStrictEqual(settings.ikChains, paperDollIK);
  for (const [index, chain] of settings.ikChains.entries()) {
    assert.notStrictEqual(chain, paperDollIK[index]);
    assert.isTrue(Object.isFrozen(chain));
    if (chain.endOffset) assert.isTrue(Object.isFrozen(chain.endOffset));
  }
});

test.each(['editor-only-character', 'constructor', 'toString', '__proto__'])(
  'characters without registered preview settings load without mandatory chains: %s',
  (id) => {
    const settings = getCharacterPreviewSettings(id);
    assert.deepEqual(settings.ikChains, []);
    assert.isTrue(Object.isFrozen(settings));
    assert.isTrue(Object.isFrozen(settings.ikChains));
  },
);
