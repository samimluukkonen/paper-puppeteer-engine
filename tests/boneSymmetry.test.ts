import { assert, test } from 'vitest';
import {
  type BoneSymmetryMapping,
  type BoneSymmetryPair,
  createBoneSymmetryMapping,
  inferBoneSymmetryPairs,
  validateBoneSymmetryMapping,
} from '../src/devtools/shared/boneSymmetry.js';
import { Rig } from '../src/engine/Rig.js';
import type { BoneDefinition } from '../src/engine/types.js';
import { demoRig } from './helpers/demoCharacter.js';

const pair = (leftBoneId: string, rightBoneId: string): BoneSymmetryPair => ({ leftBoneId, rightBoneId });
function namedRig(ids: readonly string[]): Rig {
  return new Rig({ root: 'root', bones: [{ id: 'root' }, ...ids.map((id) => ({ id, parent: 'root' }))] });
}
function mappingFor(rig: Rig, pairs: readonly BoneSymmetryPair[]): BoneSymmetryMapping {
  const result = createBoneSymmetryMapping(rig, { manualPairs: pairs });
  assert.isTrue(result.success);
  return result.mapping;
}

for (const [left, right] of [
  ['leftArm', 'rightArm'],
  ['LeftArm', 'RightArm'],
  ['arm_L', 'arm_R'],
  ['arm.left', 'arm.right'],
  ['L_Arm', 'R_Arm'],
  ['upperLeftArm', 'upperRightArm'],
  ['LEFT_ARM', 'RIGHT_ARM'],
  ['left-forearm', 'right-forearm'],
  ['L_IKTarget', 'R_IKTarget'],
] as const) {
  test(`automatic matching recognizes complete side tokens in ${left} / ${right}`, () => {
    const candidates = inferBoneSymmetryPairs(namedRig([left, right]));
    assert.deepEqual(candidates.pairs, [pair(left, right)]);
    assert.deepEqual(candidates.issues, []);
  });
}

test('unrelated substrings, bare side names, and missing counterparts stay unpaired', () => {
  const ids = [
    'brightArm',
    'bleftArm',
    'Leftover',
    'Rightover',
    'upright',
    'upLeftover',
    'leftarm',
    'rightarm',
    'L',
    'R',
    'left',
    'right',
    'leftFoot',
    'head',
  ];
  assert.deepEqual(inferBoneSymmetryPairs(namedRig(ids)), { pairs: [], issues: [] });
});

test('ambiguous case and delimiter aliases never silently choose a counterpart', () => {
  const rig = namedRig(['leftArm', 'rightArm', 'RightArm', 'arm_L', 'arm_R', 'arm.R', 'leftFoot', 'rightFoot']);
  const candidates = inferBoneSymmetryPairs(rig);
  assert.deepEqual(candidates.pairs, [pair('leftFoot', 'rightFoot')]);
  assert.deepEqual(
    candidates.issues.map((entry) => entry.code),
    ['ambiguous-match', 'ambiguous-match'],
  );
  assert.deepEqual(
    candidates.issues.map((entry) => entry.boneIds),
    [
      ['RightArm', 'leftArm', 'rightArm'],
      ['arm.R', 'arm_L', 'arm_R'],
    ],
  );
  assert.isTrue(candidates.issues.every((entry) => entry.severity === 'warning'));
});

test('multiple side tokens are ambiguous rather than guessed', () => {
  const candidates = inferBoneSymmetryPairs(namedRig(['leftArm_R', 'rightArm_L', 'leftLeftHand']));
  assert.deepEqual(candidates.pairs, []);
  assert.deepEqual(
    candidates.issues.map((entry) => entry.code),
    ['ambiguous-name', 'ambiguous-name', 'ambiguous-name'],
  );
});

