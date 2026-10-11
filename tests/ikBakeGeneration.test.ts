import { assert, test } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { serializeAnimation } from '../src/devtools/animation-editor/animationSerialization.js';
import { type Affine, composeAffine, localToWorld, transformToAffine } from '../src/engine/affineMath.js';
import {
  type AnimationClip,
  AnimationPlayer,
  compareIKBakeFidelity,
  compileClip,
  DEFAULT_IK_BAKE_TOLERANCES,
  evaluateClip,
  generateBakedBoneKeys,
  type IKBakePlan,
  type IKBakeSample,
  type IKBakeSampleResult,
  Joint,
  parseAnimationClip,
  Rig,
  sampleIKBake,
} from '../src/engine/core.js';
import { freezeData } from '../src/engine/readonlyData.js';
import { createTransform, type JointTransform } from '../src/engine/types.js';

function rig(): Rig {
  return new Rig({
    root: 'body',
    bones: [
      { id: 'body' },
      { id: 'upper', parent: 'body', x: 4, rotation: 0.2 },
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

function animation(): AnimationClip {
  return {
    name: 'reach',
    duration: 1050,
    loop: true,
    tracks: {
      upper: [
        { time: 0, rotation: 0.2 },
        { time: 525, rotation: 0.5 },
        { time: 1050, rotation: 0.8 },
      ],
      lower: [
        { time: 0, rotation: 0.3 },
        { time: 1050, rotation: -0.1 },
      ],
      hand: [{ time: 0, rotation: 0.4 }],
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
    events: [{ time: 300, name: 'event', data: { preserved: true } }],
  };
}

function successfulSamples(
  result: IKBakeSampleResult,
): asserts result is Extract<IKBakeSampleResult, { success: true }> {
  assert.isTrue(result.success, JSON.stringify(result.issues));
}

function successfulPlan(plan: IKBakePlan): asserts plan is Extract<IKBakePlan, { success: true }> {
  assert.isTrue(plan.success, JSON.stringify(plan.issues));
}

function changedPose(
  samples: readonly IKBakeSample[],
  boneId: string,
  change: Partial<JointTransform>,
): IKBakeSample[] {
  return samples.map((sample) => ({
    ...sample,
    pose: new Map([...sample.pose].map(([id, pose]) => [id, id === boneId ? { ...pose, ...change } : pose])),
  }));
}

test.each(['arm', 'leg'])('generates ordinary radian keys only for the %s root and middle bones', (id) => {
  const skeleton = rig();
  const source = animation();
  const samples = sampleIKBake(source, skeleton, [id]);
  successfulSamples(samples);
  const plan = generateBakedBoneKeys(samples, skeleton, { animation: source });
  successfulPlan(plan);
  assert.deepEqual(Object.keys(plan.generatedAnimation.tracks), samples.boneIds);
  assert.deepEqual(plan.generatedAnimation.playback, { mode: 'stepped', fps: 10 });
  assert.equal(plan.generatedAnimation.interpolation, 'linear');
  assert.isUndefined(plan.generatedAnimation.ikTracks);
  assert.isUndefined(plan.generatedAnimation.events);
  assert.equal(plan.generatedKeyCount, 24);
  assert.equal(plan.replacedKeyCount, id === 'arm' ? 5 : 0);
  assert.equal(plan.affectedBones.length, 2);
  assert.isTrue(plan.fidelity.success);
  assert.equal(plan.fidelity.differences.length, 24);
  for (const boneId of samples.boneIds) {
    const keys = plan.generatedAnimation.tracks[boneId]!;
    assert.deepEqual(
      keys.map((key) => key.time),
      samples.samples.map((sample) => sample.time),
    );
    for (const [index, key] of keys.entries()) {
      assert.deepEqual(Object.keys(key).sort(), ['rotation', 'time']);
      assert.equal(key.rotation, samples.samples[index]!.pose.get(boneId)!.rotation);
      assert.isBelow(Math.abs(key.rotation!), Math.PI * 2);
    }
  }
  if (id === 'arm')
    assert.deepEqual(plan.affectedBones[0]!.properties[0]!.existingKeys, [
      { time: 0, value: 0.2 },
      { time: 525, value: 0.5 },
      { time: 1050, value: 0.8 },
    ]);
});

test.each(['stepped', 'smooth'] as const)(
  'multiple chains compile, serialize and sample in the existing %s runtime',
  (outputMode) => {
    const skeleton = rig();
    const source = animation();
    const samples = sampleIKBake(source, skeleton, ['leg', 'arm'], { fps: 3 });
    successfulSamples(samples);
    const plan = generateBakedBoneKeys(samples, skeleton, { animation: source, outputMode });
    successfulPlan(plan);
    assert.deepEqual(plan.sampling.times, [0, 1000 / 3, 2000 / 3, 1000, 1050]);
    assert.deepEqual(plan.sampling.constraintIds, ['leg', 'arm']);
    assert.equal(plan.generatedKeyCount, 20);
    assert.equal(plan.issues.length, outputMode === 'smooth' ? 1 : 0);
    if (outputMode === 'smooth') assert.equal(plan.issues[0]!.code, 'between-sample-interpolation');
    const exported = serializeAnimation({ version: 1, ...plan.generatedAnimation }, skeleton);
    assert.isTrue(exported.success, JSON.stringify(exported.issues));
    if (!exported.success) return;
    const parsed = parseAnimationClip(JSON.parse(exported.json), skeleton);
    const clip = compileClip({ ...parsed, loop: false }, skeleton);
    const joints = new Map(skeleton.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
    const player = new AnimationPlayer(skeleton, joints, [clip]);
    player.play(source.name);
    for (const sample of samples.samples) {
      player.sample(sample.time, { mode: 'playback' });
      for (const [boneId, pose] of sample.pose)
        assert.approximately(joints.get(boneId)!.pose.rotation, pose.rotation, 1e-10);
    }
    const firstBone = samples.boneIds[0]!;
    const first = parsed.tracks[firstBone]![0]!.rotation!;
    player.sample(100, { mode: 'playback' });
    if (outputMode === 'stepped') assert.equal(joints.get(firstBone)!.pose.rotation, first);
    else assert.notEqual(joints.get(firstBone)!.pose.rotation, first);
    player.dispose();
  },
);

test('local radian keys retain transformed ancestor conventions and endpoint offsets without world decomposition', () => {
  const base = rig();
  const skeleton = new Rig({
    root: base.root,
    bones: base.bones.map((bone) =>
      bone.id === 'body'
        ? { ...bone, x: 17, y: -25, rotation: 0.7, scaleX: -2, scaleY: 0.8 }
        : bone.id === 'upper'
          ? { ...bone, scaleX: -1.2, scaleY: 1.2 }
          : bone.id === 'lower'
            ? { ...bone, x: 3, scaleX: 0.8, scaleY: 1.1 }
            : bone,
    ),
    ik: base.ik!.map((chain) => (chain.name === 'arm' ? { ...chain, endOffset: { x: 5, y: 7 } } : chain)),
  });
  const source = animation();
  const samples = sampleIKBake(source, skeleton, ['arm']);
  successfulSamples(samples);
  const plan = generateBakedBoneKeys(samples, skeleton, { animation: source, outputMode: 'smooth' });
  successfulPlan(plan);
  const compiled = compileClip(plan.generatedAnimation, skeleton);
  for (const sample of samples.samples) {
    const pose = evaluateClip(compiled, sample.time);
    const matrices = new Map<string, Affine>();
    for (const bone of skeleton.bones) {
      const local = {
        ...createTransform(bone),
        ...(bone.id === 'hand' ? { rotation: 0.4 } : {}),
        ...pose.get(bone.id),
      };
      matrices.set(
        bone.id,
        composeAffine(
          transformToAffine(local, {} as Affine),
          bone.parent ? matrices.get(bone.parent) : undefined,
          {} as Affine,
        ),
      );
    }
    const endpoint = localToWorld({ x: 5, y: 7 }, matrices.get('hand')!);
    const target = sample.constraints.get('arm')!.target!;
    assert.equal(sample.constraints.get('arm')!.status, 'solved');
    assert.approximately(endpoint.x, target.x, 1e-8);
    assert.approximately(endpoint.y, target.y, 1e-8);
  }
});

test.each(['stepped', 'smooth'] as const)(
  'preserves animated sibling properties when validating %s output',
  (outputMode) => {
    const source = animation();
    source.tracks = {
      ...source.tracks,
      upper: [
        { time: 0, x: 4, y: 2, rotation: 0.2, scaleX: 1, scaleY: 1 },
        { time: 525, x: 6, y: 4, rotation: 0.5, scaleX: 1.2, scaleY: 1.2 },
        { time: 1050, x: 8, y: 6, rotation: 0.8, scaleX: 1, scaleY: 1 },
      ],
      lower: [{ time: 0, scaleX: 0.8, scaleY: 1.1 }],
    };
    const skeleton = rig();
    const samples = sampleIKBake(source, skeleton, ['arm']);
    successfulSamples(samples);
    const plan = generateBakedBoneKeys(samples, skeleton, { animation: source, outputMode });
    successfulPlan(plan);
    assert.isTrue(plan.fidelity.success);
    assert.isTrue(
      plan.fidelity.differences.every((difference) => difference.translation < 1e-8 && difference.scale < 1e-8),
    );
    assert.isTrue(
      Object.values(plan.generatedAnimation.tracks)
        .flat()
        .every((key) => Object.keys(key).length === 2),
    );
    assert.isFalse(compareIKBakeFidelity(samples.samples, plan.generatedAnimation, skeleton).success);
  },
);

test('source stepped poses preserve evaluated times and exact off-frame endpoint', () => {
  const skeleton = rig();
  const source = { ...animation(), playback: { mode: 'stepped', fps: 8 } as const };
  const samples = sampleIKBake(source, skeleton, ['arm'], { fps: 16 });
  successfulSamples(samples);
  for (const outputMode of ['stepped', 'smooth'] as const) {
    const plan = generateBakedBoneKeys(samples, skeleton, { animation: source, outputMode });
    successfulPlan(plan);
    assert.equal(plan.sampling.evaluatedTimes[1], 0);
    assert.equal(plan.sampling.times[1], 62.5);
    assert.equal(plan.sampling.times.at(-1), 1050);
    assert.equal(plan.sampling.evaluatedTimes.at(-1), 1050);
    assert.deepEqual(
      plan.generatedAnimation.tracks.upper![0]!.rotation,
      plan.generatedAnimation.tracks.upper![1]!.rotation,
    );
  }
});

test('different stepped playback timing rejects changed ungenerated local properties', () => {
  const skeleton = rig();
  const source = {
    ...animation(),
    playback: { mode: 'stepped', fps: 8 } as const,
    tracks: {
      upper: [
        { time: 0, x: 4 },
        { time: 1050, x: 8 },
      ],
    },
  };
  const samples = sampleIKBake(source, skeleton, ['arm'], { fps: 16 });
  successfulSamples(samples);
  const plan = generateBakedBoneKeys(samples, skeleton, { animation: source });
  assert.isFalse(plan.success);
  assert.isFalse('generatedAnimation' in plan);
  assert.isTrue(plan.issues.some((issue) => issue.code === 'fidelity-mismatch' && issue.time === 62.5));
});

test('comparison measures translation, shortest radian distance and scale with documented tolerances', () => {
  const skeleton = rig();
  const candidate: AnimationClip = {
    name: 'candidate',
    duration: 1000,
    loop: false,
    tracks: { upper: [{ time: 0, x: 4, y: 0, rotation: Math.PI * 2, scaleX: 1, scaleY: 1 }] },
  };
  const sample: IKBakeSample = {
    time: 0,
    evaluatedTime: 0,
    pose: new Map([['upper', createTransform({ x: 4, rotation: 0 })]]),
    constraints: new Map(),
  };
  const exact = compareIKBakeFidelity([sample], candidate, skeleton);
  assert.isTrue(exact.success);
  assert.deepEqual(exact.tolerances, DEFAULT_IK_BAKE_TOLERANCES);
  const shifted = changedPose([sample], 'upper', { x: 4.003, y: 0.004, rotation: 0.01, scaleX: 1.02 });
  const mismatch = compareIKBakeFidelity(shifted, candidate, skeleton);
  assert.isFalse(mismatch.success);
  assert.approximately(mismatch.maximumErrors.translation, 0.005, 1e-12);
  assert.approximately(mismatch.maximumErrors.rotation, 0.01, 1e-12);
  assert.approximately(mismatch.maximumErrors.scale, 0.02, 1e-12);
  assert.equal(mismatch.issues[0]!.code, 'fidelity-mismatch');
  assert.isTrue(
    compareIKBakeFidelity(shifted, candidate, skeleton, { translation: 0.006, rotation: 0.011, scale: 0.021 }).success,
  );
});

test('comparison rejects invalid values, keys, times, bones, tolerances and arithmetic overflow', () => {
  const skeleton = rig();
  const source = animation();
  const samples = sampleIKBake(source, skeleton, ['arm']);
  successfulSamples(samples);
  const plan = generateBakedBoneKeys(samples, skeleton, { animation: source });
  successfulPlan(plan);
  for (const value of [NaN, Infinity, -Infinity]) {
    const report = compareIKBakeFidelity(
      changedPose(samples.samples, 'upper', { rotation: value }),
      plan.generatedAnimation,
      skeleton,
    );
    assert.isFalse(report.success);
    assert.equal(report.issues[0]!.code, 'non-finite-transform');
  }
  for (const value of [-1, NaN, Infinity])
    assert.isFalse(
      compareIKBakeFidelity(samples.samples, plan.generatedAnimation, skeleton, { rotation: value }).success,
    );
  for (const time of [-1, NaN, Infinity, 2000])
    assert.isFalse(
      compareIKBakeFidelity([{ ...samples.samples[0]!, time }], plan.generatedAnimation, skeleton).success,
    );
  assert.isFalse(compareIKBakeFidelity([], plan.generatedAnimation, skeleton).success);
  assert.isFalse(
    compareIKBakeFidelity([{ ...samples.samples[0]!, pose: new Map() }], plan.generatedAnimation, skeleton).success,
  );
  assert.isFalse(
    compareIKBakeFidelity(
      [{ ...samples.samples[0]!, pose: new Map([['missing', createTransform()]]) }],
      plan.generatedAnimation,
      skeleton,
    ).success,
  );
  assert.isFalse(
    compareIKBakeFidelity(
      samples.samples,
      { ...plan.generatedAnimation, tracks: { upper: [{ time: 0, rotation: NaN }] } },
      skeleton,
    ).success,
  );
  const overflow = compareIKBakeFidelity(
    changedPose(samples.samples.slice(0, 1), 'upper', { x: -1e308 }),
    { ...plan.generatedAnimation, tracks: { upper: [{ time: 0, x: 1e308 }] } },
    skeleton,
  );
  assert.isFalse(overflow.success);
  assert.equal(overflow.issues[0]!.code, 'non-finite-transform');
});

test('generation atomically rejects incomplete, unordered, foreign and non-finite samples', () => {
  const skeleton = rig();
  const source = animation();
  const samples = sampleIKBake(source, skeleton, ['arm']);
  successfulSamples(samples);
  const variants: IKBakeSampleResult[] = [
    { ...samples, samples: samples.samples.slice(1) },
    { ...samples, samples: [...samples.samples].reverse() },
    { ...samples, boneIds: ['upper', 'hand'] },
    { ...samples, constraintIds: ['missing'] },
    { ...samples, constraintIds: ['arm', 'arm'] },
    { ...samples, samples: samples.samples.map((sample) => ({ ...sample, evaluatedTime: NaN })) },
    { ...samples, samples: changedPose(samples.samples, 'upper', { rotation: NaN }) },
    { ...samples, samples: changedPose(samples.samples, 'lower', { scaleY: Infinity }) },
    {
      ...samples,
      samples: samples.samples.map((sample) => ({
        ...sample,
        pose: new Map([...sample.pose].filter(([id]) => id !== 'lower')),
      })),
    },
    {
      ...samples,
      samples: samples.samples.map((sample) => ({
        ...sample,
        constraints: new Map([['arm', { status: 'singular-transform' as const }]]),
      })),
    },
  ];
  for (const input of variants) {
    const plan = generateBakedBoneKeys(input, skeleton, { animation: source });
    assert.isFalse(plan.success);
    assert.isFalse('generatedAnimation' in plan);
    assert.isNotEmpty(plan.issues);
  }
  for (const value of [-1, NaN, Infinity])
    assert.isFalse(
      generateBakedBoneKeys(samples, skeleton, { animation: source, tolerances: { rotation: value } }).success,
    );
  assert.isFalse(generateBakedBoneKeys(samples, skeleton, { animation: { ...source, duration: 0 } }).success);
});

test('generation rechecks selected and unselected ownership and preserves failed sampler diagnostics', () => {
  const skeleton = rig();
  const source = animation();
  const samples = sampleIKBake(source, skeleton, ['arm']);
  successfulSamples(samples);
  const competing = new Rig({
    root: skeleton.root,
    bones: skeleton.bones,
    ik: [...skeleton.ik!, { ...skeleton.ik![0]!, name: 'competitor', priority: 100 }],
  });
  for (const input of [samples, { ...samples, constraintIds: ['arm', 'competitor'] }]) {
    const plan = generateBakedBoneKeys(input, competing, { animation: source });
    assert.isFalse(plan.success);
    assert.equal(plan.issues[0]!.code, 'competing-constraint');
  }
  const failed = sampleIKBake(source, competing, ['arm']);
  const plan = generateBakedBoneKeys(failed, competing, { animation: source });
  assert.isFalse(plan.success);
  assert.deepEqual(plan.issues, failed.issues);
  assert.notStrictEqual(plan.issues, failed.issues);
  const disabled = new Rig({
    root: skeleton.root,
    bones: skeleton.bones,
    ik: competing.ik!.map((chain) => (chain.name === 'competitor' ? { ...chain, enabled: false } : chain)),
  });
  successfulPlan(generateBakedBoneKeys(samples, disabled, { animation: source }));
});

test('proposals own immutable data without freezing or changing mutable samples, source or editor state', () => {
  const skeleton = rig();
  const source = animation();
  const state = new AnimationEditorState(skeleton, [source]);
  state.selectAnimation(source.name);
  state.setBonePropertyKeyframe('upper', 'x', 5, 0);
  state.setBonePropertyKeyframe('upper', 'x', 6, 0);
  state.undo();
  state.selectBone('upper');
  state.setTemporaryBoneProperty('rotation', 0.4);
  state.setCurrentTime(0.45);
  const working = state.workingAnimation!;
  const before = {
    json: JSON.stringify(working),
    history: state.historyLength,
    time: state.currentTime,
    dirty: state.dirty,
    redo: state.canRedo,
    draft: state.boneTransformDraft,
  };
  const samples = sampleIKBake(working, skeleton, ['arm']);
  successfulSamples(samples);
  const mutablePose = { ...samples.samples[0]!.pose.get('upper')! };
  const mutable = {
    ...samples,
    boneIds: [...samples.boneIds],
    constraintIds: [...samples.constraintIds],
    samples: samples.samples.map((sample, index) =>
      index === 0
        ? { ...sample, pose: new Map([...sample.pose].map(([id, pose]) => [id, id === 'upper' ? mutablePose : pose])) }
        : sample,
    ),
    issues: [],
  };
  const plan = generateBakedBoneKeys(mutable, skeleton, { animation: working });
  successfulPlan(plan);
  assert.deepEqual(
    {
      json: JSON.stringify(state.workingAnimation),
      history: state.historyLength,
      time: state.currentTime,
      dirty: state.dirty,
      redo: state.canRedo,
      draft: state.boneTransformDraft,
    },
    before,
  );
  assert.strictEqual(state.workingAnimation, working);
  assert.isFalse(Object.isFrozen(mutable.boneIds));
  assert.isFalse(Object.isFrozen(mutable.samples[0]!.pose.get('upper')));
  assert.isFalse(Object.isFrozen(source));
  assert.isTrue(Object.isFrozen(plan.generatedAnimation.tracks.upper![0]));
  assert.isTrue(Object.isFrozen(plan.affectedBones[0]!.properties[0]!.existingKeys));
  assert.isTrue(Object.isFrozen(plan.fidelity.differences[0]));
  mutable.boneIds[0] = 'changed';
  mutablePose.rotation = 100;
  assert.equal(plan.affectedBones[0]!.boneId, 'upper');
  assert.notEqual(plan.generatedAnimation.tracks.upper![0]!.rotation, 100);
  const detachedSource = structuredClone(source);
  const detachedSamples = sampleIKBake(detachedSource, skeleton, ['arm']);
  successfulSamples(detachedSamples);
  const detachedPlan = generateBakedBoneKeys(detachedSamples, skeleton, { animation: detachedSource });
  successfulPlan(detachedPlan);
  detachedSource.tracks.upper![0]!.rotation = 123;
  assert.equal(detachedPlan.affectedBones[0]!.properties[0]!.existingKeys[0]!.value, 0.2);
  const frozenSource = freezeData(structuredClone(source));
  const frozenSamples = sampleIKBake(frozenSource, skeleton, ['arm']);
  assert.deepEqual(generateBakedBoneKeys(frozenSamples, skeleton, { animation: frozenSource }), detachedPlan);
});
