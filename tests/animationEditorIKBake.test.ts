import { assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { compileClip } from '../src/engine/AnimationClip.js';
import { commitIKBake } from '../src/engine/ik/IKBakeCommit.js';
import { IsolatedIKSampler } from '../src/engine/ik/IsolatedIKSampler.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';
import { ikBakeEditor, waitForIKBake } from './helpers/ikBakeEditor.js';

test('explicit constraint selection and FPS produce an accurate whole-animation summary', async () => {
  const { state, controller } = ikBakeEditor();
  assert.deepEqual(
    controller.getSnapshot().constraints.map((entry) => entry.id),
    ['arm', 'leg'],
  );
  assert.deepEqual(controller.getSnapshot().selectedIds, []);
  assert.isNull(controller.getSnapshot().plan);
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  let plan = controller.getSnapshot().plan;
  assert.isTrue(plan?.success);
  if (!plan?.success) throw new Error('Missing plan');
  assert.deepEqual(plan.sampling.constraintIds, ['arm']);
  assert.deepEqual(
    plan.affectedBones.map((entry) => entry.boneId),
    ['upper', 'lower'],
  );
  assert.equal(plan.generatedKeyCount, 22);
  assert.equal(plan.replacedKeyCount, 2);
  assert.equal(plan.sampling.fps, 10);
  controller.setFPS('5');
  await waitForIKBake(controller);
  plan = controller.getSnapshot().plan;
  assert.isTrue(plan?.success);
  if (!plan?.success) throw new Error('Missing plan');
  assert.equal(plan.generatedKeyCount, 12);
  controller.setConstraint('leg', true);
  await waitForIKBake(controller);
  plan = controller.getSnapshot().plan;
  assert.isTrue(plan?.success);
  if (!plan?.success) throw new Error('Missing plan');
  assert.equal(plan.generatedKeyCount, 24);
  assert.equal(plan.affectedBones.length, 4);
  controller.setConstraint('arm', false);
  await waitForIKBake(controller);
  assert.deepEqual(controller.getSnapshot().selectedIds, ['leg']);
  assert.equal(state.historyLength, 0);
  controller.dispose();
});

test.each(['', '0', '-1', 'NaN', 'Infinity', '1000000000'])(
  'invalid FPS %j blocks preview/commit with feedback',
  async (fps) => {
    const { state, controller } = ikBakeEditor();
    controller.setConstraint('arm', true);
    await waitForIKBake(controller);
    controller.setFPS(fps);
    await waitForIKBake(controller);
    assert.isNull(controller.getSnapshot().plan);
    assert.isTrue(controller.getSnapshot().issues.some((issue) => issue.severity === 'error'));
    controller.togglePreview();
    assert.isFalse(controller.getSnapshot().preview);
    assert.isFalse(controller.commit());
    assert.equal(state.historyLength, 0);
    controller.setFPS('10');
    await waitForIKBake(controller);
    assert.isTrue(controller.getSnapshot().plan?.success);
    controller.dispose();
  },
);

test('unknown selection reports missing constraint and never substitutes another chain', async () => {
  const { controller } = ikBakeEditor();
  controller.setConstraint('missing', true);
  await waitForIKBake(controller);
  assert.isNull(controller.getSnapshot().plan);
  assert.include(controller.getSnapshot().issues[0]!.message, 'Unknown IK constraint');
  assert.deepEqual(controller.getSnapshot().selectedIds, ['missing']);
  controller.dispose();
});

test('invalid animation feedback retains missing-bone validation diagnostics', async () => {
  const { rig, source, controller } = ikBakeEditor();
  const state = new AnimationEditorState(rig, [{ ...source, tracks: { missing: [{ time: 0, rotation: 1 }] } }]);
  state.selectAnimation('reach');
  controller.bind(state);
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  assert.isNull(controller.getSnapshot().plan);
  assert.isTrue(controller.getSnapshot().issues.some((issue) => issue.message.includes('missing')));
  controller.dispose();
});

test('stepped playback and its FPS stay authored when sampling at a compatible different FPS', async () => {
  const { rig, source, controller } = ikBakeEditor();
  const state = new AnimationEditorState(rig, [{ ...source, playback: { mode: 'stepped', fps: 10 } }]);
  state.selectAnimation('reach');
  controller.bind(state);
  controller.setFPS('20');
  await waitForIKBake(controller);
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  assert.isTrue(controller.getSnapshot().plan?.success);
  assert.isTrue(controller.commit());
  assert.deepEqual(state.workingAnimation!.playback, { mode: 'stepped', fps: 10 });
  assert.equal(state.workingAnimation!.tracks.upper!.length, 21);
  controller.dispose();
});

test('option changes publish an atomic selection/plan snapshot and drafts hide previews', async () => {
  const { state, controller } = ikBakeEditor();
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  const snapshots: ReturnType<typeof controller.getSnapshot>[] = [];
  controller.subscribe(() => snapshots.push(controller.getSnapshot()));
  controller.setConstraint('leg', true);
  await waitForIKBake(controller);
  assert.equal(snapshots.length, 2);
  assert.isTrue(snapshots[0]!.pending);
  assert.isNull(snapshots[0]!.plan);
  const plan = snapshots[1]!.plan;
  if (!plan?.success) throw new Error('Missing plan');
  assert.deepEqual(plan.sampling.constraintIds, snapshots[1]!.selectedIds);
  controller.togglePreview();
  state.selectBone('upper');
  state.setTemporaryBoneProperty('rotation', 0.9);
  assert.isFalse(controller.getSnapshot().preview);
  assert.equal(state.historyLength, 0);
  controller.dispose();
});

test('preview samples the actual commit result at the shared playhead without authored mutations or events', async () => {
  const { source, rig, state, controller, show } = ikBakeEditor();
  const sourceBefore = structuredClone(source);
  const original = state.workingAnimation!;
  const events = vi.fn();
  state.playback.onAnimationEvent(events);
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  const plan = controller.getSnapshot().plan;
  if (!plan?.success) throw new Error('Missing plan');
  const candidate = commitIKBake(original, plan, rig);
  if (!candidate.success) throw new Error('Invalid candidate');
  const sampler = new IsolatedIKSampler(rig);
  const clip = compileClip(candidate.animation, rig);
  state.setCurrentTime(0.25);
  state.playback.play();
  controller.togglePreview();
  assert.isFalse(state.playback.isPlaying);
  assert.deepEqual(show.mock.lastCall![0], new Map(sampler.sample(clip, 250).pose));
  const changed = vi.fn();
  controller.subscribe(changed);
  state.setCurrentTime(0.75);
  assert.deepEqual(show.mock.lastCall![0], new Map(sampler.sample(clip, 750).pose));
  // The source clip/clock are not mirrored into competing React state; clock-only changes skip renders.
  assert.equal(changed.mock.calls.length, 0);
  assert.strictEqual(state.workingAnimation, original);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  assert.deepEqual(source, sourceBefore);
  assert.equal(events.mock.calls.length, 0);
  controller.togglePreview();
  assert.isNull(show.mock.lastCall![0]);
  controller.dispose();
});

test('commit invokes the existing command once, pauses, installs bone tracks and restores exact IK with Undo/Redo', async () => {
  const { source, state, controller } = ikBakeEditor();
  const original = state.workingAnimation;
  const before = structuredClone(source);
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  const plan = controller.getSnapshot().plan;
  const commit = vi.spyOn(state, 'replaceWorkingAnimation');
  state.setCurrentTime(0.4);
  state.playback.play();
  assert.isTrue(controller.commit());
  assert.equal(commit.mock.calls.length, 1);
  if (!plan?.success) throw new Error('Missing plan');
  assert.isTrue(Object.hasOwn(commit.mock.calls[0]![0] as object, 'tracks'));
  assert.isFalse(state.playback.isPlaying);
  assert.equal(state.historyLength, 1);
  assert.isTrue(state.dirty);
  assert.equal(state.workingAnimation!.tracks.upper!.length, 11);
  assert.deepEqual(state.workingAnimation!.disabledIKConstraints, ['arm']);
  assert.isUndefined(state.workingAnimation!.ikTracks?.arm);
  assert.deepEqual(state.workingAnimation!.ikTracks?.leg, original!.ikTracks!.leg);
  const baked = state.workingAnimation;
  assert.isNull(controller.getSnapshot().plan);
  assert.include(controller.getSnapshot().feedback, 'IK baked');
  state.undo();
  assert.strictEqual(state.workingAnimation, original);
  assert.isFalse(state.dirty);
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  assert.isTrue(controller.getSnapshot().plan?.success);
  state.redo();
  await waitForIKBake(controller);
  assert.strictEqual(state.workingAnimation, baked);
  assert.isNull(controller.getSnapshot().plan);
  assert.deepEqual(source, before);
  controller.dispose();
});

test('a successful bake clears consumed selection so another disjoint constraint can be baked next', async () => {
  const { state, controller } = ikBakeEditor();
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  assert.isTrue(controller.commit());
  assert.deepEqual(controller.getSnapshot().selectedIds, []);
  controller.setConstraint('leg', true);
  await waitForIKBake(controller);
  assert.isTrue(controller.getSnapshot().plan?.success);
  assert.isTrue(controller.commit());
  assert.deepEqual(state.workingAnimation!.disabledIKConstraints, ['arm', 'leg']);
  assert.equal(state.historyLength, 2);
  state.undo();
  assert.deepEqual(state.workingAnimation!.disabledIKConstraints, ['arm']);
  controller.dispose();
});

test('document/options/session changes clear previews and subscriptions do not retain replaced editors', async () => {
  const { source, rig, state, controller, show } = ikBakeEditor();
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  controller.togglePreview();
  controller.setFPS('5');
  await waitForIKBake(controller);
  assert.isFalse(controller.getSnapshot().preview);
  assert.isNull(show.mock.lastCall![0]);
  controller.togglePreview();
  state.setAuthoredInterpolation('linear');
  await waitForIKBake(controller);
  assert.isFalse(controller.getSnapshot().preview);
  controller.togglePreview();
  state.selectAnimation('other', { discardChanges: true });
  assert.isFalse(controller.getSnapshot().preview);
  assert.deepEqual(controller.getSnapshot().selectedIds, []);
  assert.isNull(controller.getSnapshot().motionFidelity);
  const replacement = new AnimationEditorState(rig, [source]);
  replacement.selectAnimation('reach');
  controller.bind(replacement);
  const snapshot = controller.getSnapshot();
  state.setCurrentTime(0.8);
  assert.strictEqual(controller.getSnapshot(), snapshot);
  controller.unbind();
  assert.deepEqual(controller.getSnapshot().constraints, []);
  assert.isNull(controller.getSnapshot().motionFidelity);
  const calls = show.mock.calls.length;
  replacement.setCurrentTime(0.5);
  assert.equal(show.mock.calls.length, calls);
  controller.dispose();
  controller.dispose();
});

test('measured low-FPS warnings and stepped-grid errors reach the panel and clear on option changes', async () => {
  const { state, source, controller, rig } = ikBakeEditor();
  const rapid = {
    ...source,
    ikTracks: {
      ...source.ikTracks,
      arm: [
        { time: 0, x: 60, y: 60 },
        { time: 50, x: -60, y: 60 },
        { time: 100, x: 60, y: 60 },
        { time: 1000, x: 60, y: 60 },
      ],
    },
  };
  assert.isTrue(state.replaceWorkingAnimation({ version: 1, ...rapid }));
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  const low = controller.getSnapshot();
  assert.isTrue(low.plan?.success);
  assert.isFalse(low.motionFidelity!.withinBetweenKeyTolerance);
  assert.isTrue(low.issues.some((issue) => issue.message.includes('Increase sampling FPS')));
  controller.setFPS('60');
  await waitForIKBake(controller);
  assert.isBelow(
    controller.getSnapshot().motionFidelity!.betweenKeys.endEffector,
    low.motionFidelity!.betweenKeys.endEffector,
  );
  const stepped = new AnimationEditorState(rig, [{ ...source, playback: { mode: 'stepped', fps: 12 } }]);
  stepped.selectAnimation('reach');
  controller.bind(stepped);
  controller.setFPS('10');
  await waitForIKBake(controller);
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  assert.isNull(controller.getSnapshot().plan);
  assert.isNull(controller.getSnapshot().motionFidelity);
  assert.isTrue(controller.getSnapshot().issues.some((issue) => issue.message.includes('Use the authored FPS')));
  controller.setFPS('12');
  await waitForIKBake(controller);
  assert.isTrue(controller.getSnapshot().motionFidelity?.success);
  controller.dispose();
});

test('runtime providers, target/mix ownership and configuration block baking without evaluating external input', async () => {
  let runtime: TwoBoneIKConstraint[] = [];
  const { rig, controller } = ikBakeEditor(() => runtime);
  runtime = rig.ik!.map(
    (definition) =>
      new TwoBoneIKConstraint(definition, rig, new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]))),
  );
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  assert.isTrue(controller.getSnapshot().plan?.success);
  const provider = vi.fn(() => ({ x: 5, y: 5 }));
  runtime[0]!.setTargetProvider(provider);
  controller.refreshRuntime();
  await waitForIKBake(controller);
  assert.isNull(controller.getSnapshot().plan);
  assert.include(controller.getSnapshot().issues[0]!.message, 'runtime state');
  assert.equal(provider.mock.calls.length, 0);
  runtime[0]!.setTargetProvider(undefined);
  controller.refreshRuntime();
  await waitForIKBake(controller);
  assert.isTrue(controller.getSnapshot().plan?.success);
  runtime[0]!.mix = 1;
  assert.isFalse(controller.commit(), 'commit rechecks ownership even without a notification');
  runtime[0]!.clearMixOverride();
  runtime[0]!.setTarget(10, 10);
  controller.refreshRuntime();
  await waitForIKBake(controller);
  assert.isNull(controller.getSnapshot().plan);
  controller.dispose();
});

