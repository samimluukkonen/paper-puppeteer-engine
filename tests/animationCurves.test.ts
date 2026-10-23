import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { verifyAnimationRoundTrip } from '../src/devtools/animation-editor/animationImport.js';
import { serializeAnimation } from '../src/devtools/animation-editor/animationSerialization.js';
import { getInterpolationForKeys, getSegmentInterpolation } from '../src/devtools/animation-editor/interpolation.js';
import { copyKeyframeSelection, pasteKeyframeClipboard } from '../src/devtools/animation-editor/keyframeClipboard.js';
import {
  moveBonePropertyKeyframe,
  moveBonePropertyKeyframes,
  removeBonePropertyKeyframe,
  setBonePropertyKeyframes,
} from '../src/devtools/animation-editor/keyframeEdits.js';
import { mirrorSelectedKeyframes } from '../src/devtools/animation-editor/keyframeMirroring.js';
import { retimeSelectedKeys } from '../src/devtools/animation-editor/keyframeRetiming.js';
import { inspectEditorAnimation } from '../src/devtools/animation-editor/validatedAnimation.js';
import { createBoneSymmetryMapping } from '../src/devtools/shared/boneSymmetry.js';
import { ownCompiledClip } from '../src/engine/AnimationClip.js';
import {
  type AnimationClip,
  AnimationPlayer,
  compileClip,
  evaluateClip,
  evaluateIKClip,
  Joint,
  parseAnimationClip,
  type PropertyCurve,
  Rig,
  sampleProperty,
  serializeAnimationDefinition,
  validateAnimationDefinition,
  commitIKBake,
  generateBakedBoneKeys,
  sampleIKBake,
} from '../src/engine/core.js';
import {
  findIKPropertyKeyframe,
  moveIKPropertyKeyframe,
  removeIKPropertyKeyframe,
} from '../src/engine/ik/animationKeyframes.js';

const rig = new Rig({
  root: 'root',
  bones: [
    { id: 'root' },
    { id: 'middle', parent: 'root', x: 10 },
    { id: 'end', parent: 'middle', x: 10 },
    { id: 'other', parent: 'root' },
  ],
  ik: [{ name: 'arm', rootBone: 'root', middleBone: 'middle', endBone: 'end' }],
});
const ease: PropertyCurve = { mode: 'bezier', control1: { x: 0, y: 0 }, control2: { x: 0, y: 1 } };
const symmetrical: PropertyCurve = { mode: 'bezier', control1: { x: 0.25, y: 0 }, control2: { x: 0.75, y: 1 } };
const selection = [{ boneId: 'root', property: 'x' as const, time: 0 }];

function animation(curve: PropertyCurve = ease): AnimationClip {
  return {
    name: 'curve',
    duration: 1000,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: -10, y: 2, scaleX: -2, scaleY: 0, curves: { x: curve, scaleX: curve, scaleY: curve } },
        { time: 1000, x: 10, y: 4, scaleX: 2, scaleY: 4 },
      ],
    },
    ikTracks: {
      arm: [
        { time: 0, x: -10, y: 20, mix: 0, curves: { x: curve, y: curve, mix: curve } },
        { time: 1000, x: 10, y: 40, mix: 1 },
      ],
    },
  };
}

test.each([undefined, { mode: 'linear' } as const])('linear property defaults remain exact (%j)', (curve) => {
  const keys = [
    { time: 10, value: -10, ...(curve ? { curve } : {}) },
    { time: 110, value: 30 },
  ];
  assert.equal(sampleProperty(keys, 60), 10);
  assert.equal(sampleProperty(keys, -50), -10);
  assert.equal(sampleProperty(keys, 200), 30);
});

test('stepped property segments hold until the next exact key, independently of playback FPS', () => {
  const compiled = compileClip(animation({ mode: 'stepped' }), rig);
  assert.equal(evaluateClip(compiled, 999.999).get('root')!.x, -10);
  assert.equal(evaluateClip(compiled, 1000).get('root')!.x, 10);
  assert.equal(evaluateIKClip(compiled, 999.999).get('arm')!.mix!.value, 0);
  assert.equal(evaluateIKClip(compiled, 1000).get('arm')!.mix!.value, 1);
});