test('a manual pair resolves automatic ambiguity and reserves both sides', () => {
  const rig = namedRig(['leftArm', 'rightArm', 'RightArm', 'leftFoot', 'rightFoot']);
  const manualPairs = [pair('leftArm', 'RightArm')];
  const candidates = inferBoneSymmetryPairs(rig, manualPairs);
  assert.deepEqual(candidates, { pairs: [pair('leftFoot', 'rightFoot')], issues: [] });
  const result = createBoneSymmetryMapping(rig, { manualPairs, automaticCandidates: candidates.pairs });
  assert.isTrue(result.success);
  assert.deepEqual(result.mapping.pairs, [...manualPairs, ...candidates.pairs]);
  assert.equal(result.mapping.getMirroredBoneId('leftArm'), 'RightArm');
  assert.isNull(result.mapping.getMirroredBoneId('rightArm'));
});

test('manual assignments override every automatic pair touching either manually assigned bone', () => {
  const rig = namedRig(['leftArm', 'rightArm', 'leftHand', 'rightHand']);
  const result = createBoneSymmetryMapping(rig, {
    manualPairs: [pair('leftArm', 'rightHand')],
    automaticCandidates: inferBoneSymmetryPairs(rig).pairs,
  });
  assert.isTrue(result.success);
  assert.deepEqual(result.mapping.pairs, [pair('leftArm', 'rightHand')]);
  assert.deepEqual(result.mapping.unpairedBoneIds, ['leftHand', 'rightArm', 'root']);
});

test('arbitrary IDs work bidirectionally, including IDs unsafe as ordinary object keys', () => {
  const rig = namedRig(['artist-17', 'socket:28', 'toString', 'constructor']);
  const mapping = mappingFor(rig, [pair('artist-17', 'socket:28'), pair('toString', 'constructor')]);
  assert.equal(mapping.getMirroredBoneId('artist-17'), 'socket:28');
  assert.equal(mapping.getMirroredBoneId('socket:28'), 'artist-17');
  assert.equal(mapping.getMirroredBoneId('toString'), 'constructor');
  assert.equal(mapping.getMirroredBoneId('constructor'), 'toString');
  assert.isNull(mapping.getMirroredBoneId('root'));
  assert.isNull(mapping.getMirroredBoneId('unknown'));
});

test('automatic matching is optional and does not install candidates', () => {
  const rig = namedRig(['leftArm', 'rightArm', 'pelvis', 'torso', 'head']);
  const empty = createBoneSymmetryMapping(rig);
  assert.isTrue(empty.success);
  inferBoneSymmetryPairs(rig);
  assert.deepEqual(empty.mapping.pairs, []);
  assert.isNull(empty.mapping.getMirroredBoneId('leftArm'));
  const accepted = createBoneSymmetryMapping(rig, { automaticCandidates: inferBoneSymmetryPairs(rig).pairs });
  assert.deepEqual(accepted.mapping!.unpairedBoneIds, ['head', 'pelvis', 'root', 'torso']);
});

for (const [label, pairs, code] of [
  ['missing reference', [pair('leftArm', 'absent')], 'missing-bone'],
  ['self assignment', [pair('leftArm', 'leftArm')], 'self-pair'],
  ['duplicate assignment', [pair('leftArm', 'rightArm'), pair('leftArm', 'rightArm')], 'duplicate-pair'],
  ['several partners', [pair('leftArm', 'rightArm'), pair('leftArm', 'rightHand')], 'multiple-partners'],
  [
    'conflicting reciprocal orientation',
    [pair('leftArm', 'rightArm'), pair('rightArm', 'leftArm')],
    'invalid-reciprocal',
  ],
] as const) {
  test(`validation rejects ${label} with structured diagnostics and no lookup`, () => {
    const result = createBoneSymmetryMapping(namedRig(['leftArm', 'rightArm', 'rightHand']), { manualPairs: pairs });
    assert.isFalse(result.success);
    assert.isNull(result.mapping);
    const entry = result.issues.find((entry) => entry.code === code)!;
    assert.equal(entry.severity, 'error');
    assert.isNumber(entry.pairIndex);
    assert.match(entry.path!, /^pairs\[\d+\]$/);
    assert.isAbove(entry.boneIds.length, 0);
    assert.isTrue(Object.isFrozen(entry));
  });
}