test('overlapping active constraints and unsupported scales display real sampler validation', async () => {
  const fixture = ikBakeEditor();
  const rig = new Rig({
    root: fixture.rig.root,
    bones: fixture.rig.bones,
    ik: [...fixture.rig.ik!, { ...fixture.rig.ik![0]!, name: 'competing' }],
  });
  const state = new AnimationEditorState(rig, [fixture.source]);
  state.selectAnimation('reach');
  fixture.controller.bind(state);
  fixture.controller.setConstraint('arm', true);
  await waitForIKBake(fixture.controller);
  assert.isNull(fixture.controller.getSnapshot().plan);
  assert.include(fixture.controller.getSnapshot().issues[0]!.message, 'Shared driven bones');
  const invalid = new AnimationEditorState(fixture.rig, [
    {
      ...fixture.source,
      tracks: { upper: [{ time: 0, scaleX: 2, scaleY: 1 }] },
    },
  ]);
  invalid.selectAnimation('reach');
  fixture.controller.bind(invalid);
  fixture.controller.setConstraint('arm', true);
  await waitForIKBake(fixture.controller);
  assert.isNull(fixture.controller.getSnapshot().plan);
  assert.include(fixture.controller.getSnapshot().issues[0]!.message, 'unsupported-scale');
  fixture.controller.dispose();
});
