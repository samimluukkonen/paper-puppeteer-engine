import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { getEvaluatedAnimationPose } from '../src/devtools/animation-editor/animationValues.js';
import {
  getGhostSampleTimes,
  sampleGhostPose,
  sampleGhostPoses,
} from '../src/devtools/animation-editor/ghostPoseSampling.js';
import { type AnimationClip, type AnimationPlaybackMode, compileClip } from '../src/engine/AnimationClip.js';
import { AnimationPlayer, type FiredAnimationEvent } from '../src/engine/AnimationPlayer.js';
import { ClipPoseBuffer } from '../src/engine/AnimationPose.js';
import { Joint } from '../src/engine/Joint.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { createTransform } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const rig = new Rig({
  root: 'root',
  bones: [
    { id: 'root', x: 30, y: 40, scaleX: 2, length: 10 },
    { id: 'upper', parent: 'root', y: 99, rotation: 0.2 },
    { id: 'lower', parent: 'upper', y: 60, scaleY: 1.2 },
    { id: 'hand', parent: 'lower', y: 50 },
  ],
});

function clip(playback?: AnimationPlaybackMode): AnimationClip {
  return {
    name: 'ghost',
    duration: 1050,
    loop: true,
    interpolation: 'linear',
    ...(playback ? { playback } : {}),
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 1050, x: 105 },
      ],
      upper: [
        { time: 0, rotation: (179 * Math.PI) / 180 },
        { time: 1050, rotation: (-179 * Math.PI) / 180 },
      ],
      lower: [
        { time: 200, x: 7 },
        { time: 800, x: 13 },
      ],
      hand: [],
    },
    events: [
      { time: 0, name: 'start', data: { nested: [1] } },
      { time: 400, name: 'before' },
      { time: 600, name: 'after' },
      { time: 1050, name: 'end' },
    ],
  };
}

test('default neighbors use one 10 FPS frame and preserve continuous off-frame time', () => {
  assert.deepEqual(getGhostSampleTimes(0.5, 1), [
    { time: 0.4, direction: 'previous' },
    { time: 0.6, direction: 'next' },
  ]);
  const times = getGhostSampleTimes(0.537, 1);
  assert.approximately(times[0]!.time, 0.437, 1e-15);
  assert.approximately(times[1]!.time, 0.637, 1e-15);
});

test.each([8, 12, 23.976, 300])(
  'spacing supports valid authored FPS %s, including fractional/runtime-only rates',
  (fps) => {
    const times = getGhostSampleTimes(0.5, 1, { fps });
    assert.approximately(times[0]!.time, 0.5 - 1 / fps, 1e-15);
    assert.approximately(times[1]!.time, 0.5 + 1 / fps, 1e-15);
  },
);

test.each([0, -10, NaN, Infinity, -Infinity])('invalid FPS %s falls back to the shared 10 FPS aesthetic', (fps) => {
  assert.deepEqual(getGhostSampleTimes(0.5, 1, { fps }), getGhostSampleTimes(0.5, 1));
});

test('frame spacing changes the distance while retaining only one pose per direction', () => {
  assert.deepEqual(getGhostSampleTimes(0.5, 1, { fps: 10, frameSpacing: 2 }), [
    { time: 0.3, direction: 'previous' },
    { time: 0.7, direction: 'next' },
  ]);
});

test.each([1, 2, 5])('multiple neighbors use %s authored frames from the continuous playhead', (frameSpacing) => {
  const currentTime = 1.037;
  const samples = getGhostSampleTimes(currentTime, 3, { fps: 10, previousCount: 3, nextCount: 2, frameSpacing });
  const previousCount = frameSpacing === 5 ? 2 : 3;
  assert.equal(samples.length, previousCount + 2);
  for (const direction of ['previous', 'next'] as const) {
    const group = samples.filter((sample) => sample.direction === direction);
    group.forEach((sample, index) => {
      assert.approximately(
        sample.time,
        currentTime + ((direction === 'previous' ? -1 : 1) * (index + 1) * frameSpacing) / 10,
        1e-14,
      );
    });
  }
});