test('invalid manual assignments cannot be silently rescued by automatic candidates', () => {
  const rig = namedRig(['leftArm', 'rightArm']);
  const manualPairs = [pair('leftArm', 'missing')];
  assert.deepEqual(inferBoneSymmetryPairs(rig, manualPairs).pairs, []);
  const result = createBoneSymmetryMapping(rig, {
    manualPairs,
    automaticCandidates: inferBoneSymmetryPairs(rig).pairs,
  });
  assert.isFalse(result.success);
  assert.equal(result.issues[0]!.code, 'missing-bone');
});

test('invalid accepted candidates are validated too', () => {
  const rig = namedRig(['leftArm', 'rightArm']);
  const result = createBoneSymmetryMapping(rig, {
    automaticCandidates: [pair('leftArm', 'rightArm'), pair('leftArm', 'unknown')],
  });
  assert.isFalse(result.success);
  assert.deepEqual(
    result.issues.map((entry) => entry.code),
    ['missing-bone', 'multiple-partners'],
  );
});

test('a supplied lookup must agree with both directions of the authoritative pairs', () => {
  const rig = namedRig(['leftArm', 'rightArm']);
  const mapping = mappingFor(rig, [pair('leftArm', 'rightArm')]);
  const invalid: BoneSymmetryMapping = {
    ...mapping,
    getMirroredBoneId: (id) => (id === 'leftArm' ? 'rightArm' : null),
  };
  const issues = validateBoneSymmetryMapping(rig, invalid);
  assert.deepEqual(
    issues.map((entry) => entry.code),
    ['invalid-reciprocal'],
  );
  assert.deepEqual(issues[0]!.boneIds, ['rightArm']);
  assert.deepEqual(validateBoneSymmetryMapping(rig, { rig, pairs: mapping.pairs }), []);
});

const hierarchyBones: readonly BoneDefinition[] = [
  { id: 'root' },
  { id: 'torso', parent: 'root' },
  { id: 'leftUpperArm', parent: 'torso', x: -30, length: 60, rotation: -0.2 },
  { id: 'leftForearm', parent: 'leftUpperArm', y: 60 },
  { id: 'leftHand', parent: 'leftForearm', y: 40 },
  { id: 'rightUpperArm', parent: 'torso', x: 35, length: 65, rotation: 0.3 },
  { id: 'rightForearm', parent: 'rightUpperArm', y: 65 },
  { id: 'rightHand', parent: 'rightForearm', y: 42 },
];

test('corresponding nested chains under an unpaired centerline allow asymmetric bind transforms', () => {
  const rig = new Rig({ root: 'root', bones: hierarchyBones });
  const candidates = inferBoneSymmetryPairs(rig);
  const result = createBoneSymmetryMapping(rig, { automaticCandidates: candidates.pairs });
  assert.isTrue(result.success);
  assert.lengthOf(result.mapping.pairs, 3);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.mapping.unpairedBoneIds, ['root', 'torso']);
});

test('incompatible parents and partially paired chains are warnings, not a blanket rejection', () => {
  const rig = new Rig({ root: 'root', bones: hierarchyBones });
  const result = createBoneSymmetryMapping(rig, { manualPairs: [pair('leftHand', 'rightHand')] });
  assert.isTrue(result.success);
  assert.deepEqual(
    result.issues.map((entry) => entry.code),
    ['parent-mismatch'],
  );
  assert.equal(result.issues[0]!.severity, 'warning');
  const changed = new Rig({
    root: 'root',
    bones: hierarchyBones.map((bone) => (bone.id === 'rightHand' ? { ...bone, parent: 'rightUpperArm' } : bone)),
  });
  const mismatched = createBoneSymmetryMapping(changed, { automaticCandidates: inferBoneSymmetryPairs(changed).pairs });
  assert.isTrue(mismatched.success);
  assert.isTrue(mismatched.issues.some((entry) => entry.code === 'parent-mismatch'));
});

