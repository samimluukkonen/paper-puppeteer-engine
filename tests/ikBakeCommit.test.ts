import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { serializeAnimation } from '../src/devtools/animation-editor/animationSerialization.js';
import {
  type AnimationClip,
  AnimationPlayer,
  commitIKBake,
  compareIKBakeMotion,
  compileClip,
  generateBakedBoneKeys,
  type IKBakePlan,
  Joint,
  parseAnimationClip,
  Rig,
  sampleIKBake,
} from '../src/engine/core.js';
import { IsolatedIKSampler } from '../src/engine/ik/IsolatedIKSampler.js';
import { Puppet } from '../src/engine/Puppet.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function fixture(playback?: AnimationClip['playback']) {
  const rig = new Rig({
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
  const source: AnimationClip = {
    name: 'reach',
    duration: 1050,
    loop: false,
    interpolation: 'linear',
    ...(playback ? { playback } : {}),
    tracks: {
      body: [
        { time: 0, x: 0 },
        { time: 1050, x: 5 },
      ],
      upper: [
        { time: 0, rotation: 0.2, x: 4, scaleX: 1 },
        { time: 525, rotation: 0.5, y: 3 },
        { time: 1050, rotation: 0.8, x: 7 },
      ],
      lower: [
        { time: 0, rotation: 0.3 },
        { time: 100, scaleY: 1 },
        { time: 1050, rotation: -0.1 },
      ],
      hand: [{ time: 0, rotation: 0.4 }],
    },
    ikTracks: {
      arm: [
        { time: 0, x: 60, y: 60, mix: 0.7 },
        { time: 1050, x: -30, y: 75, mix: 1 },
      ],
      leg: [
        { time: 0, x: -25, y: 110 },
        { time: 1050, x: -45, y: 90 },
      ],
    },
    events: [{ time: 300, name: 'event', data: { preserved: true } }],
  };
  return { rig, source };
}

function planFor(source: AnimationClip, rig: Rig, ids = ['arm'], fps?: number) {
  const samples = sampleIKBake(source, rig, ids, fps === undefined ? {} : { fps });
  assert.isTrue(samples.success, JSON.stringify(samples.issues));
  const plan = generateBakedBoneKeys(samples, rig, { animation: source });
  assert.isTrue(plan.success, JSON.stringify(plan.issues));
  if (!plan.success) throw new Error('Generation failed.');
  return plan;
}

test.each(
  ['constructor', 'toString', 'hasOwnProperty'].flatMap((boneId) => [false, true].map((keyed) => ({ boneId, keyed }))),
)('bakes prototype-named bones with sparse or authored tracks ($boneId, keyed: $keyed)', ({ boneId, keyed }) => {
  const rig = new Rig({
    root: 'body',
    bones: [
      { id: 'body' },
      { id: boneId, parent: 'body' },
      { id: 'middle', parent: boneId, x: 10 },
      { id: 'end', parent: 'middle', x: 10 },
    ],
    ik: [{ name: 'arm', rootBone: boneId, middleBone: 'middle', endBone: 'end' }],
  });
  const source: AnimationClip = {
    name: 'reach',
    duration: 1000,
    loop: false,
    tracks: keyed ? { [boneId]: [{ time: 0, x: 2 }] } : {},
    ikTracks: { arm: [{ time: 0, x: 12, y: 8 }] },
  };
  const before = structuredClone(source);
  const plan = planFor(source, rig);
  const result = commitIKBake(source, plan, rig);
  assert.isTrue(result.success, JSON.stringify(result.issues));
  if (!result.success) return;
  assert.isTrue(result.motionFidelity.success);
  assert.isTrue(Object.hasOwn(result.animation.tracks, boneId));
  assert.equal(result.animation.tracks[boneId]![0]!.x, keyed ? 2 : undefined);
  assert.deepEqual(source, before);
  // Motion comparisons also accept absent tracks when a constraint has no authored target.
  const inactive = { ...source, tracks: {}, ikTracks: {} };
  const motion = compareIKBakeMotion(inactive, { ...inactive, disabledIKConstraints: ['arm'] }, rig, ['arm'], 10);
  assert.isTrue(motion.success, JSON.stringify(motion.issues));
});

test.each([undefined, { mode: 'smooth' } as const, { mode: 'stepped', fps: 12 } as const])(
  'atomically replaces only generated properties while preserving clip metadata (%j)',
  (playback) => {
    const { source, rig } = fixture(playback);
    const before = structuredClone(source);
    const rigBefore = JSON.stringify(rig);
    const plan = planFor(source, rig);
    const result = commitIKBake(source, plan, rig);
    assert.isTrue(result.success, JSON.stringify(result.issues));
    if (!result.success) return;
    assert.deepEqual(source, before);
    assert.isFalse(Object.isFrozen(source));
    assert.equal(JSON.stringify(rig), rigBefore);
    const baked = result.animation;
    assert.deepEqual(baked.disabledIKConstraints, ['arm']);
    assert.isFalse(Object.hasOwn(baked.ikTracks!, 'arm'));
    assert.deepEqual(baked.ikTracks!.leg, source.ikTracks!.leg);
    assert.deepEqual(baked.events, source.events);
    assert.deepEqual(baked.playback, source.playback);
    assert.equal(Object.hasOwn(baked, 'playback'), Object.hasOwn(source, 'playback'));
    assert.equal(baked.duration, source.duration);
    assert.equal(baked.loop, source.loop);
    assert.equal(baked.interpolation, source.interpolation);
    assert.deepEqual(baked.tracks.body, source.tracks.body);
    assert.deepEqual(baked.tracks.hand, source.tracks.hand);
    for (const id of ['upper', 'lower']) {
      const keys = baked.tracks[id]!;
      assert.deepEqual(
        keys.filter((key) => key.rotation !== undefined).map(({ time, rotation }) => ({ time, rotation })),
        [...plan.generatedAnimation.tracks[id]!].map(({ time, rotation }) => ({ time, rotation })),
      );
      const siblings = (animation: AnimationClip) =>
        animation.tracks[id]!.flatMap(({ rotation: _rotation, ...row }) => (Object.keys(row).length > 1 ? [row] : []));
      assert.deepEqual(siblings(baked), siblings(source));
      assert.equal(new Set(keys.map((key) => key.time)).size, keys.length);
    }
    assert.isTrue(Object.isFrozen(baked.tracks.upper![0]));
    assert.isTrue(Object.isFrozen(baked.disabledIKConstraints));
    const expected = new IsolatedIKSampler(rig);
    const actual = new IsolatedIKSampler(rig);
    for (const time of plan.sampling.times) {
      const a = expected.sample(compileClip(source, rig), time);
      const b = actual.sample(compileClip(baked, rig), time);
      for (const id of ['upper', 'lower', 'thigh', 'shin'])
        assert.approximately(b.pose.get(id)!.rotation, a.pose.get(id)!.rotation, 1e-9);
      assert.equal(b.constraints.get('arm')!.status, 'inactive');
      assert.equal(b.constraints.get('leg')!.status, a.constraints.get('leg')!.status);
    }
  },
);

test('one editor history entry restores original IK and exact baked data, including saved checkpoints', () => {
  const { source, rig } = fixture({ mode: 'stepped', fps: 12 });
  const other = { ...structuredClone(source), name: 'other' };
  const state = new AnimationEditorState(rig, [source, other]);
  state.selectAnimation('reach');
  state.selectBone('upper');
  state.setTemporaryBoneProperty('rotation', 0.9);
  const original = state.workingAnimation!;
  const plan = planFor(original, rig);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  let notifications = 0;
  const unsubscribe = state.subscribe(() => ++notifications);
  assert.isTrue(state.commitIKBake(plan));
  assert.equal(notifications, 1);
  const baked = state.workingAnimation;
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, 1);
  assert.strictEqual(state.sourceAnimation, original);
  assert.isTrue(state.undo());
  assert.strictEqual(state.workingAnimation, original);
  assert.isFalse(state.dirty);
  assert.isFalse(state.canUndo);
  assert.isTrue(state.redo());
  assert.strictEqual(state.workingAnimation, baked);
  state.markSaved();
  state.undo();
  assert.isTrue(state.dirty);
  state.redo();
  assert.isFalse(state.dirty);
  assert.isTrue(state.ik.getIKManipulationDisabledReason('arm')?.includes('baked'));
  assert.isFalse(state.ik.beginIKTargetDrag('arm'));
  assert.isTrue(state.selectAnimation('other'));
  assert.deepEqual(state.workingAnimation!.ikTracks, other.ikTracks);
  assert.isUndefined(state.workingAnimation!.disabledIKConstraints);
  unsubscribe();
});