test('Bézier endpoints, symmetric midpoint and actual time-axis inversion', () => {
  const keys = [
    { time: 0, value: -10, curve: ease },
    { time: 1000, value: 10 },
  ];
  // x(t) = t^3, y(t) = 3t^2 - 2t^3; t = .5 corresponds to 125 ms.
  assert.equal(sampleProperty(keys, 0), -10);
  assert.closeTo(sampleProperty(keys, 125), 0, 1e-12);
  assert.equal(sampleProperty(keys, 1000), 10);
  assert.closeTo(sampleProperty([{ ...keys[0]!, curve: symmetrical }, keys[1]!], 500), 0, 1e-12);
  assert.isBelow(sampleProperty(keys, 1e-12), -9.999);
  assert.isAbove(sampleProperty(keys, 1000 - 1e-10), 9.999);
});

test.each([
  { mode: 'bezier', control1: { x: 0, y: 0 }, control2: { x: 0, y: 0 } },
  { mode: 'bezier', control1: { x: 1, y: 1 }, control2: { x: 1, y: 1 } },
  { mode: 'bezier', control1: { x: 0.5, y: 0 }, control2: { x: 0.5, y: 1 } },
] as const)('flat and coincident handles stay finite and deterministic (%j)', (curve) => {
  const keys = [
    { time: 0, value: -1e300, curve },
    { time: 1000, value: 1e300 },
  ];
  for (const time of [1e-12, 125, 500, 999.999]) {
    const value = sampleProperty(keys, time);
    assert.isTrue(Number.isFinite(value));
    assert.equal(sampleProperty(keys, time), value);
    assert.isAtLeast(value, -1e300);
    assert.isAtMost(value, 1e300);
  }
});

test('sparse bone and IK properties reuse the same curve evaluator with negative and scale values', () => {
  const compiled = compileClip(animation(), rig);
  const bone = evaluateClip(compiled, 125).get('root')!;
  assert.closeTo(bone.x!, 0, 1e-12);
  assert.equal(bone.y, 2.25); // no curve override on this sibling
  assert.closeTo(bone.scaleX!, 0, 1e-12);
  assert.closeTo(bone.scaleY!, 2, 1e-12);
  const ik = evaluateIKClip(compiled, 125).get('arm')!;
  assert.closeTo(ik.x!.value, 0, 1e-12);
  assert.closeTo(ik.y!.value, 30, 1e-12);
  assert.closeTo(ik.mix!.value, 0.5, 1e-12);
  const keys = compiled.ikTracks![0]!.properties.get('mix')!;
  assert.equal(sampleProperty(keys, 125), ik.mix!.value);
});

test('sparse overrides address the next key on the same property', () => {
  const source: AnimationClip = {
    ...animation(),
    tracks: {
      root: [
        { time: 0, x: 0, curves: { x: ease } },
        { time: 100, y: 30 },
        { time: 1000, x: 100 },
      ],
    },
  };
  assert.closeTo(evaluateClip(compileClip(source, rig), 125).get('root')!.x!, 50, 1e-12);
});

test.each([undefined, { mode: 'linear' } as const, ease, { mode: 'stepped' } as const])(
  'rotation wrapping keeps the authored shortest arc (%j)',
  (curve) => {
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    const keys = [
      { time: 0, value: from, ...(curve ? { curve } : {}) },
      { time: 1000, value: to },
    ];
    const expected = curve === ease ? Math.PI : curve?.mode === 'stepped' ? from : (172.5 * Math.PI) / 180;
    assert.closeTo(sampleProperty(keys, 125, 'rotation'), expected, 1e-12);
    assert.closeTo(sampleProperty(keys, 1000, 'rotation'), (190 * Math.PI) / 180, 1e-12);
    assert.equal(sampleProperty(keys, 1001, 'rotation'), to); // existing endpoint/hold convention
    const turns = [
      { time: 0, value: 0, ...(curve ? { curve } : {}) },
      { time: 1000, value: 4 * Math.PI },
    ];
    assert.equal(sampleProperty(turns, 500, 'rotation'), 0);
  },
);