test('zero/max counts and independent visibility are bounded to six unique sample times', () => {
  assert.deepEqual(getGhostSampleTimes(0.5, 1, { previousCount: 0, nextCount: 0 }), []);
  const all = getGhostSampleTimes(0.5, 1, { previousCount: 3, nextCount: 3 });
  assert.equal(all.length, 6);
  assert.equal(new Set(all.map((sample) => sample.time)).size, 6);
  assert.deepEqual(getGhostSampleTimes(0.5, 1, { previousCount: 3, nextCount: 0 }), all.slice(0, 3));
  assert.deepEqual(getGhostSampleTimes(0.5, 1, { previousCount: 0, nextCount: 3 }), all.slice(3));
});

test('multi-sample boundaries omit only out-of-range offsets, retaining exact endpoints once', () => {
  const settings = { previousCount: 3, nextCount: 3 };
  const start = getGhostSampleTimes(0, 1, settings);
  assert.deepEqual(
    start.map((sample) => sample.direction),
    ['next', 'next', 'next'],
  );
  const end = getGhostSampleTimes(1, 1, settings);
  assert.deepEqual(
    end.map((sample) => sample.direction),
    ['previous', 'previous', 'previous'],
  );
  const nearStart = getGhostSampleTimes(0.2, 0.4, settings);
  assert.deepEqual(
    nearStart.map((sample) => sample.time),
    [0.1, 0, 0.30000000000000004, 0.4],
  );
  assert.equal(getGhostSampleTimes(0.3, 1, { ...settings, fps: 10 }).filter((sample) => sample.time === 0).length, 1);
});

test.each([-1, 4, 1.5, NaN, Infinity, Number.MAX_VALUE])(
  'invalid ghost count %s never produces unbounded samples',
  (count) => {
    assert.deepEqual(getGhostSampleTimes(0.5, 1, { previousCount: count }), []);
    assert.deepEqual(getGhostSampleTimes(0.5, 1, { nextCount: count }), []);
  },
);