test('failed, stale and forged plans preserve working data, drafts, clock, history and redo', () => {
  const { source, rig } = fixture();
  const state = new AnimationEditorState(rig, [source]);
  state.selectAnimation('reach');
  const valid = planFor(state.workingAnimation!, rig);
  state.setBonePropertyKeyframe('upper', 'x', 8, 0);
  const stale = planFor(state.workingAnimation!, rig);
  state.undo();
  state.selectBone('upper');
  state.setTemporaryBoneProperty('rotation', 0.4);
  state.setCurrentTime(0.45);
  const forged = {
    ...valid,
    generatedAnimation: {
      ...valid.generatedAnimation,
      tracks: {
        ...valid.generatedAnimation.tracks,
        upper: valid.generatedAnimation.tracks.upper!.map((key, i) => (i === 0 ? { ...key, rotation: 100 } : key)),
      },
    },
  };
  const malformed = { ...valid, sampling: { ...valid.sampling, constraintIds: ['unknown'] } };
  const plans: IKBakePlan[] = [
    { success: false, issues: [{ code: 'invalid-generation', severity: 'error', message: 'Failed preview.' }] },
    stale,
    forged,
    malformed,
    { ...valid, generatedKeyCount: valid.generatedKeyCount + 1 },
    { ...valid, sampling: { ...valid.sampling, duration: source.duration / 2 } },
  ];
  const original = state.workingAnimation;
  const before = {
    json: JSON.stringify(original),
    draft: state.boneTransformDraft,
    time: state.currentTime,
    dirty: state.dirty,
    history: state.historyLength,
    redo: state.canRedo,
  };
  for (const plan of plans) {
    assert.isFalse(state.commitIKBake(plan));
    assert.strictEqual(state.workingAnimation, original);
    assert.deepEqual(
      {
        json: JSON.stringify(state.workingAnimation),
        draft: state.boneTransformDraft,
        time: state.currentTime,
        dirty: state.dirty,
        history: state.historyLength,
        redo: state.canRedo,
      },
      before,
    );
  }
  assert.isTrue(state.commitIKBake(structuredClone(valid)), 'detached plans remain usable');
});