test('smooth and stepped playback still quantize the same runtime sampler', () => {
  const source = animation();
  const joint = new Joint('root');
  const player = new AnimationPlayer(
    rig,
    new Map(rig.bones.map((bone) => [bone.id, bone.id === 'root' ? joint : new Joint(bone.id, bone)])),
    [compileClip(source, rig)],
  );
  player.play(source.name);
  player.update(125);
  assert.closeTo(joint.pose.x, 0, 1e-12);
  const stepped = { ...source, playback: { mode: 'stepped' as const, fps: 4 } };
  const quantized = new AnimationPlayer(
    rig,
    new Map(rig.bones.map((bone) => [bone.id, bone.id === 'root' ? joint : new Joint(bone.id, bone)])),
    [compileClip(stepped, rig)],
  );
  quantized.play(source.name);
  quantized.update(125);
  assert.equal(joint.pose.x, -10);
  quantized.sample(125);
  assert.closeTo(joint.pose.x, 0, 1e-12);
  quantized.sample(1000, { mode: 'playback' });
  assert.equal(joint.pose.x, 10);
});

const invalidCurves: unknown[] = [
  null,
  { mode: 'unknown' },
  { mode: 'linear', control1: { x: 0, y: 0 } },
  { mode: 'bezier' },
  { mode: 'bezier', control1: { x: NaN, y: 0 }, control2: { x: 1, y: 1 } },
  { mode: 'bezier', control1: { x: 0, y: Infinity }, control2: { x: 1, y: 1 } },
  { mode: 'bezier', control1: { x: -0.1, y: 0 }, control2: { x: 1, y: 1 } },
  { mode: 'bezier', control1: { x: 0, y: -0.1 }, control2: { x: 1, y: 1 } },
  { mode: 'bezier', control1: { x: 0, y: 0 }, control2: { x: 1.1, y: 1 } },
  { mode: 'bezier', control1: { x: 0, y: 0 }, control2: { x: 1, y: 1.1 } },
  { mode: 'bezier', control1: { x: 0.9, y: 0 }, control2: { x: 0.1, y: 1 } },
];
test.each(invalidCurves.map((curve) => ({ curve })))(
  'rejects invalid handles in bone, IK and external compiled inputs (%j)',
  ({ curve }) => {
    const source = animation();
    for (const input of [
      { ...source, tracks: { root: [{ time: 0, x: 1, curves: { x: curve } }] } },
      { ...source, ikTracks: { arm: [{ time: 0, mix: 0, curves: { mix: curve } }] } },
    ]) {
      assert.isNotEmpty(validateAnimationDefinition({ version: 1, ...input }, rig));
      assert.throws(() => parseAnimationClip({ version: 1, ...input }, rig));
      assert.throws(() => compileClip(input as never, rig));
    }
    // Exercise the untrusted compiled boundary through the same runtime constructor.
    const external = {
      name: 'invalid',
      duration: 1000,
      loop: false,
      events: [],
      tracks: [{ bone: 'root', properties: new Map([['x', [{ time: 0, value: 1, curve }]]]) }],
    };
    assert.throws(() => ownCompiledClip(external as never));
    assert.throws(() =>
      ownCompiledClip({
        ...external,
        tracks: [],
        ikTracks: [{ constraint: 'arm', properties: new Map([['mix', [{ time: 0, value: 0, curve }]]]) }],
      } as never),
    );
  },
);