test.each([0, -1, 6, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'invalid frame spacing %s omits samples',
  (frameSpacing) => {
    assert.deepEqual(getGhostSampleTimes(0.5, 1, { frameSpacing }), []);
  },
);

test('start/end and short animations omit out-of-range neighbors without wrapping or clamping duplicates', () => {
  assert.deepEqual(getGhostSampleTimes(0, 1), [{ time: 0.1, direction: 'next' }]);
  assert.deepEqual(getGhostSampleTimes(1, 1), [{ time: 0.9, direction: 'previous' }]);
  const nearStart = getGhostSampleTimes(0.05, 1);
  assert.equal(nearStart.length, 1);
  assert.equal(nearStart[0]!.direction, 'next');
  assert.approximately(nearStart[0]!.time, 0.15, 1e-15);
  assert.deepEqual(getGhostSampleTimes(0, 0.05), []);
  assert.deepEqual(getGhostSampleTimes(0.025, 0.05), []);
  assert.deepEqual(getGhostSampleTimes(0, 0.1), [{ time: 0.1, direction: 'next' }]);
  assert.deepEqual(getGhostSampleTimes(0.1, 0.1), [{ time: 0, direction: 'previous' }]);
  assert.deepEqual(getGhostSampleTimes(0.3, 1, { frameSpacing: 3 }), [
    { time: 0, direction: 'previous' },
    { time: 0.6, direction: 'next' },
  ]);
  assert.deepEqual(getGhostSampleTimes(0.05, 1e20), [{ time: 0.05 + 0.1, direction: 'next' }]);
  assert.deepEqual(
    getGhostSampleTimes(0.3 - 1e-8, 1, { frameSpacing: 3 }).map((sample) => sample.direction),
    ['next'],
  );
});

test.each([0, -1, NaN, Infinity])('invalid/zero duration %s produces no samples', (duration) => {
  assert.deepEqual(getGhostSampleTimes(0, duration), []);
  assert.deepEqual(sampleGhostPoses({ ...clip(), duration }, rig, 0), []);
  assert.isUndefined(sampleGhostPose({ ...clip(), duration }, rig, 0));
});

test.each([-0.01, 1.1, NaN, Infinity, -Infinity])('invalid sampling time %s produces no samples', (time) => {
  assert.deepEqual(getGhostSampleTimes(time, 1), []);
  assert.deepEqual(sampleGhostPoses(clip(), rig, time), []);
  assert.isUndefined(sampleGhostPose(clip(), rig, time));
});

test('unrepresentable spacing cannot produce duplicate boundary or current-time samples', () => {
  assert.deepEqual(getGhostSampleTimes(0.5, 1, { fps: Number.MAX_VALUE }), []);
  assert.deepEqual(getGhostSampleTimes(0.5, 1, { fps: Number.MIN_VALUE }), []);
});

test('missing animations and rigs produce no poses', () => {
  assert.deepEqual(sampleGhostPoses(null, rig, 0.5), []);
  assert.deepEqual(sampleGhostPoses(clip(), undefined, 0.5), []);
  assert.isUndefined(sampleGhostPose(null, rig, 0.5));
  assert.isUndefined(sampleGhostPose(clip(), undefined, 0.5));
  assert.deepEqual(new AnimationEditorState().sampleGhostPoses(), []);
});

test.each<AnimationPlaybackMode | undefined>([undefined, { mode: 'smooth' }, { mode: 'stepped', fps: 10 }])(
  'complete local ghost poses match runtime evaluation for playback %j, including hierarchy, partial tracks and endpoints',
  (playback) => {
    const input = clip(playback);
    const before = structuredClone(input);
    const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
    const runtime = new AnimationPlayer(rig, joints, [compileClip({ ...input, loop: false }, rig)]);
    runtime.play(input.name);
    runtime.pause();
    for (const time of [0, 0.175, 0.525, 0.999, 1.05, 0.2]) {
      for (const joint of joints.values()) joint.reset();
      runtime.sample(time * 1000, { mode: 'playback' });
      const pose = sampleGhostPose(input, rig, time)!;
      assert.equal(pose.size, rig.bones.length);
      for (const [id, joint] of joints) assert.deepEqual(pose.get(id), joint.pose);
      assert.equal(pose.get('upper')!.y, 10, 'resolved rig lengths remain local bind-pose values');
      assert.deepEqual(pose.get('hand'), createTransform(rig.getBone('hand')));
    }
    assert.equal(sampleGhostPose(input, rig, 1.05)!.get('root')!.x, 105, 'off-frame end remains exact');
    assert.approximately(sampleGhostPose(input, rig, 0.525)!.get('upper')!.rotation!, Math.PI, 0.001);
    assert.deepEqual(input, before);
    assert.isFalse(Object.isFrozen(input));
    runtime.dispose();
  },
);

test('authored FPS drives neighbors; preview rate changes sampling but does not retime the editor clock', () => {
  const state = new AnimationEditorState(rig, [clip({ mode: 'stepped', fps: 20 })]);
  state.selectAnimation('ghost');
  state.setCurrentTime(0.537);
  const samples = state.sampleGhostPoses();
  assert.approximately(samples[0]!.time, 0.487, 1e-15);
  assert.approximately(samples[1]!.time, 0.587, 1e-15);
  assert.equal(samples[0]!.pose.get('root')!.x, 45);
  assert.approximately(samples[1]!.pose.get('root')!.x!, 55, 1e-12);
  assert.equal(state.currentTime, 0.537);
  assert.isFalse(state.dirty);
  assert.equal(state.historyLength, 0);
  assert.approximately(state.sampleGhostPoses({ fps: 10 })[0]!.time, 0.437, 1e-15);
  state.playback.setAuthoredPlaybackMode('smooth');
  assert.approximately(state.sampleGhostPoses()[0]!.pose.get('root')!.x!, 43.7, 1e-12);
});

test('sampling returns detached deterministic snapshots and observes mutable inputs afresh', () => {
  const input = clip();
  const first = sampleGhostPoses(input, rig, 0.5);
  const before = structuredClone(first);
  const second = sampleGhostPoses(input, rig, 0.5);
  assert.deepEqual(first, second);
  second[0]!.pose.get('root')!.x = 999;
  second[1]!.pose.clear();
  assert.deepEqual(first, before);
  assert.deepEqual(sampleGhostPoses(input, rig, 0.5), before);
  input.tracks = { root: [{ time: 0, x: 77 }] };
  assert.equal(sampleGhostPose(input, rig, 0.5)!.get('root')!.x, 77);
  assert.throws(() => getEvaluatedAnimationPose(input, rig, NaN), /finite/);
  assert.throws(() => getEvaluatedAnimationPose(input, rig, -1), /within/);
});

test('bounded sampling cache reuses six held stepped frames without sharing mutable output or stale edits', () => {
  const state = new AnimationEditorState(rig, [clip({ mode: 'stepped', fps: 10 })]);
  state.selectAnimation('ghost');
  state.setCurrentTime(0.501);
  const evaluate = vi.spyOn(ClipPoseBuffer.prototype, 'evaluate');
  try {
    const settings = { previousCount: 3, nextCount: 3 };
    const first = state.sampleGhostPoses(settings);
    assert.equal(evaluate.mock.calls.length, 6);
    for (const time of [0.51, 0.52, 0.53, 0.501]) {
      state.setCurrentTime(time);
      const next = state.sampleGhostPoses(settings);
      assert.deepEqual(
        next.map((sample) => sample.pose),
        first.map((sample) => sample.pose),
      );
    }
    assert.equal(evaluate.mock.calls.length, 6, 'continuous scrubs within held frames reuse runtime evaluation');
    first[0]!.pose.get('root')!.x = 999;
    first[1]!.pose.clear();
    assert.equal(state.sampleGhostPoses(settings)[0]!.pose.get('root')!.x, 40);
    assert.equal(state.sampleGhostPoses(settings)[1]!.pose.size, rig.bones.length);

    // Fill beyond the eight-time LRU, then request an evicted time.
    for (let index = 0; index <= 10; ++index) state.sampleGhostPose(index / 10);
    const count = evaluate.mock.calls.length;
    state.sampleGhostPose(0);
    assert.equal(evaluate.mock.calls.length, count + 1);
    state.sampleGhostPose(0);
    assert.equal(evaluate.mock.calls.length, count + 1);

    assert.isTrue(state.keyframes.setBonePropertyKeyframe('root', 'x', 222, 0.4));
    assert.equal(state.sampleGhostPose(0.4)!.get('root')!.x, 222);
    state.undo();
    assert.equal(state.sampleGhostPose(0.4)!.get('root')!.x, 40);
    state.redo();
    assert.equal(state.sampleGhostPose(0.4)!.get('root')!.x, 222);
    const otherRig = new Rig({ root: 'root', bones: [{ id: 'root', y: 987 }, ...rig.bones.slice(1)] });
    assert.equal(sampleGhostPose(state.workingAnimation, otherRig, 0.4)!.get('root')!.y, 987);
  } finally {
    evaluate.mockRestore();
  }
});

test.each([{}, { root: [{ time: 0, x: 77 }] }])(
  'empty and single-key clips retain complete finite bind fallback',
  (tracks) => {
    const input = { ...clip(), tracks };
    for (const sample of sampleGhostPoses(input, rig, 0.5, { previousCount: 3, nextCount: 3 })) {
      assert.equal(sample.pose.size, rig.bones.length);
      assert.deepEqual(sample.pose.get('hand'), createTransform(rig.getBone('hand')));
      assert.equal(sample.pose.get('root')!.x, tracks.root ? 77 : 30);
      for (const values of sample.pose.values()) assert.isTrue(Object.values(values).every(Number.isFinite));
    }
  },
);

test.each(['paused', 'playing', 'scrubbing'] as const)(
  'sampling working snapshots preserves %s state, events, drafts, dirty state, undo/redo and all preview/IK poses',
  (mode) => {
    const input = clip({ mode: 'stepped', fps: 10 });
    const original = structuredClone(input);
    const state = new AnimationEditorState(rig, [input]);
    state.selectAnimation('ghost');
    state.keyframes.setBonePropertyKeyframe('root', 'y', 88, 0);
    state.keyframes.setBonePropertyKeyframe('root', 'scaleY', 3, 0);
    state.undo();
    state.selectBone('upper');
    state.setTemporaryBoneProperty('rotation', 0.6);
    state.playback.setPreviewLoop(true);
    state.playback.setPlaybackSpeed(2);
    state.setCurrentTime(0.5);
    if (mode !== 'paused') state.playback.play();
    if (mode === 'scrubbing') state.playback.beginScrub();
    if (mode !== 'playing') state.setTemporaryBoneProperty('rotation', 0.6);
    const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
    const constraint = puppet.addIK({ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', mix: 1 });
    const target = vi.fn(() => ({ x: 70, y: 80 }));
    constraint.setTargetProvider(target);
    const preview = new AnimationEditorPreview(state, puppet);
    const snapshot = () => ({
      currentTime: state.currentTime,
      playing: state.playback.isPlaying,
      scrubbing: state.playback.isScrubbing,
      dirty: state.dirty,
      history: state.historyLength,
      undo: state.canUndo,
      redo: state.canRedo,
      loop: state.playback.previewLoop,
      speed: state.playback.playbackSpeed,
      selectedBone: state.selectedBoneId,
      draft: state.boneTransformDraft,
      issues: state.validationIssues,
      pose: rig.bones.map((bone) => ({ ...puppet.getBone(bone.id).pose })),
      ikStatus: constraint.status,
    });
    const held = snapshot();
    const working = state.workingAnimation;
    const source = state.sourceAnimation;
    const workingJson = JSON.stringify(working);
    const sourceJson = JSON.stringify(source);
    const notify = vi.fn();
    const events = vi.fn<(event: FiredAnimationEvent) => void>();
    const sync = vi.spyOn(puppet.posePipeline, 'syncPose');
    const prepare = vi.spyOn(puppet.posePipeline, 'preparePose');
    target.mockClear();
    const release = state.subscribe(notify);
    const releaseEvents = state.playback.onAnimationEvent(events);
    try {
      const settings = { previousCount: 3, nextCount: 3, frameSpacing: 1 };
      const expected = state.sampleGhostPoses(settings);
      assert.equal(expected.length, 6);
      assert.equal(expected[0]!.pose.get('root')!.y, 88, 'the edited working copy is sampled');
      assert.equal(source!.tracks.root![0]!.y, undefined);
      for (let repeat = 0; repeat < 5; repeat++) {
        assert.deepEqual(state.sampleGhostPoses(settings), expected);
        for (const time of [0, 0.4, 0.6, 1.05]) state.sampleGhostPose(time);
      }
      assert.deepEqual(snapshot(), held);
      assert.strictEqual(state.workingAnimation, working);
      assert.strictEqual(state.sourceAnimation, source);
      assert.equal(JSON.stringify(working), workingJson);
      assert.equal(JSON.stringify(source), sourceJson);
      assert.deepEqual(input, original);
      assert.equal(notify.mock.calls.length, 0);
      assert.equal(events.mock.calls.length, 0);
      assert.equal(sync.mock.calls.length, 0);
      assert.equal(prepare.mock.calls.length, 0);
      assert.equal(target.mock.calls.length, 0);
      assert.notEqual(
        expected[0]!.pose.get('upper')!.rotation,
        held.pose[1]!.rotation,
        'ghosts exclude the draft and active IK correction',
      );
      expected[0]!.pose.get('root')!.y = 999;
      assert.equal(state.sampleGhostPoses()[0]!.pose.get('root')!.y, 88);
      state.playback.pause();
      state.playback.endScrub();
      state.playback.restart();
      state.playback.play();
      state.playback.advancePlayback(0.35);
      assert.equal(
        events.mock.calls.filter(([event]) => event.name === 'start').length,
        1,
        'sampling leaves time-zero event intent untouched',
      );
      assert.isTrue(
        events.mock.calls.some(([event]) => event.name === 'after'),
        'normal event delivery remains active',
      );
    } finally {
      release();
      releaseEvents();
      sync.mockRestore();
      prepare.mockRestore();
      preview.dispose();
      puppet.destroy();
    }
  },
);