test('actual Puppet playback and exported data skip baked IK even with runtime ownership', () => {
  const { source, rig } = fixture({ mode: 'stepped', fps: 12 });
  const plan = planFor(source, rig);
  const result = commitIKBake(source, plan, rig);
  assert.isTrue(result.success);
  if (!result.success) return;
  const exported = serializeAnimation({ version: 1, ...result.animation }, rig);
  assert.isTrue(exported.success);
  if (!exported.success) return;
  const baked = parseAnimationClip(JSON.parse(exported.json), rig);
  assert.deepEqual(baked.disabledIKConstraints, ['arm']);
  const other = { ...source, name: 'other' };
  const puppet = new Puppet(puppetScene(), { rig, animations: [baked, other], autoUpdate: false });
  const reference = new Puppet(puppetScene(), { rig, animations: [source], autoUpdate: false });
  puppet.play('reach');
  reference.play('reach');
  const provider = vi.fn(() => ({ x: -90, y: 10 }));
  puppet.getIK('arm').setTargetProvider(provider);
  puppet.getIK('arm').mix = 1;
  for (const time of plan.sampling.times) {
    reference.sampleAnimation(time, { mode: 'playback' });
    puppet.sampleAnimation(time, { mode: 'playback' });
    puppet.posePipeline.syncIK();
    for (const id of ['upper', 'lower', 'thigh', 'shin'])
      assert.approximately(puppet.getBone(id).pose.rotation, reference.getBone(id).pose.rotation, 1e-6);
    assert.equal(puppet.getIK('arm').status, 'inactive');
    assert.isTrue(puppet.getIK('arm').enabled);
    assert.equal(puppet.getIK('leg').status, reference.getIK('leg').status);
  }
  assert.equal(provider.mock.calls.length, 0);
  puppet.getIK('arm').setTarget(80, 20);
  puppet.posePipeline.syncIK();
  assert.equal(puppet.getIK('arm').status, 'inactive');
  puppet.play('other');
  assert.equal(puppet.getIK('arm').status, 'solved');
  puppet.getIK('arm').target = undefined;
  puppet.getIK('arm').clearMixOverride();
  puppet.sampleAnimation(0);
  reference.sampleAnimation(0);
  assert.approximately(puppet.getBone('upper').pose.rotation, reference.getBone('upper').pose.rotation, 1e-9);
  puppet.play('reach');
  puppet.update(250);
  assert.equal(puppet.getIK('arm').status, 'inactive');
  puppet.destroy();
  reference.destroy();
});