test('rejects orphan/unknown property controls, duplicate/descending times and zero clip duration', () => {
  for (const patch of [
    { duration: 0 },
    { tracks: { root: [{ time: 0, x: 1, curves: { y: ease } }] } },
    { tracks: { root: [{ time: 0, x: 1, curves: { mix: ease } }] } },
    {
      tracks: {
        root: [
          { time: 100, x: 1, curves: { x: ease } },
          { time: 100, x: 2 },
        ],
      },
    },
    {
      ikTracks: {
        arm: [
          { time: 100, mix: 0, curves: { mix: ease } },
          { time: 100, mix: 1 },
        ],
      },
    },
    {
      tracks: {
        root: [
          { time: 200, x: 1 },
          { time: 100, x: 2 },
        ],
      },
    },
  ])
    assert.throws(() => parseAnimationClip({ version: 1, ...animation(), ...patch }, rig));
  // Direct low-level degenerate samples are finite; validated clips cannot contain them.
  assert.equal(
    sampleProperty(
      [
        { time: 0, value: 1, curve: ease },
        { time: 0, value: 2 },
      ],
      0,
    ),
    1,
  );
  assert.equal(
    sampleProperty(
      [
        { time: 0, value: 1, curve: ease },
        { time: 0, value: 2 },
      ],
      1,
    ),
    2,
  );
});

test('serialization retains exact controls, omissions and deterministic order through editor import/export', () => {
  const source = animation();
  const result = serializeAnimation({ version: 1, ...source }, rig);
  assert.isTrue(result.success);
  if (!result.success) throw new Error('Export failed');
  const loaded = parseAnimationClip(JSON.parse(result.json), rig);
  assert.deepEqual(loaded, source);
  assert.isFalse(Object.hasOwn(loaded, 'interpolation'));
  assert.equal(
    serializeAnimationDefinition({ version: 1, ...source }, rig),
    serializeAnimationDefinition({ ...source, version: 1 }, rig),
  );
  const roundTrip = verifyAnimationRoundTrip({ version: 1, ...source }, rig);
  assert.isTrue(roundTrip.success);
  if (roundTrip.success) {
    assert.isTrue(roundTrip.equivalent);
    assert.isTrue(roundTrip.posesEquivalent);
    assert.isTrue(roundTrip.playbackEquivalent);
  }
  const reordered = structuredClone(source);
  reordered.tracks = {
    root: source.tracks.root!.map((row) =>
      row.curves ? { ...row, curves: { scaleY: ease, scaleX: ease, x: ease } } : row,
    ),
  };
  assert.deepEqual(serializeAnimation({ version: 1, ...reordered }, rig), result);
});

test('compiled controls are deeply immutable detached snapshots, including externally assembled clips', () => {
  const input = animation();
  const compiled = compileClip(input, rig);
  const curve = compiled.tracks[0]!.properties.get('x')![0]!.curve!;
  assert.isTrue(Object.isFrozen(curve));
  if (curve.mode !== 'bezier') throw new Error('Expected Bézier');
  assert.isTrue(Object.isFrozen(curve.control1));
  assert.isFalse(Object.isFrozen(input.tracks.root![0]!.curves));
  const control = { x: 0, y: 0 };
  const external = {
    ...compiled,
    tracks: [
      {
        bone: 'root',
        properties: new Map([
          [
            'x' as const,
            [
              { time: 0, value: -10, curve: { mode: 'bezier' as const, control1: control, control2: { x: 0, y: 1 } } },
              { time: 1000, value: 10 },
            ],
          ],
        ]),
      },
    ],
  };
  const owned = ownCompiledClip(external);
  control.x = 1;
  assert.closeTo(evaluateClip(owned, 125).get('root')!.x!, 0, 1e-12);
  assert.isFalse(Object.isFrozen(control));
});

