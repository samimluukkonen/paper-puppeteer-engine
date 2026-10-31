import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { evaluateIKTarget } from '../src/devtools/animation-editor/ikInspectorSampling.js';
import { type Affine, composeAffine, localToWorld, transformToAffine } from '../src/engine/affineMath.js';
import type { AnimationClip, AnimationPlaybackMode } from '../src/engine/AnimationClip.js';
import type { FiredAnimationEvent } from '../src/engine/AnimationPlayer.js';
import { getIKBakeSampleTimes, sampleIKBake, type IKBakeSampleResult } from '../src/engine/core.js';
import { getIKBakeRuntimeIssues } from '../src/engine/ik/IKBakeSampling.js';
import { blendIKRotation } from '../src/engine/ik/solveTwoBoneIK.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { freezeData } from '../src/engine/readonlyData.js';
import { Rig } from '../src/engine/Rig.js';
import { createTransform, type JointTransform } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Vector2: class {
        constructor(
          public x: number,
          public y: number,
        ) {}
      },
    },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.restoreAllMocks());

function rig(): Rig {
  return new Rig({
    root: 'body',
    bones: [
      { id: 'body' },
      { id: 'upper', parent: 'body', rotation: 0.2 },
      { id: 'lower', parent: 'upper', y: 60, rotation: 0.3 },
      { id: 'hand', parent: 'lower', y: 50 },
      { id: 'thigh', parent: 'body', x: -15 },
      { id: 'shin', parent: 'thigh', y: 70 },
      { id: 'foot', parent: 'shin', y: 60 },
    ],
    ik: [
      { name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', priority: 1 },
      { name: 'leg', rootBone: 'thigh', middleBone: 'shin', endBone: 'foot', bendDirection: -1 },
    ],
  });
}

function animation(playback?: AnimationPlaybackMode): AnimationClip {
  return {
    name: 'reach',
    duration: 1050,
    loop: true,
    tracks: {
      upper: [
        { time: 0, rotation: 0.2 },
        { time: 1050, rotation: 0.8 },
      ],
      lower: [
        { time: 0, rotation: 0.3 },
        { time: 1050, rotation: -0.1 },
      ],
    },
    ikTracks: {
      arm: [
        { time: 0, x: 60, y: 60 },
        { time: 1050, x: -30, y: 75 },
      ],
      leg: [
        { time: 0, x: -25, y: 110 },
        { time: 1050, x: -45, y: 90 },
      ],
    },
    events: [
      { time: 0, name: 'start' },
      { time: 300, name: 'middle' },
      { time: 1050, name: 'end' },
    ],
    ...(playback ? { playback } : {}),
  };
}

function success(result: IKBakeSampleResult): asserts result is Extract<IKBakeSampleResult, { success: true }> {
  assert.isTrue(result.success, JSON.stringify(result.issues));
}

function sampleData(result: IKBakeSampleResult) {
  success(result);
  return {
    ...result,
    samples: result.samples.map((sample) => ({
      ...sample,
      pose: [...sample.pose],
      constraints: [...sample.constraints],
    })),
  };
}

function endpoint(skeleton: Rig, pose: ReadonlyMap<string, Readonly<JointTransform>>, end: string) {
  const matrices = new Map<string, Affine>();
  for (const bone of skeleton.bones) {
    const local = transformToAffine(pose.get(bone.id) ?? createTransform(bone), {} as Affine);
    matrices.set(
      bone.id,
      composeAffine(local, bone.parent === undefined ? undefined : matrices.get(bone.parent), {} as Affine),
    );
  }
  return localToWorld({ x: 0, y: 0 }, matrices.get(end)!);
}

test('nonsingular compressed ancestors match runtime IK and inspector sampling', () => {
  const skeleton = new Rig({
    root: 'body',
    bones: [
      { id: 'body', scaleY: 1e-14 },
      { id: 'parent', parent: 'body', rotation: Math.PI / 4 },
      { id: 'upper', parent: 'parent' },
      { id: 'lower', parent: 'upper', x: 50 },
      { id: 'hand', parent: 'lower', x: 50 },
    ],
    ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand' }],
  });
  const puppet = new Puppet(puppetScene(), { rig: skeleton, autoUpdate: false });
  try {
    const target = localToWorld({ x: 60, y: 30 }, puppet.getBone('parent').container.getWorldTransformMatrix());
    const source: AnimationClip = {
      name: 'reach',
      duration: 1000,
      loop: false,
      tracks: {},
      ikTracks: { arm: [{ time: 0, ...target }] },
    };
    puppet.addAnimation(source).play(source.name);
    assert.equal(puppet.getIK('arm').status, 'solved');
    const result = sampleIKBake(source, skeleton, ['arm']);
    success(result);
    for (const sample of result.samples) {
      assert.equal(sample.constraints.get('arm')!.status, 'solved');
      for (const [id, values] of sample.pose)
        assert.approximately(values.rotation, puppet.getBone(id).pose.rotation, 1e-10);
    }
    assert.deepEqual(evaluateIKTarget(source, skeleton, 'arm', 0), { ...target, mix: 1 });
  } finally {
    puppet.destroy();
  }
});

test('entire-duration grids include zero and the exact endpoint once without cumulative drift', () => {
  assert.deepEqual(getIKBakeSampleTimes(1050, 10), [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1050]);
  assert.deepEqual(getIKBakeSampleTimes(1000, 3), [0, 1000 / 3, 2000 / 3, 1000]);
  assert.deepEqual(getIKBakeSampleTimes(1, 10), [0, 1]);
  assert.deepEqual(getIKBakeSampleTimes(Number.MIN_VALUE, 10), [0, Number.MIN_VALUE]);
  assert.deepEqual(getIKBakeSampleTimes(1000 / 7, 7), [0, 1000 / 7]);
  for (const fps of [0, -1, NaN, Infinity, Number.MAX_VALUE]) assert.throws(() => getIKBakeSampleTimes(1000, fps));
  for (const duration of [0, -1, NaN, Infinity, Number.MAX_VALUE])
    assert.throws(() => getIKBakeSampleTimes(duration, 10));
  assert.throws(() => getIKBakeSampleTimes(1000, 100_000), /at most/);
});

test.each(['arm', 'leg'])('a single %s captures only its driven local joints and reaches the authored target', (id) => {
  const skeleton = rig();
  const result = sampleIKBake(animation(), skeleton, [id]);
  success(result);
  assert.equal(result.fps, 10);
  const definition = skeleton.ik!.find((chain) => chain.name === id)!;
  assert.deepEqual(result.boneIds, [definition.rootBone, definition.middleBone]);
  assert.equal(result.samples.length, 12);
  for (const sample of result.samples) {
    assert.equal(sample.pose.size, 2);
    const state = sample.constraints.get(id)!;
    assert.equal(state.status, 'solved');
    const end = endpoint(skeleton, sample.pose, definition.endBone);
    assert.approximately(end.x, state.target!.x, 1e-8);
    assert.approximately(end.y, state.target!.y, 1e-8);
  }
});

test.each([{ mode: 'smooth' } as const, { mode: 'stepped', fps: 10 } as const])(
  'multiple chains and samples match runtime $mode playback, with exact looping-clip endpoint',
  (playback) => {
    const skeleton = rig();
    const source = animation(playback);
    const result = sampleIKBake(source, skeleton, ['arm', 'leg'], { fps: 16 });
    success(result);
    const puppet = new Puppet(puppetScene(), {
      rig: skeleton,
      animations: [{ ...source, loop: false }],
      autoUpdate: false,
    });
    const events = vi.fn<(event: FiredAnimationEvent) => void>();
    const complete = vi.fn();
    puppet.onAnimationEvent(events);
    puppet.onAnimationComplete(complete);
    puppet.play(source.name);
    events.mockClear();
    try {
      for (const sample of result.samples) {
        puppet.sampleAnimation(sample.time, { mode: 'playback' });
        for (const [id, values] of sample.pose)
          for (const property of ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const)
            assert.approximately(values[property], puppet.getBone(id).pose[property], 1e-10);
      }
      assert.equal(result.samples[1]!.evaluatedTime, playback.mode === 'smooth' ? 62.5 : 0);
      assert.equal(result.samples.at(-1)!.evaluatedTime, 1050);
      assert.equal(events.mock.calls.length, 0);
      assert.equal(complete.mock.calls.length, 0);
      assert.deepEqual(sampleData(result), sampleData(sampleIKBake(source, skeleton, ['arm', 'leg'], { fps: 16 })));
    } finally {
      puppet.destroy();
    }
  },
);

test('authored stepped FPS is the default; an explicit rate preserves authored playback and key times', () => {
  const source = animation({ mode: 'stepped', fps: 8 });
  const original = structuredClone(source);
  const result = sampleIKBake(source, rig(), ['arm']);
  success(result);
  assert.equal(result.fps, 8);
  assert.equal(result.samples[1]!.time, 125);
  assert.equal(result.samples.at(-1)!.time, 1050);
  const override = sampleIKBake(source, rig(), ['arm'], { fps: 16 });
  success(override);
  assert.deepEqual([...override.samples[0]!.pose], [...override.samples[1]!.pose]);
  assert.deepEqual(source, original);
});

test('animated zero/partial/full influence blends against authored bone rotations', () => {
  const source: AnimationClip = {
    ...animation(),
    duration: 1000,
    tracks: { upper: [{ time: 0, rotation: 0.4 }], lower: [{ time: 0, rotation: -0.3 }] },
    ikTracks: {
      arm: [
        { time: 0, x: 60, y: 60, mix: 0 },
        { time: 1000, mix: 1 },
      ],
    },
    events: [],
  };
  const result = sampleIKBake(source, rig(), ['arm'], { fps: 2 });
  success(result);
  assert.equal(result.samples[0]!.constraints.get('arm')!.status, 'inactive');
  for (const [id, start] of [
    ['upper', 0.4],
    ['lower', -0.3],
  ] as const) {
    assert.equal(result.samples[0]!.pose.get(id)!.rotation, start);
    assert.approximately(
      result.samples[1]!.pose.get(id)!.rotation,
      blendIKRotation(start, result.samples[2]!.pose.get(id)!.rotation, 0.5),
      1e-12,
    );
  }
});

test('unreachable targets retain the existing clamped solution and complete finite transforms', () => {
  const source = { ...animation(), ikTracks: { arm: [{ time: 0, x: 1000, y: 1000 }] } };
  const result = sampleIKBake(source, rig(), ['arm']);
  success(result);
  for (const sample of result.samples) {
    assert.equal(sample.constraints.get('arm')!.status, 'clamped');
    assert.isTrue([...sample.pose.values()].every((values) => Object.values(values).every(Number.isFinite)));
    const end = endpoint(rig(), sample.pose, 'hand');
    assert.approximately(Math.hypot(end.x, end.y), 110, 1e-8);
  }
});

test('disabled and targetless chains preserve authored transforms with bind fallback', () => {
  const base = rig();
  for (const disabled of [false, true]) {
    const skeleton = new Rig({
      root: base.root,
      bones: base.bones,
      ik: base.ik!.map((chain) => ({ ...chain, enabled: !disabled })),
    });
    const source = {
      ...animation(),
      tracks: { upper: [{ time: 0, x: 7, rotation: 0.6 }] },
      ikTracks: disabled ? animation().ikTracks! : { arm: [{ time: 0, mix: 1 }] },
    };
    const result = sampleIKBake(source, skeleton, ['arm']);
    success(result);
    for (const sample of result.samples) {
      assert.equal(sample.constraints.get('arm')!.status, 'inactive');
      assert.deepEqual(sample.pose.get('upper'), { ...createTransform(base.getBone('upper')), x: 7, rotation: 0.6 });
      assert.deepEqual(sample.pose.get('lower'), createTransform(base.getBone('lower')));
    }
  }
});

test('local transforms match runtime beneath rotated, reflected, nonuniform ancestors and endpoint offsets', () => {
  const base = rig();
  const skeleton = new Rig({
    root: base.root,
    bones: base.bones.map((bone) =>
      bone.id === 'body'
        ? { ...bone, x: 17, y: -25, rotation: 0.7, scaleX: -2, scaleY: 0.8 }
        : bone.id === 'upper'
          ? { ...bone, x: 5, y: 8, scaleX: -1.2, scaleY: 1.2 }
          : bone.id === 'lower'
            ? { ...bone, x: 3, scaleX: 0.8, scaleY: 1.1 }
            : bone.id === 'hand'
              ? { ...bone, rotation: 0.4, scaleX: -1 }
              : bone,
    ),
    ik: base.ik!.map((chain) => (chain.name === 'arm' ? { ...chain, endOffset: { x: 5, y: 7 } } : chain)),
  });
  const source = animation();
  const result = sampleIKBake(source, skeleton, ['arm']);
  success(result);
  const puppet = new Puppet(puppetScene(), {
    rig: skeleton,
    animations: [{ ...source, loop: false }],
    autoUpdate: false,
  });
  puppet.container.setPosition(400, 200).setScale(2);
  puppet.setFacing('left');
  puppet.play(source.name);
  try {
    for (const sample of result.samples) {
      puppet.sampleAnimation(sample.time, { mode: 'playback' });
      for (const [id, values] of sample.pose) {
        const runtime = puppet.getBone(id).pose;
        for (const property of ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const)
          assert.approximately(values[property], runtime[property], 1e-9);
      }
    }
  } finally {
    puppet.destroy();
  }
});

test.each([false, true])(
  'preceding nested constraints affect sparse fallback in stable priority order, equal=%s',
  (equal) => {
    const base = rig();
    const skeleton = new Rig({
      root: base.root,
      bones: [
        ...base.bones,
        { id: 'gripUpper', parent: 'hand' },
        { id: 'gripLower', parent: 'gripUpper', y: 20 },
        { id: 'gripEnd', parent: 'gripLower', y: 15 },
      ],
      ik: [
        base.ik![0]!,
        { name: 'grip', rootBone: 'gripUpper', middleBone: 'gripLower', endBone: 'gripEnd', priority: equal ? 1 : 2 },
      ],
    });
    // Reverse registration when priorities differ to verify sorting rather than array-order execution.
    const orderedRig = equal
      ? skeleton
      : new Rig({ root: skeleton.root, bones: skeleton.bones, ik: [...skeleton.ik!].reverse() });
    const source = { ...animation(), ikTracks: { arm: animation().ikTracks!.arm!, grip: [{ time: 0, x: 10 }] } };
    const result = sampleIKBake(source, orderedRig, ['grip'], { fps: 2 });
    success(result);
    const puppet = new Puppet(puppetScene(), {
      rig: orderedRig,
      animations: [{ ...source, loop: false }],
      autoUpdate: false,
    });
    puppet.play(source.name);
    try {
      for (const sample of result.samples) {
        puppet.sampleAnimation(sample.time, { mode: 'playback' });
        for (const [id, values] of sample.pose)
          assert.approximately(values.rotation, puppet.getBone(id).pose.rotation, 1e-10);
        assert.approximately(
          evaluateIKTarget(source, orderedRig, 'grip', sample.time)!.y,
          puppet.getIK('grip').resolvedTarget!.y,
          1e-10,
        );
      }
    } finally {
      puppet.destroy();
    }
  },
);

test('selection validation rejects missing, repeated and competing chains atomically', () => {
  for (const selection of [[], ['missing'], ['arm', 'arm']]) {
    const result = sampleIKBake(animation(), rig(), selection);
    assert.isFalse(result.success);
    assert.deepEqual(result.samples, []);
  }
  const base = rig();
  const competing = new Rig({
    root: base.root,
    bones: base.bones,
    ik: [...base.ik!, { ...base.ik![0]!, name: 'competing', priority: 100 }],
  });
  for (const selection of [['arm'], ['arm', 'competing']]) {
    const result = sampleIKBake(animation(), competing, selection);
    assert.isFalse(result.success);
    assert.equal(result.issues[0]!.code, 'competing-constraint');
    assert.deepEqual(result.samples, []);
  }
  const disabled = new Rig({
    root: base.root,
    bones: base.bones,
    ik: [...base.ik!, { ...base.ik![0]!, name: 'disabled', enabled: false }],
  });
  success(sampleIKBake(animation(), disabled, ['arm']));
});

test('animation and sampling validation reject invalid targets, keys, events and rates', () => {
  const source = animation();
  for (const input of [
    { ...source, duration: 0 },
    { ...source, tracks: { unknown: [{ time: 0, x: 5 }] } },
    { ...source, ikTracks: { arm: [{ time: 0, x: NaN }] } },
    { ...source, ikTracks: { arm: [{ time: 0, mix: 2 }] } },
    { ...source, ikTracks: { missing: [{ time: 0, x: 1 }] } },
    { ...source, events: [{ time: 2000, name: 'invalid' }] },
  ]) {
    const result = sampleIKBake(input, rig(), ['arm']);
    assert.isFalse(result.success);
    assert.equal(result.issues[0]!.code, 'invalid-animation');
  }
  for (const fps of [0, -1, Infinity, NaN, 1e20]) {
    const result = sampleIKBake(source, rig(), ['arm'], { fps });
    assert.isFalse(result.success);
    assert.equal(result.issues[0]!.code, 'invalid-sampling');
  }
});

test.each([
  ['upper', 'scaleX', 2, 'unsupported-scale'],
  ['upper', 'scaleX', 0, 'singular-transform'],
  ['body', 'scaleY', 0, 'singular-transform'],
] as const)('unsupported %s.%s returns no partial samples', (id, property, value, code) => {
  const source = animation();
  const input = {
    ...source,
    tracks: {
      ...source.tracks,
      [id]: [
        { time: 0, [property]: 1, ...(id === 'upper' && value === 0 ? { scaleY: 1 } : {}) },
        { time: 1050, [property]: value, ...(id === 'upper' && value === 0 ? { scaleY: 0 } : {}) },
      ],
    },
  };
  const result = sampleIKBake(input, rig(), ['arm'], { fps: 2 });
  assert.isFalse(result.success);
  assert.deepEqual(result.samples, []);
  assert.equal(result.issues[0]!.code, code);
  assert.isAbove(result.issues[0]!.time!, 0);
});

test('finite but overflowing world transforms report a failure', () => {
  const base = rig();
  const skeleton = new Rig({
    root: base.root,
    ik: base.ik!,
    bones: base.bones.map((bone) => (bone.id === 'body' ? { ...bone, scaleX: 1e308, scaleY: 1e308 } : bone)),
  });
  const result = sampleIKBake({ ...animation(), ikTracks: {} }, skeleton, ['arm']);
  assert.isFalse(result.success);
  assert.equal(result.issues[0]!.code, 'non-finite-transform');
});

test('optional runtime guards reject providers and all overrides without invoking or changing them', () => {
  const skeleton = rig();
  const puppet = new Puppet(puppetScene(), { rig: skeleton, autoUpdate: false });
  const chain = puppet.getIK('arm');
  const provider = vi.fn(() => ({ x: Math.random(), y: 80 }));
  const options = { runtimeConstraints: [chain, puppet.getIK('leg')] };
  success(sampleIKBake(animation(), skeleton, ['arm'], options));
  for (const mutate of [
    () => chain.setTargetProvider(provider),
    () => chain.setTarget(10, 20),
    () => {
      chain.target = undefined;
      chain.mix = 1;
    },
    () => {
      chain.clearMixOverride();
      chain.priority = 100;
    },
    () => {
      chain.priority = 1;
      chain.enabled = false;
    },
    () => {
      chain.enabled = true;
      chain.bendDirection = -1;
    },
    () => {
      chain.bendDirection = 1;
      chain.setEndOffset({ x: 1, y: 2 });
    },
  ]) {
    mutate();
    const result = sampleIKBake(animation(), skeleton, ['arm'], options);
    assert.isFalse(result.success);
    assert.equal(result.issues[0]!.code, 'external-state');
    assert.deepEqual(result.samples, []);
  }
  assert.equal(provider.mock.calls.length, 0);
  assert.deepEqual(chain.endOffset, { x: 1, y: 2 });
  const extra = puppet.addIK({ name: 'extra', rootBone: 'thigh', middleBone: 'shin', endBone: 'foot' });
  const unsupported = sampleIKBake(animation(), skeleton, ['arm'], { runtimeConstraints: [extra] });
  assert.isFalse(unsupported.success);
  assert.equal(unsupported.issues[0]!.code, 'external-state');
  puppet.destroy();
});

test('runtime guards reuse unchanged configurations and invalidate every ownership/settings change', () => {
  const skeleton = rig();
  const puppet = new Puppet(puppetScene(), { rig: skeleton, autoUpdate: false });
  const chain = puppet.getIK('arm');
  const ownership = vi.spyOn(chain, 'targetOwnership', 'get');
  const provider = vi.fn(() => undefined);
  try {
    const constraints = [chain, puppet.getIK('leg')];
    assert.isEmpty(getIKBakeRuntimeIssues(skeleton, constraints));
    ownership.mockClear();
    const revision = chain.configurationRevision;
    for (let frame = 0; frame < 60; frame++) {
      puppet.syncPose();
      chain.enabled = true;
      chain.priority = 1;
      chain.bendDirection = 1;
      chain.setEndOffset({ x: 0, y: 0 }).clearMixOverride().setTargetProvider(undefined);
      chain.target = undefined;
      assert.isEmpty(getIKBakeRuntimeIssues(skeleton, [...constraints]));
    }
    assert.equal(chain.configurationRevision, revision);
    assert.equal(ownership.mock.calls.length, 0, 'playback and new collection identities reuse cached checks');
    for (const [change, restore] of [
      [() => chain.setTargetProvider(provider), () => chain.setTargetProvider(undefined)],
      [
        () => chain.setTarget(10, 20),
        () => {
          chain.target = undefined;
        },
      ],
      [
        () => {
          chain.mix = 1;
        },
        () => chain.clearMixOverride(),
      ],
      [
        () => {
          chain.mix = 0.5;
        },
        () => {
          chain.mix = 1;
          chain.clearMixOverride();
        },
      ],
      [
        () => {
          chain.priority = 2;
        },
        () => {
          chain.priority = 1;
        },
      ],
      [
        () => {
          chain.enabled = false;
        },
        () => {
          chain.enabled = true;
        },
      ],
      [
        () => {
          chain.bendDirection = -1;
        },
        () => {
          chain.bendDirection = 1;
        },
      ],
      [() => chain.setEndOffset({ x: 1, y: 0 }), () => chain.setEndOffset({ x: 0, y: 0 })],
      [() => chain.setEndOffset({ x: 0, y: 1 }), () => chain.setEndOffset({ x: 0, y: 0 })],
    ]) {
      change!();
      assert.equal(getIKBakeRuntimeIssues(skeleton, constraints).length, 1);
      restore!();
      assert.isEmpty(getIKBakeRuntimeIssues(skeleton, constraints));
    }
    assert.equal(provider.mock.calls.length, 0);
    const other = new Rig({
      root: skeleton.root,
      bones: skeleton.bones,
      ik: skeleton.ik!.map((entry) => ({ ...entry, priority: 10 })),
    });
    assert.equal(getIKBakeRuntimeIssues(other, constraints).length, 2, 'rig replacement uses fresh definitions');
    assert.isEmpty(getIKBakeRuntimeIssues(skeleton, constraints));
    const extra = puppet.addIK({ name: 'extra', rootBone: 'thigh', middleBone: 'shin', endBone: 'foot' });
    assert.equal(getIKBakeRuntimeIssues(skeleton, [...constraints, extra]).length, 1);
    assert.isEmpty(getIKBakeRuntimeIssues(skeleton, constraints), 'removing an extra chain removes its issue');
    chain.dispose();
    assert.equal(getIKBakeRuntimeIssues(skeleton, constraints).length, 1);
  } finally {
    puppet.destroy();
  }
});

test('isolated samples are immutable, deterministic and refreshed for mutable input changes', () => {
  const skeleton = rig();
  const source = animation();
  const result = sampleIKBake(source, skeleton, ['arm']);
  success(result);
  assert.isFalse('set' in result.samples[0]!.pose);
  assert.isTrue(Object.isFrozen(result.samples[0]!.pose.get('upper')));
  assert.isTrue(Object.isFrozen(result.samples));
  assert.deepEqual(
    sampleData(sampleIKBake(freezeData(structuredClone(source)), skeleton, ['arm'])),
    sampleData(result),
  );
  source.ikTracks = { arm: [{ time: 0, x: -50, y: 60 }] };
  const changed = sampleIKBake(source, skeleton, ['arm']);
  success(changed);
  assert.notDeepEqual([...changed.samples[0]!.pose], [...result.samples[0]!.pose]);
  assert.equal(result.samples[0]!.constraints.get('arm')!.target!.x, 60);
  assert.deepEqual(sampleData(sampleIKBake(source, skeleton, ['arm'])), sampleData(changed));
});

test.each(['paused', 'playing', 'scrubbing'] as const)(
  'sampling preserves %s editor time/history/drafts, live pose, rig and source/working data, and dispatches no events',
  (mode) => {
    const skeleton = rig();
    const source = animation({ mode: 'stepped', fps: 10 });
    const original = structuredClone(source);
    const rigJson = JSON.stringify(skeleton);
    const state = new AnimationEditorState(skeleton, [source]);
    state.selectAnimation(source.name);
    state.setBonePropertyKeyframe('upper', 'x', 7, 0);
    state.setBonePropertyKeyframe('upper', 'y', 9, 0);
    state.undo();
    state.selectBone('upper');
    state.setCurrentTime(0.5);
    if (mode !== 'paused') state.play();
    if (mode === 'scrubbing') state.beginScrub();
    if (mode !== 'playing') state.setTemporaryBoneProperty('rotation', 0.6);
    const puppet = new Puppet(puppetScene(), { rig: skeleton, autoUpdate: false });
    const preview = new AnimationEditorPreview(state, puppet);
    const snapshot = () => ({
      time: state.currentTime,
      playing: state.isPlaying,
      scrubbing: state.isScrubbing,
      history: state.historyLength,
      undo: state.canUndo,
      redo: state.canRedo,
      dirty: state.dirty,
      draft: state.boneTransformDraft,
      selection: state.selectedBoneId,
      pose: skeleton.bones.map((bone) => ({ ...puppet.getBone(bone.id).pose })),
      bind: skeleton.bones.map((bone) => ({ ...puppet.getBone(bone.id).bindPose })),
      status: puppet.getIK('arm').status,
    });
    const before = snapshot();
    const working = state.workingAnimation!;
    const authored = state.sourceAnimation;
    const workingJson = JSON.stringify(working);
    const events = vi.fn<(event: FiredAnimationEvent) => void>();
    const runtimeEvents = vi.fn();
    const notifications = vi.fn();
    const releaseEvent = state.onAnimationEvent(events);
    const release = state.subscribe(notifications);
    puppet.onAnimationEvent(runtimeEvents);
    const sync = vi.spyOn(puppet, 'syncPose');
    const reset = vi.spyOn(Joint.prototype, 'reset');
    try {
      const expected = sampleIKBake(working, skeleton, ['arm', 'leg']);
      success(expected);
      assert.equal(expected.samples[0]!.pose.get('upper')!.x, 7);
      for (let repeat = 0; repeat < 4; ++repeat)
        assert.deepEqual(sampleData(sampleIKBake(working, skeleton, ['arm', 'leg'])), sampleData(expected));
      assert.isFalse(sampleIKBake(working, skeleton, ['arm'], { fps: 0 }).success);
      assert.deepEqual(snapshot(), before);
      assert.strictEqual(state.workingAnimation, working);
      assert.strictEqual(state.sourceAnimation, authored);
      assert.equal(JSON.stringify(working), workingJson);
      assert.equal(JSON.stringify(skeleton), rigJson);
      assert.deepEqual(source, original);
      assert.equal(notifications.mock.calls.length, 0);
      assert.equal(events.mock.calls.length, 0);
      assert.equal(runtimeEvents.mock.calls.length, 0);
      assert.equal(sync.mock.calls.length, 0);
      assert.isTrue(reset.mock.instances.every((joint) => joint !== puppet.getBone('upper')));
      state.pause();
      state.endScrub();
      state.restart();
      state.play();
      state.advancePlayback(0.35);
      assert.isTrue(events.mock.calls.some(([event]) => event.name === 'middle'));
      assert.equal(events.mock.calls.filter(([event]) => event.name === 'start').length, 1);
    } finally {
      release();
      releaseEvent();
      preview.dispose();
      puppet.destroy();
    }
  },
);