test('deactivation follows layer root masks, weights, fades and interrupted fade ownership', () => {
  const { source, rig } = fixture();
  const result = commitIKBake(source, planFor(source, rig), rig);
  assert.isTrue(result.success);
  if (!result.success) return;
  const puppet = new Puppet(puppetScene(), {
    rig,
    animations: [{ ...source, name: 'active' }, result.animation],
    autoUpdate: false,
  });
  puppet.play('active');
  puppet.play('reach', { layer: 'overlay' });
  assert.equal(puppet.getIK('arm').status, 'inactive');
  puppet.setLayerMask('overlay', ['hand']);
  assert.equal(puppet.getIK('arm').status, 'solved');
  puppet.setLayerMask('overlay', ['upper']);
  puppet.setLayerWeight('overlay', 0);
  assert.equal(puppet.getIK('arm').status, 'solved');
  puppet.setLayerWeight('overlay', 0.5);
  assert.equal(puppet.posePipeline.player.ikAnimation.get('arm')!.disabled!.weight, 0.5);
  puppet.clearLayer('overlay');
  puppet.play('reach', { fadeDuration: 1000 });
  puppet.update(500);
  assert.equal(puppet.posePipeline.player.ikAnimation.get('arm')!.disabled!.weight, 0.5);
  puppet.play('active', { fadeDuration: 1000 });
  assert.equal(puppet.posePipeline.player.ikAnimation.get('arm')!.disabled!.weight, 0.5);
  puppet.update(500);
  assert.equal(puppet.posePipeline.player.ikAnimation.get('arm')!.disabled!.weight, 0.25);
  puppet.update(500);
  assert.isUndefined(puppet.posePipeline.player.ikAnimation.get('arm')!.disabled);
  assert.equal(puppet.getIK('arm').status, 'solved');
  puppet.play('reach', { fadeDuration: 100 });
  puppet.update(100);
  assert.equal(puppet.getIK('arm').status, 'inactive');
  puppet.destroy();
});

test('validates deactivation references and owns compiled lists without changing legacy behavior', () => {
  const { source, rig } = fixture();
  assert.throws(() => compileClip({ ...source, disabledIKConstraints: ['missing'] }, rig));
  assert.throws(() => compileClip({ ...source, disabledIKConstraints: ['arm', 'arm'] }, rig));
  const compiled = compileClip({ ...source, disabledIKConstraints: ['arm'] }, rig);
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  assert.throws(() => new AnimationPlayer(rig, joints, [{ ...compiled, disabledIKConstraints: ['missing'] }]));
  const list = ['arm'];
  const player = new AnimationPlayer(rig, joints, [{ ...compiled, disabledIKConstraints: list }]);
  list[0] = 'leg';
  player.play(source.name);
  assert.equal(player.ikAnimation.get('arm')!.disabled!.value, 1);
  player.dispose();
  const legacy = compileClip(source, rig);
  assert.isUndefined(legacy.disabledIKConstraints);
});

test('bakes multiple constraints and retains existing clip-local deactivations', () => {
  const { source, rig } = fixture();
  const both = commitIKBake(source, planFor(source, rig, ['leg', 'arm']), rig);
  assert.isTrue(both.success);
  if (!both.success) return;
  assert.deepEqual(both.animation.disabledIKConstraints, ['arm', 'leg']);
  assert.deepEqual(both.animation.ikTracks, {});
  const preDisabled = { ...source, disabledIKConstraints: ['leg'] };
  const result = commitIKBake(preDisabled, planFor(preDisabled, rig), rig);
  assert.isTrue(result.success);
  if (!result.success) return;
  assert.deepEqual(result.animation.disabledIKConstraints, ['arm', 'leg']);
  assert.deepEqual(result.animation.ikTracks!.leg, source.ikTracks!.leg);
});

test('rejects a proposal whose sample grid loses fidelity under preserved authored FPS', () => {
  const { source, rig } = fixture({ mode: 'stepped', fps: 12 });
  source.tracks = { upper: [{ time: 0, rotation: 0.2 }], lower: [{ time: 0, rotation: 0.3 }] };
  const state = new AnimationEditorState(rig, [source]);
  state.selectAnimation('reach');
  const original = state.workingAnimation;
  const plan = planFor(original!, rig, ['arm'], 10);
  assert.isTrue(plan.fidelity.success);
  assert.isFalse(state.commitIKBake(plan));
  assert.strictEqual(state.workingAnimation, original);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.isTrue(state.validationIssues.some((issue) => issue.message.includes('tolerances')));
});

test('retains exact near-grid sibling times and ignores clip-disabled competing constraints', () => {
  const { source, rig } = fixture();
  const skeleton = new Rig({
    root: rig.root,
    bones: rig.bones,
    ik: [...rig.ik!, { name: 'competing', rootBone: 'upper', middleBone: 'lower', endBone: 'hand' }],
  });
  source.disabledIKConstraints = ['competing'];
  source.tracks = {
    ...source.tracks,
    upper: [...source.tracks.upper!, { time: 100 + 1e-7, scaleX: 1 }].sort((a, b) => a.time - b.time),
  };
  const plan = planFor(source, skeleton);
  const result = commitIKBake(source, plan, skeleton);
  assert.isTrue(result.success, JSON.stringify(result.issues));
  if (!result.success) return;
  assert.deepEqual(result.animation.disabledIKConstraints, ['arm', 'competing']);
  assert.isTrue(result.animation.tracks.upper!.some((key) => key.time === 100 && key.rotation !== undefined));
  assert.deepEqual(
    result.animation.tracks.upper!.find((key) => key.time === 100 + 1e-7),
    { time: 100 + 1e-7, scaleX: 1 },
  );
});