test.each([false, true])('property operations keep controls with their channel (immutable: %s)', (immutable) => {
  const input = animation();
  const source = immutable ? inspectEditorAnimation({ version: 1, ...input }, rig).data! : input;
  const before = structuredClone(source);
  const moved = moveBonePropertyKeyframe(source, rig, 'root', 'x', 0, 100);
  assert.deepEqual(moved.tracks.root!.find((row) => row.time === 100)!.curves, { x: ease });
  assert.isUndefined(moved.tracks.root![0]!.curves?.x);
  const group = moveBonePropertyKeyframes(
    source,
    rig,
    [...selection, { boneId: 'root', property: 'scaleX' as const, timeMs: 0 }].map((ref) => ({ ...ref, timeMs: 0 })),
    100,
  );
  assert.deepEqual(group.animation.tracks.root!.find((row) => row.time === 100)!.curves, { x: ease, scaleX: ease });
  const edited = setBonePropertyKeyframes(source, rig, [{ boneId: 'root', property: 'x', timeMs: 0, value: 42 }]);
  assert.deepEqual(edited.tracks.root![0]!.curves?.x, ease);
  assert.isUndefined(removeBonePropertyKeyframe(source, rig, 'root', 'x', 0).tracks.root![0]!.curves?.x);
  const clipboard = copyKeyframeSelection(source, selection)!;
  assert.deepEqual(
    pasteKeyframeClipboard(source, rig, clipboard, 100).animation.tracks.root!.find((row) => row.time === 100)!.curves
      ?.x,
    ease,
  );
  assert.deepEqual(findIKPropertyKeyframe(source, rig, 'arm', 'mix', 0)!.curve, ease);
  assert.isUndefined(removeIKPropertyKeyframe(source, rig, 'arm', 'mix', 0).ikTracks!.arm![0]!.curves?.mix);
  assert.deepEqual(
    moveIKPropertyKeyframe(source, rig, 'arm', 'mix', 0, 100).ikTracks!.arm!.find((row) => row.time === 100)!.curves
      ?.mix,
    ease,
  );
  const retimed = retimeSelectedKeys(
    source,
    rig,
    [
      { boneId: 'root', property: 'x', time: 0 },
      { kind: 'ik', constraintId: 'arm', property: 'mix', time: 0 },
    ],
    { scale: 0.5, anchor: 'playhead', playheadTimeMs: 250 },
  );
  assert.deepEqual(retimed.animation.ikTracks!.arm!.find((row) => row.time === 125)!.curves?.mix, ease);
  assert.deepEqual(retimed.animation.tracks.root!.find((row) => row.time === 125)!.curves?.x, ease);
  assert.deepEqual(source, before);
});

test('pasting default interpolation resets destination controls without losing siblings', () => {
  const source: AnimationClip = {
    ...animation(),
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 500, x: 5, y: 3, curves: { x: ease, y: symmetrical } },
        { time: 1000, x: 10, y: 7 },
      ],
    },
  };
  const clipboard = copyKeyframeSelection(source, selection)!;
  const pasted = pasteKeyframeClipboard(source, rig, clipboard, 500).animation;
  assert.deepEqual(pasted.tracks.root![1]!.curves, { y: symmetrical });
  assert.equal(pasted.tracks.root![1]!.x, 0);
});

test('editor read-only segment metadata and history preserve property overrides', () => {
  const source = animation();
  assert.deepEqual(getSegmentInterpolation(source, selection[0]!)?.curve, ease);
  assert.equal(getSegmentInterpolation(source, selection[0]!)?.scope, 'property');
  assert.deepEqual(getInterpolationForKeys(source, selection), { kind: 'unavailable', reason: 'property-curves' });
  const state = new AnimationEditorState(rig, [source]);
  state.selectAnimation(source.name);
  const original = state.exportJson();
  assert.isTrue(state.setBonePropertyKeyframe('root', 'x', 42, 0));
  assert.deepEqual(state.workingAnimation!.tracks.root![0]!.curves?.x, ease);
  const edited = state.exportJson();
  assert.isTrue(state.undo());
  assert.equal(state.exportJson(), original);
  assert.isTrue(state.redo());
  assert.equal(state.exportJson(), edited);
});