test('ancestor/descendant pairs warn, including explicit attempts to pair the root', () => {
  const rig = new Rig({ root: 'root', bones: hierarchyBones });
  const result = createBoneSymmetryMapping(rig, { manualPairs: [pair('root', 'leftHand')] });
  assert.isTrue(result.success);
  assert.deepEqual(
    result.issues.map((entry) => entry.code),
    ['ancestor-pair', 'parent-mismatch'],
  );
});

test('sharing a parent that is itself paired is incompatible', () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'left', parent: 'root' },
      { id: 'right', parent: 'root' },
      { id: 'a', parent: 'left' },
      { id: 'b', parent: 'left' },
    ],
  });
  const result = createBoneSymmetryMapping(rig, { manualPairs: [pair('left', 'right'), pair('a', 'b')] });
  assert.isTrue(result.success);
  assert.deepEqual(
    result.issues.map((entry) => entry.code),
    ['parent-mismatch'],
  );
});

test('a mapping cannot be validated for a different rig, even when IDs are identical', () => {
  const rig = namedRig(['leftArm', 'rightArm']);
  const mapping = mappingFor(rig, inferBoneSymmetryPairs(rig).pairs);
  const other = namedRig(['leftArm', 'rightArm']);
  assert.equal(validateBoneSymmetryMapping(other, mapping)[0]!.code, 'rig-mismatch');
  assert.deepEqual(validateBoneSymmetryMapping(rig, mapping), []);
  // Future persisted pairs must be deliberately rebound to the current rig through construction.
  const rebound = mappingFor(other, mapping.pairs);
  assert.strictEqual(rebound.rig, other);
});

test('inference and validation remain deterministic when rig bone order changes', () => {
  const ids = ['leftArm', 'rightArm', 'RightArm', 'L_Hand', 'R_Hand', 'leftFoot', 'rightFoot', 'leftArm_R'];
  const first = inferBoneSymmetryPairs(namedRig(ids));
  assert.deepEqual(first, inferBoneSymmetryPairs(namedRig([...ids].reverse())));
  const rig = namedRig(ids);
  const options = { automaticCandidates: first.pairs };
  const a = createBoneSymmetryMapping(rig, options);
  const b = createBoneSymmetryMapping(rig, options);
  assert.deepEqual(a.mapping!.pairs, b.mapping!.pairs);
  assert.deepEqual(a.mapping!.unpairedBoneIds, b.mapping!.unpairedBoneIds);
  assert.deepEqual(a.issues, b.issues);
});

test('construction owns immutable pair snapshots without freezing or retaining mutable caller data', () => {
  const rig = namedRig(['leftArm', 'rightArm']);
  const manualPairs = [{ leftBoneId: 'leftArm', rightBoneId: 'rightArm' }];
  const mapping = mappingFor(rig, manualPairs);
  manualPairs[0]!.rightBoneId = 'unknown';
  manualPairs.length = 0;
  assert.deepEqual(mapping.pairs, [pair('leftArm', 'rightArm')]);
  assert.equal(mapping.getMirroredBoneId('rightArm'), 'leftArm');
  assert.isTrue(Object.isFrozen(mapping));
  assert.isTrue(Object.isFrozen(mapping.pairs));
  assert.isTrue(Object.isFrozen(mapping.pairs[0]));
  assert.isFalse(Object.isFrozen(manualPairs));
});

test('the shipped rig keeps its bones, joint offsets, hierarchy, slots, attachments, and skins unchanged', () => {
  const original = JSON.stringify(demoRig);
  const bones = demoRig.bones;
  const candidates = inferBoneSymmetryPairs(demoRig);
  const result = createBoneSymmetryMapping(demoRig, { automaticCandidates: candidates.pairs });
  assert.isTrue(result.success);
  assert.isAbove(result.mapping.pairs.length, 0);
  assert.deepEqual(result.issues, []);
  assert.strictEqual(demoRig.bones, bones);
  assert.equal(JSON.stringify(demoRig), original);
});