test('selected-key mirroring carries normalized controls and preserves unrelated channels', () => {
  const mirrorRig = new Rig({
    root: 'body',
    bones: [{ id: 'body' }, { id: 'left', parent: 'body' }, { id: 'right', parent: 'body' }],
  });
  const mapping = createBoneSymmetryMapping(mirrorRig, {
    automaticCandidates: [{ leftBoneId: 'left', rightBoneId: 'right' }],
  }).mapping;
  if (!mapping) throw new Error('Expected a valid symmetry mapping');
  const source: AnimationClip = {
    name: 'mirror',
    duration: 1000,
    loop: false,
    tracks: {
      left: [
        { time: 0, x: -10, curves: { x: ease } },
        { time: 1000, x: -30 },
      ],
      right: [{ time: 0, y: 7 }],
    },
  };
  const mirrored = mirrorSelectedKeyframes(
    source,
    mirrorRig,
    mapping,
    [
      { boneId: 'left', property: 'x', timeMs: 0 },
      { boneId: 'left', property: 'x', timeMs: 1000 },
    ],
    'left-to-right',
  ).animation;
  assert.deepEqual(mirrored.tracks.right![0]!.curves?.x, ease);
  assert.equal(mirrored.tracks.right![0]!.y, 7);
  const pose = evaluateClip(compileClip(mirrored, mirrorRig), 125);
  assert.closeTo(pose.get('right')!.x!, -pose.get('left')!.x!, 1e-12);
});

test('layer weights and crossfades combine runtime curve samples for bones and IK', () => {
  const source = animation();
  const base = {
    ...source,
    name: 'base',
    tracks: { root: [{ time: 0, x: 10 }] },
    ikTracks: { arm: [{ time: 0, x: 10, mix: 1 }] },
  };
  const joint = new Joint('root');
  const player = new AnimationPlayer(
    rig,
    new Map(rig.bones.map((bone) => [bone.id, bone.id === 'root' ? joint : new Joint(bone.id, bone)])),
    [compileClip(base, rig), compileClip(source, rig)],
  );
  player.play('base');
  player.setLayerMask('overlay', ['root']);
  player.setLayerWeight('overlay', 0.5);
  player.play('curve', { layer: 'overlay' });
  player.update(125);
  assert.closeTo(joint.pose.x, 5, 1e-12);
  assert.closeTo(player.ikAnimation.get('arm')!.x!.value, 5, 1e-12);
  assert.closeTo(player.ikAnimation.get('arm')!.mix!.value, 0.75, 1e-12);
  player.clearLayer('overlay');
  player.play('curve', { fadeDuration: 250 });
  player.update(125);
  assert.closeTo(joint.pose.x, 5, 1e-12);
  assert.closeTo(player.ikAnimation.get('arm')!.mix!.value, 0.75, 1e-12);
});

test('IK baking samples curves, resets replaced rotation controls and retains unrelated curves', () => {
  const source: AnimationClip = {
    name: 'bake',
    duration: 1000,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: 0, rotation: 0, curves: { x: ease, rotation: ease } },
        { time: 1000, x: 0, rotation: 0.2 },
      ],
    },
    ikTracks: {
      arm: [
        { time: 0, x: 15, y: 5, mix: 0.5, curves: { x: ease, mix: ease } },
        { time: 1000, x: 10, y: 10, mix: 1 },
      ],
    },
  };
  const sampled = sampleIKBake(source, rig, ['arm'], { fps: 20 });
  assert.isTrue(sampled.success, JSON.stringify(sampled.issues));
  const plan = generateBakedBoneKeys(sampled, rig, { animation: source });
  assert.isTrue(plan.success, JSON.stringify(plan.issues));
  if (!plan.success) throw new Error('Bake generation failed');
  const result = commitIKBake(source, plan, rig);
  assert.isTrue(result.success, JSON.stringify(result.issues));
  if (!result.success) throw new Error('Bake commit failed');
  assert.deepEqual(result.animation.tracks.root![0]!.curves, { x: ease });
  assert.deepEqual(result.animation.disabledIKConstraints, ['arm']);
  assert.isUndefined(result.animation.ikTracks?.arm);
});
