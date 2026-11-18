import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import * as animationClip from '../src/engine/AnimationClip.js';
import type { AnimationClip, AnimationPlaybackMode } from '../src/engine/AnimationClip.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { transformProperties } from '../src/engine/types.js';
import { demoAnimations, demoRig } from './helpers/demoCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

test.each<AnimationPlaybackMode>([{ mode: 'smooth' }, { mode: 'stepped', fps: 10 }])(
  '$mode interpolation edits, FPS changes and playback controls immediately sample the authored pose before IK/facing',
  (playback) => {
    const rig = new Rig({
      root: 'root',
      bones: [
        { id: 'root' },
        { id: 'upper', parent: 'root', y: 10 },
        { id: 'lower', parent: 'upper', y: 60 },
        { id: 'hand', parent: 'lower', y: 50 },
      ],
    });
    const input: AnimationClip = {
      name: 'hardening',
      duration: 1050,
      loop: true,
      playback,
      tracks: {
        upper: [
          { time: 0, rotation: 0.1 },
          { time: 1050, rotation: 0.9 },
        ],
      },
    };
    const before = JSON.stringify(input);
    const state = new AnimationEditorState(rig, [input]);
    state.selectAnimation(input.name);
    const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
    const constraint = puppet.addIK({ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', mix: 0.5 });
    let evaluations = 0;
    constraint.setTargetProvider(() => {
      evaluations++;
      assert.approximately(
        puppet.getBone('upper').pose.rotation,
        state.getEvaluatedBonePropertyValue('upper', 'rotation')!,
        1e-12,
        'the IK provider observes the freshly sampled authored pose',
      );
      return { x: puppet.facingDirection === 'left' ? -60 : 60, y: 70 };
    });
    const preview = new AnimationEditorPreview(state, puppet);
    const authoredAt = (time: number) => {
      const frame = state.workingAnimation!.playback;
      // Compare nominal frame boundaries independently of accumulated editor-clock roundoff.
      const nominalTime = Math.round(time * 1e12) / 1e12;
      const sampled = frame?.mode === 'stepped' && time < 1.05 ? Math.floor(nominalTime * frame.fps) / frame.fps : time;
      return 0.1 + (0.8 * sampled) / 1.05;
    };
    const check = () => {
      assert.approximately(
        state.getEvaluatedBonePropertyValue('upper', 'rotation')!,
        authoredAt(state.currentTime),
        1e-12,
      );
      assert.equal(constraint.status, 'solved');
    };
    try {
      state.setCurrentTime(0.375);
      const held = evaluations;
      state.setAuthoredInterpolation('linear');
      assert.equal(evaluations, held + 1);
      check();
      for (const time of [0.376, 0.5, 1.05]) {
        state.setCurrentTime(time);
        check();
      }
      state.undo();
      check();
      state.redo();
      check();
      state.setAuthoredPlaybackMode('stepped');
      state.setAuthoredFPS(20);
      state.setCurrentTime(0.375);
      check();
      assert.equal(state.workingAnimation!.interpolation, 'linear');
      state.setPreviewLoop(true);
      state.setPlaybackSpeed(2);
      state.restart();
      state.play();
      state.advancePlayback(0.7);
      assert.approximately(state.currentTime, 0.35, 1e-12);
      check();
      state.pause();
      const paused = state.currentTime;
      state.advancePlayback(100);
      assert.equal(state.currentTime, paused);
      state.setPlaybackSpeed(0.5);
      state.play();
      state.advancePlayback(0.5);
      check();
      state.restart();
      check();
      assert.isTrue(state.isPlaying);
      state.beginScrub();
      state.setCurrentTime(0.875);
      check();
      state.advancePlayback(100);
      assert.equal(state.currentTime, 0.875);
      state.endScrub();
      state.advancePlayback(0.2);
      check();
      const working = state.workingAnimation;
      const history = state.historyLength;
      for (const facing of ['left', 'right', 'left', 'right'] as const) {
        puppet.setFacing(facing);
        puppet.posePipeline.syncPose();
        check();
        assert.strictEqual(state.workingAnimation, working);
        assert.equal(state.historyLength, history);
      }
      constraint.enabled = false;
      puppet.posePipeline.syncPose();
      assert.approximately(puppet.getBone('upper').pose.rotation, authoredAt(state.currentTime), 1e-12);
      assert.equal(JSON.stringify(input), before);
      assert.deepEqual(state.sourceAnimation!.tracks, input.tracks);
      assert.isUndefined(state.sourceAnimation!.interpolation);
    } finally {
      preview.dispose();
      puppet.destroy();
    }
  },
);

test.each<AnimationPlaybackMode>([{ mode: 'smooth' }, { mode: 'stepped', fps: 1 }])(
  'clip interpolation declaration edits immediately resample the existing $mode preview and preserve playback semantics',
  (playback) => {
    const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
    const input: AnimationClip = {
      name: 'rotate',
      duration: 1000,
      loop: false,
      playback,
      tracks: {
        root: [
          { time: 0, rotation: 0 },
          { time: 1000, rotation: 1 },
        ],
      },
    };
    const state = new AnimationEditorState(rig, [input]);
    state.selectAnimation('rotate');
    state.selectKeyframe({ boneId: 'root', property: 'rotation', time: 0 });
    const source = JSON.stringify(input);
    const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
    const preview = new AnimationEditorPreview(state, puppet);
    const sync = vi.spyOn(puppet.posePipeline, 'syncPose');
    const expected = (time: number) => (playback.mode === 'stepped' && time < 1 ? 0 : time);
    try {
      for (const time of [0, 0.25, 0.5, 0.75, 1]) {
        state.setCurrentTime(time);
        assert.approximately(puppet.getBone('root').pose.rotation, expected(time), 1e-12);
      }
      state.setCurrentTime(0.375);
      const selection = state.selectedKeys;
      sync.mockClear();
      assert.isTrue(state.setAuthoredInterpolation('linear'));
      assert.equal(sync.mock.calls.length, 1, 'a changed working snapshot refreshes immediately at the held time');
      assert.approximately(puppet.getBone('root').pose.rotation, expected(0.375), 1e-12);
      state.undo();
      assert.equal(sync.mock.calls.length, 2);
      state.redo();
      assert.equal(sync.mock.calls.length, 3);
      assert.equal(state.currentTime, 0.375);
      assert.strictEqual(state.selectedKeys, selection);
      state.setCurrentTime(0);
      state.play();
      state.advancePlayback(0.375);
      assert.equal(state.currentTime, 0.375);
      assert.approximately(puppet.getBone('root').pose.rotation, expected(0.375), 1e-12);
      assert.equal(JSON.stringify(input), source);
    } finally {
      preview.dispose();
      puppet.destroy();
    }
  },
);

test.each(['smooth', 'stepped'] as const)(
  'key movement refreshes %s preview/evaluator without baking facing',
  (mode) => {
    const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
    const input: AnimationClip = {
      name: 'move',
      duration: 1000,
      loop: true,
      playback: mode === 'stepped' ? { mode, fps: 10 } : { mode },
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 500, x: 40 },
          { time: 1000, x: 20 },
        ],
      },
    };
    const state = new AnimationEditorState(rig, [input]);
    state.selectAnimation('move');
    const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false, facing: 'left' });
    const preview = new AnimationEditorPreview(state, puppet);
    const before = JSON.stringify(input);
    try {
      state.keyframes.beginKeyframeDrag({ boneId: 'root', property: 'x', time: 0.5 });
      state.keyframes.previewKeyframeDrag(0.8);
      assert.equal(puppet.getBone('root').pose.x, 28, 'provisional seek evaluates unchanged authored keys');
      state.keyframes.commitKeyframeDrag();
      assert.equal(puppet.getBone('root').pose.x, 40);
      assert.equal(state.selectedBoneTransform?.x, 40);
      state.undo();
      assert.equal(puppet.getBone('root').pose.x, 28);
      state.redo();
      assert.equal(puppet.getBone('root').pose.x, 40);
      state.setPreviewLoop(true);
      state.setPlaybackSpeed(2);
      state.play();
      state.advancePlayback(0.3);
      assert.approximately(state.currentTime, 0.4, 1e-12);
      assert.approximately(puppet.getBone('root').pose.x, 20, 1e-12);
      assert.equal(JSON.stringify(input), before);
      assert.deepEqual(state.workingAnimation?.tracks.root, [
        { time: 0, x: 0 },
        { time: 800, x: 40 },
        { time: 1000, x: 20 },
      ]);
    } finally {
      preview.dispose();
      puppet.destroy();
    }
  },
);

test('canvas and inspector share compilation while independently evaluating time and edits', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const state = new AnimationEditorState(rig, [
    {
      name: 'move',
      duration: 1000,
      loop: true,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1000, x: 100 },
        ],
      },
      events: [{ time: 0, name: 'start' }],
    },
  ]);
  state.selectAnimation('move');
  state.selectBone('root');
  const compile = vi.spyOn(animationClip, 'compileValidatedClip');
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  try {
    assert.equal(state.getEvaluatedBonePropertyValue('root', 'x', 0.5), 50);
    assert.equal(puppet.getBone('root').pose.x, 0, 'inspector queries do not overwrite the canvas pose');
    state.setCurrentTime(0.25);
    assert.equal(puppet.getBone('root').pose.x, 25);
    assert.equal(state.getEvaluatedBonePropertyValue('root', 'x', 0.5), 50);
    assert.equal(compile.mock.calls.length, 1);
    state.keyframes.setBonePropertyKeyframe('root', 'x', 30);
    assert.equal(state.selectedBoneTransform?.x, 30);
    assert.equal(puppet.getBone('root').pose.x, 30);
    assert.equal(compile.mock.calls.length, 2, 'new authored snapshots compile once for both consumers');
    state.undo();
    assert.equal(state.selectedBoneTransform?.x, 25);
    assert.equal(puppet.getBone('root').pose.x, 25);
    assert.equal(compile.mock.calls.length, 2, 'undo reuses the immutable earlier compilation');
  } finally {
    compile.mockRestore();
    preview.dispose();
    puppet.destroy();
  }
});

test('key selection and selected-key deletion update the existing preview, including undo/redo after scrubbing', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const state = new AnimationEditorState(rig, [
    {
      name: 'move',
      duration: 2000,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 500, x: 40 },
          { time: 2000, x: 20 },
        ],
      },
    },
  ]);
  state.selectAnimation('move');
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  state.play();
  state.selectKeyframe({ boneId: 'root', property: 'x', time: 0.5 });
  assert.equal(puppet.getBone('root').pose.x, 40);
  assert.isFalse(state.isPlaying);
  assert.isFalse(state.dirty);
  state.setCurrentTime(1);
  assert.approximately(puppet.getBone('root').pose.x, 100 / 3, 1e-10);
  state.deleteSelectedKeyframe();
  assert.equal(puppet.getBone('root').pose.x, 10);
  assert.equal(state.currentTime, 1);
  state.undo();
  assert.approximately(puppet.getBone('root').pose.x, 100 / 3, 1e-10);
  state.redo();
  assert.equal(puppet.getBone('root').pose.x, 10);
  preview.dispose();
  puppet.destroy();
});

test('held stepped frames skip projection while drafts, authored edits and endpoints invalidate it', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const state = new AnimationEditorState(rig, [
    {
      name: 'move',
      duration: 1050,
      loop: true,
      playback: { mode: 'stepped', fps: 10 },
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1050, x: 105 },
        ],
      },
    },
  ]);
  state.selectAnimation('move');
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  const sync = vi.spyOn(puppet.posePipeline, 'syncPose');
  state.play();
  for (let frame = 0; frame < 60; frame++) state.advancePlayback(1 / 120);
  assert.approximately(state.currentTime, 0.5, 1e-12);
  assert.equal(sync.mock.calls.length, 5, 'only the five new playback frames synchronize');
  state.pause();
  state.selectBone('root');
  state.setCurrentTime(0.501);
  assert.equal(sync.mock.calls.length, 5);
  state.setTemporaryBoneProperty('x', 77);
  assert.equal(puppet.getBone('root').pose.x, 77);
  state.cancelTransformEdit();
  assert.equal(puppet.getBone('root').pose.x, 50);
  state.keyframes.setBonePropertyKeyframe('root', 'y', 12);
  assert.equal(puppet.getBone('root').pose.y, 12);
  state.setCurrentTime(1.049);
  assert.equal(puppet.getBone('root').pose.x, 100);
  state.setCurrentTime(1.05);
  assert.equal(puppet.getBone('root').pose.x, 105, 'the exact endpoint bypasses quantization');
  state.setCurrentTime(1.04);
  assert.equal(puppet.getBone('root').pose.x, 100);
  sync.mockRestore();
  preview.dispose();
  puppet.destroy();
});

test.each<AnimationPlaybackMode>([{ mode: 'smooth' }, { mode: 'stepped', fps: 10 }])(
  'authored keyframe edits and undo/redo immediately refresh $mode preview without advancing the clock',
  (playback) => {
    const rig = new Rig({ root: 'root', bones: [{ id: 'root', x: 4 }] });
    const clip: AnimationClip = {
      name: 'move',
      duration: 1050,
      loop: true,
      playback,
      tracks: {},
      events: [
        { time: 0, name: 'start' },
        { time: 500, name: 'middle' },
      ],
    };
    const state = new AnimationEditorState(rig, [clip]);
    state.selectAnimation('move');
    state.setCurrentTime(0.5);
    const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
    const preview = new AnimationEditorPreview(state, puppet);
    const assertValue = (value: number) => {
      assert.equal(puppet.getBone('root').pose.x, value);
      assert.equal(puppet.getBone('root').container.x, value);
      assert.equal(state.getEvaluatedBonePropertyValue('root', 'x'), value);
      assert.equal(state.currentTime, 0.5);
    };
    assertValue(4);
    state.keyframes.setBonePropertyKeyframe('root', 'x', 10);
    assertValue(10);
    assert.isFalse(state.isPlaying);
    state.keyframes.setBonePropertyKeyframe('root', 'x', 20);
    assertValue(20);
    state.keyframes.removeBonePropertyKeyframe('root', 'x');
    assertValue(4);
    state.undo();
    assertValue(20);
    state.redo();
    assertValue(4);

    // Active edits remain safe and keep the existing playback intent and clock.
    state.play();
    state.keyframes.setBonePropertyKeyframe('root', 'x', 30);
    assertValue(30);
    assert.isTrue(state.isPlaying);
    state.advancePlayback(0.1);
    assert.approximately(state.currentTime, 0.6, 1e-12);
    assert.equal(puppet.getBone('root').pose.x, 30);
    assert.deepEqual(state.sourceAnimation!.tracks, {});
    preview.dispose();
    puppet.destroy();
  },
);

test.each<AnimationPlaybackMode>([{ mode: 'smooth' }, { mode: 'stepped', fps: 10 }])(
  'preview matches runtime sampling for $mode and keeps precise timeline time',
  (playback) => {
    const rig = new Rig({ root: 'root', bones: [{ id: 'root', x: 4 }] });
    const clip: AnimationClip = {
      name: 'move',
      duration: 1000,
      loop: false,
      playback,
      tracks: {
        root: [
          { time: 0, x: 0, rotation: 3.1 },
          { time: 1000, x: 100, rotation: -3.1 },
        ],
      },
      events: [{ time: 500, name: 'middle' }],
    };
    const state = new AnimationEditorState(rig, [clip]);
    state.selectAnimation('move');
    const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
    const runtime = new Puppet(puppetScene(), { rig, animations: [clip], autoUpdate: false });
    runtime.play('move').pauseAnimation();
    const preview = new AnimationEditorPreview(state, puppet);
    const notification = vi.fn();
    runtime.onAnimationEvent(notification);
    for (const time of [0, 0.742123, 0.2, 1, 0.125]) {
      state.setCurrentTime(time);
      runtime.sampleAnimation(time * 1000, { mode: 'playback' });
      assert.equal(state.currentTime, time);
      assert.deepEqual(puppet.getBone('root').pose, runtime.getBone('root').pose);
      assert.equal(puppet.getBone('root').container.x, runtime.getBone('root').container.x);
    }
    assert.equal(notification.mock.calls.length, 0);
    assert.isFalse(state.dirty);
    preview.dispose();
    const held = puppet.getBone('root').pose.x;
    state.setCurrentTime(0.9);
    assert.equal(puppet.getBone('root').pose.x, held);
    runtime.destroy();
    puppet.destroy();
  },
);

test('sample idle, walk and sparse tracks match runtime, selection clears previously controlled properties', () => {
  const state = new AnimationEditorState(demoRig, demoAnimations);
  const puppet = new Puppet(puppetScene(), { rig: demoRig, autoUpdate: false });
  const runtime = new Puppet(puppetScene(), { rig: demoRig, animations: demoAnimations, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  for (const name of ['walk', 'idle', 'guardUpperBody']) {
    state.selectAnimation(name);
    runtime.resetToBindPose().play(name).pauseAnimation();
    for (const fraction of [0, 0.5, 0.999, 1]) {
      const time = state.duration * fraction;
      state.setCurrentTime(time);
      runtime.sampleAnimation(time * 1000, { mode: 'playback' });
      for (const bone of demoRig.bones)
        for (const property of transformProperties)
          assert.approximately(puppet.getBone(bone.id).pose[property], runtime.getBone(bone.id).pose[property], 1e-12);
    }
  }
  state.selectAnimation(null);
  for (const bone of demoRig.bones) assert.deepEqual(puppet.getBone(bone.id).pose, puppet.getBone(bone.id).bindPose);
  preview.dispose();
  puppet.destroy();
  runtime.destroy();
});

test.each(['sword', 'guardUpperBody'])('%s previews a complete two-handed grip without IK', (name) => {
  const state = new AnimationEditorState(demoRig, demoAnimations);
  const puppet = new Puppet(puppetScene(), { rig: demoRig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  // Select after walking to exercise reset of the previous pose as well as nonsequential scrubbing.
  state.selectAnimation('walk');
  state.setCurrentTime(0.75);
  state.selectAnimation(name);
  const swordAngle = -0.65;
  const gripSpacing = 26; // Palm spacing authored into the sample clips.
  const assertGrip = () => {
    const palm = (side: 'left' | 'right') =>
      puppet.getBone(`${side}Hand`).container.getWorldTransformMatrix().transformPoint(0, 15);
    const primary = palm('right');
    const secondary = palm('left');
    // Baked Phaser transforms and the runtime solver use floating-point tolerances.
    assert.approximately(secondary.x, primary.x - gripSpacing * Math.cos(swordAngle), 1e-3);
    assert.approximately(secondary.y, primary.y - gripSpacing * Math.sin(swordAngle), 1e-3);
    const torso = puppet.getBone('torso').container.getWorldTransformMatrix();
    for (const point of [primary, secondary]) {
      const local = torso.applyInverse(point.x, point.y);
      assert.isAbove(local.x, puppet.getBone('leftUpperArm').pose.x, 'palms stay in front of the body');
      assert.isAbove(local.y, puppet.getBone('head').pose.y, 'palms stay below the head');
      assert.isBelow(local.y, 0, 'palms stay above the waist');
    }
  };
  for (const time of [0, 0.9, 0.25, 1.8]) {
    state.setCurrentTime(time);
    assertGrip();
  }
  state.restart();
  state.play();
  for (let frame = 0; frame < 108; frame += 1) {
    state.advancePlayback(1 / 60);
    assertGrip();
  }
  assert.isFalse(state.dirty);
  preview.dispose();
  puppet.destroy();
});

test('authored replacements recompile preview and invalid replacements retain its last pose', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const clip: AnimationClip = { name: 'move', duration: 1000, loop: false, tracks: { root: [{ time: 0, x: 10 }] } };
  const state = new AnimationEditorState(rig, [clip]);
  state.selectAnimation('move');
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  assert.equal(puppet.getBone('root').pose.x, 10);
  state.replaceWorkingAnimation({ ...clip, version: 1, tracks: { root: [{ time: 0, x: 20 }] } });
  assert.equal(puppet.getBone('root').pose.x, 20);
  state.replaceWorkingAnimation({ ...clip, version: 1, duration: 0 });
  assert.equal(puppet.getBone('root').pose.x, 20);
  state.undo();
  assert.equal(puppet.getBone('root').pose.x, 10);
  preview.dispose();
  puppet.destroy();
});

test('status changes skip sampling and rendering while time and authored changes update the preview', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const clip: AnimationClip = {
    name: 'move',
    duration: 1000,
    loop: false,
    tracks: { root: [{ time: 0, x: 10 }] },
  };
  const state = new AnimationEditorState(rig, [clip]);
  state.selectAnimation('move');
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  const sample = vi.spyOn(AnimationPlayer.prototype, 'sample');
  const sync = vi.spyOn(puppet.posePipeline, 'syncPose');
  try {
    state.setPreviewLoop(true);
    state.setPlaybackSpeed(0.5);
    state.play();
    state.pause();
    state.beginScrub();
    state.endScrub();
    state.markSaved();
    state.replaceWorkingAnimation({ ...clip, version: 1, duration: 0 });
    state.replaceWorkingAnimation({ ...clip, version: 1 });
    assert.equal(sample.mock.calls.length, 0);
    assert.equal(sync.mock.calls.length, 0);

    state.setCurrentTime(0.5);
    assert.equal(sample.mock.calls.length, 1);
    assert.equal(sync.mock.calls.length, 1);
    state.replaceWorkingAnimation({ ...clip, version: 1, tracks: { root: [{ time: 0, x: 20 }] } });
    assert.equal(sample.mock.calls.length, 2);
    assert.equal(puppet.getBone('root').container.x, 20);
    state.undo();
    assert.equal(puppet.getBone('root').container.x, 10);
    state.selectAnimation(null);
    assert.equal(puppet.getBone('root').container.x, 0);
    const calls = sync.mock.calls.length;
    state.setPreviewLoop(false);
    state.markSaved();
    assert.equal(sync.mock.calls.length, calls);
  } finally {
    sample.mockRestore();
    sync.mockRestore();
    preview.dispose();
    puppet.destroy();
  }
});

test.each<AnimationPlaybackMode>([{ mode: 'smooth' }, { mode: 'stepped', fps: 10 }])(
  'playback uses the evaluator for $mode and holds the exact final pose of an authored looping clip',
  (playback) => {
    const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
    const clip: AnimationClip = {
      name: 'move',
      duration: 1050,
      loop: true,
      playback,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1050, x: 105 },
        ],
      },
    };
    const state = new AnimationEditorState(rig, [clip]);
    state.selectAnimation('move');
    const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
    const preview = new AnimationEditorPreview(state, puppet);
    state.play();
    state.advancePlayback(0.25);
    assert.approximately(puppet.getBone('root').pose.x, playback.mode === 'stepped' ? 20 : 25, 1e-12);
    state.pause();
    const held = puppet.getBone('root').pose.x;
    state.advancePlayback(1);
    assert.equal(puppet.getBone('root').pose.x, held);
    state.restart();
    assert.equal(puppet.getBone('root').pose.x, 0);
    state.play();
    state.advancePlayback(2);
    assert.equal(state.currentTime, 1.05);
    assert.equal(puppet.getBone('root').pose.x, 105);
    assert.equal(puppet.getBone('root').container.x, 105);
    state.advancePlayback(2);
    assert.equal(puppet.getBone('root').pose.x, 105);
    state.play();
    assert.equal(puppet.getBone('root').pose.x, 0);
    state.advancePlayback(0.25);
    state.restart();
    assert.isTrue(state.isPlaying);
    assert.equal(puppet.getBone('root').pose.x, 0);
    assert.isTrue(clip.loop);
    assert.isTrue(state.workingAnimation!.loop);
    assert.isFalse(state.dirty);
    preview.dispose();
    puppet.destroy();
  },
);

test.each([false, true])('authored FPS/mode immediately resample the held time with playing=%s', (playing) => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const clip: AnimationClip = {
    name: 'move',
    duration: 1000,
    loop: false,
    playback: { mode: 'stepped', fps: 10 },
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 1000, x: 100 },
      ],
    },
  };
  const before = JSON.stringify(clip);
  const state = new AnimationEditorState(rig, [clip]);
  state.selectAnimation('move');
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  state.setCurrentTime(0.25712345);
  if (playing) state.play();
  assert.equal(puppet.getBone('root').pose.x, 20);
  state.setAuthoredFPS(20);
  assert.equal(puppet.getBone('root').pose.x, 25);
  assert.equal(puppet.getBone('root').container.x, 25);
  assert.equal(state.currentTime, 0.25712345);
  assert.equal(state.isPlaying, playing);
  assert.isTrue(state.dirty);
  assert.equal(JSON.stringify(clip), before);
  state.setAuthoredPlaybackMode('smooth');
  assert.approximately(puppet.getBone('root').pose.x, 25.712345, 1e-12);
  state.setCurrentTime(0.26712345);
  assert.approximately(puppet.getBone('root').pose.x, 26.712345, 1e-12);
  state.undo();
  assert.equal(puppet.getBone('root').pose.x, 25);
  state.undo();
  assert.equal(puppet.getBone('root').pose.x, 20);
  assert.isFalse(state.dirty);
  state.redo();
  assert.equal(puppet.getBone('root').pose.x, 25);
  const held = state.workingAnimation;
  state.setAuthoredFPS(NaN);
  assert.strictEqual(state.workingAnimation, held);
  assert.equal(puppet.getBone('root').pose.x, 25);
  preview.dispose();
  puppet.destroy();
});

test.each([0.5, 1, 2])('%s× keeps a continuous 120 Hz clock while only stepped poses hold', (speed) => {
  for (const mode of ['smooth', 'stepped'] as const) {
    const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
    const clip: AnimationClip = {
      name: 'move',
      duration: 2000,
      loop: false,
      playback: mode === 'smooth' ? { mode } : { mode, fps: 10 },
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 2000, x: 200 },
        ],
      },
    };
    const state = new AnimationEditorState(rig, [clip]);
    state.selectAnimation('move');
    const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
    const runtime = new Puppet(puppetScene(), { rig, animations: [clip], autoUpdate: false });
    runtime.play('move').pauseAnimation();
    const preview = new AnimationEditorPreview(state, puppet);
    const poses = new Set<number>();
    state.setPlaybackSpeed(speed);
    state.play();
    let previous = state.currentTime;
    for (let frame = 0; frame < 60; frame += 1) {
      state.advancePlayback(1 / 120);
      assert.isAbove(state.currentTime, previous);
      previous = state.currentTime;
      runtime.sampleAnimation(state.currentTime * 1000, { mode: 'playback' });
      assert.deepEqual(puppet.getBone('root').pose, runtime.getBone('root').pose);
      poses.add(puppet.getBone('root').pose.x);
    }
    assert.approximately(state.currentTime, 0.5 * speed, 1e-12);
    if (mode === 'smooth') assert.equal(poses.size, 60);
    else assert.isBelow(poses.size, 20);
    assert.isFalse(state.dirty);
    preview.dispose();
    runtime.destroy();
    puppet.destroy();
  }
});

test.each<AnimationPlaybackMode>([{ mode: 'smooth' }, { mode: 'stepped', fps: 10 }])(
  '$mode loop and playing scrubs evaluate poses without runtime advancement or events',
  (playback) => {
    const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
    const clip: AnimationClip = {
      name: 'move',
      duration: 2000,
      loop: false,
      playback,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 2000, x: 200 },
        ],
      },
      events: [
        { time: 0, name: 'start' },
        { time: 1000, name: 'middle' },
      ],
    };
    const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'other', tracks: {} }]);
    state.selectAnimation('move');
    const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
    const preview = new AnimationEditorPreview(state, puppet);
    const event = vi.fn<Parameters<AnimationPlayer['onAnimationEvent']>[0]>();
    const runtime = Reflect.get(preview, 'player') as import('../src/engine/AnimationPlayer.js').AnimationPlayer;
    runtime.onAnimationEvent(event);
    const update = vi.spyOn(runtime, 'update');
    state.setPreviewLoop(true);
    state.play();
    state.advancePlayback(2.5);
    assert.equal(puppet.getBone('root').pose.x, 50);
    state.beginScrub();
    for (const time of [1.5, 0.5, 2, 0]) {
      state.setCurrentTime(time);
      assert.equal(puppet.getBone('root').pose.x, time * 100);
      state.advancePlayback(50);
      assert.equal(puppet.getBone('root').pose.x, time * 100);
    }
    state.endScrub();
    state.advancePlayback(10.5);
    assert.equal(puppet.getBone('root').pose.x, 50);
    assert.equal(puppet.getBone('root').container.x, 50);
    assert.equal(event.mock.calls.length, 0);
    assert.equal(update.mock.calls.length, 0);
    assert.isFalse(state.dirty);
    state.selectAnimation('other');
    assert.isFalse(state.isPlaying);
    assert.equal(state.currentTime, 0);
    assert.equal(puppet.getBone('root').pose.x, 0);
    state.advancePlayback(1);
    assert.equal(puppet.getBone('root').pose.x, 0);
    preview.dispose();
    puppet.destroy();
  },
);

test.each([0.5, 1])('preview preserves optional IK, presets and facing through recompilation (mix=%s)', (mix) => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'upper', parent: 'root', y: 10 },
      { id: 'lower', parent: 'upper', y: 60 },
      { id: 'hand', parent: 'lower', y: 50 },
    ],
  });
  const clip: AnimationClip = {
    name: 'move',
    duration: 1000,
    loop: false,
    playback: { mode: 'smooth' },
    tracks: {
      upper: [
        { time: 0, rotation: 0.1 },
        { time: 1000, rotation: 0.9 },
      ],
    },
  };
  const before = JSON.stringify(clip);
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'sparse', tracks: {} }]);
  state.selectAnimation('move');
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const runtime = new Puppet(puppetScene(), { rig, animations: [clip], autoUpdate: false });
  const configure = (host: Puppet) => {
    host.addPose({ version: 1, name: 'preset', bones: { upper: { x: 20 } } }).applyPose('preset', { mix: 0.5 });
    const constraint = host.addIK({ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', mix });
    constraint.setTargetProvider(() => {
      // Providers run after pose processing and skeleton projection, in the mirrored world space.
      assert.equal(host.getBone('upper').container.x, 10);
      return { x: host.facingDirection === 'left' ? -60 : 60, y: 70 };
    });
    return constraint;
  };
  const constraint = configure(puppet);
  configure(runtime);
  runtime.play('move').pauseAnimation();
  const preview = new AnimationEditorPreview(state, puppet);
  for (const facing of ['right', 'left', 'right'] as const) {
    puppet.setFacing(facing);
    runtime.setFacing(facing);
    state.restart();
    state.play();
    for (const delta of [0.1, 0.2, 0.4]) {
      state.advancePlayback(delta);
      runtime.sampleAnimation(state.currentTime * 1000, { mode: 'playback' });
      assert.isTrue(constraint.enabled);
      assert.equal(constraint.status, 'solved');
      for (const bone of rig.bones) {
        assert.deepEqual(puppet.getBone(bone.id).pose, runtime.getBone(bone.id).pose);
        const actual = puppet.getBone(bone.id).container.getWorldTransformMatrix().transformPoint(0, 0);
        const expected = runtime.getBone(bone.id).container.getWorldTransformMatrix().transformPoint(0, 0);
        assert.approximately(actual.x, expected.x, 1e-9);
        assert.approximately(actual.y, expected.y, 1e-9);
      }
    }
    state.pause();
    const pose = { ...puppet.getBone('upper').pose };
    puppet.posePipeline.syncPose();
    assert.deepEqual(puppet.getBone('upper').pose, pose, 'partial IK/preset mix must not accumulate');
  }
  state.setAuthoredPlaybackMode('stepped');
  state.setAuthoredFPS(20);
  state.undo();
  state.undo();
  assert.isTrue(constraint.enabled);
  assert.equal(constraint.status, 'solved');
  state.selectAnimation('sparse');
  assert.isTrue(constraint.enabled);
  assert.equal(constraint.status, 'solved');
  assert.equal(puppet.getBone('upper').pose.x, 10, 'preset survives sparse selection');
  constraint.enabled = false;
  state.selectAnimation('move');
  assert.isFalse(constraint.enabled, 'selection preserves disabled constraints too');
  assert.equal(puppet.getBone('upper').pose.rotation, 0.1);
  state.selectAnimation(null);
  assert.isFalse(constraint.enabled);
  assert.equal(puppet.getBone('upper').pose.rotation, 0);
  assert.equal(puppet.getBone('upper').pose.x, 10);
  assert.equal(JSON.stringify(clip), before);
  assert.deepEqual(state.sourceAnimation, null);
  assert.isFalse(state.dirty);
  preview.dispose();
  puppet.destroy();
  runtime.destroy();
});

test('pose-only preview suppresses start, middle and end events across restart, loops and recompilation', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const clip: AnimationClip = {
    name: 'move',
    duration: 1000,
    loop: true,
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 1000, x: 100 },
      ],
    },
    events: [
      { time: 0, name: 'start', data: { gameplay: true } },
      { time: 500, name: 'middle' },
      { time: 1000, name: 'end' },
    ],
  };
  const before = JSON.stringify(clip);
  const state = new AnimationEditorState(rig, [clip]);
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const event = vi.fn<Parameters<AnimationPlayer['onAnimationEvent']>[0]>();
  const complete = vi.fn();
  // oxlint-disable-next-line typescript/unbound-method -- The test deliberately reuses this method with an explicit fixture receiver.
  const originalPlay = AnimationPlayer.prototype.play;
  // Attach before initialization to catch time-zero events as well as later pose sampling.
  const play = vi.spyOn(AnimationPlayer.prototype, 'play').mockImplementation(function (
    this: AnimationPlayer,
    ...args
  ) {
    this.onAnimationEvent(event);
    this.onAnimationComplete(complete);
    originalPlay.apply(this, args);
  });
  const update = vi.spyOn(AnimationPlayer.prototype, 'update');
  const preview = new AnimationEditorPreview(state, puppet);
  try {
    state.selectAnimation('move');
    for (const marker of state.events.eventTimelineTrack.markers) {
      state.play();
      state.beginScrub();
      assert.isTrue(state.events.selectAnimationEvent(marker.ref));
      assert.isFalse(state.isPlaying);
      assert.isFalse(state.isScrubbing);
      assert.equal(state.currentTime, marker.time);
      assert.equal(puppet.getBone('root').pose.x, marker.time * 100);
      assert.equal(event.mock.calls.length, 0);
    }
    state.play();
    state.advancePlayback(2);
    state.restart();
    state.setPreviewLoop(true);
    state.play();
    state.advancePlayback(100.5);
    state.beginScrub();
    for (const time of [1, 0, 0.5, 0, 1]) state.setCurrentTime(time);
    state.endScrub();
    state.restart();
    state.setAuthoredPlaybackMode('stepped');
    state.setAuthoredFPS(20);
    state.undo();
    state.redo();
    state.undo();
    state.undo();
    state.selectAnimation('move');
    state.selectAnimation(null);
    assert.equal(event.mock.calls.length, 0);
    assert.equal(complete.mock.calls.length, 0);
    assert.equal(update.mock.calls.length, 0);
    assert.isAbove(play.mock.calls.length, 4, 'exercise initialization and multiple recompilations');
    assert.equal(JSON.stringify(clip), before);
    assert.isFalse(state.dirty);
  } finally {
    play.mockRestore();
    update.mockRestore();
    preview.dispose();
    puppet.destroy();
  }
  // Runtime event dispatch remains intact for the same caller-owned clip.
  const runtime = new Puppet(puppetScene(), { rig, animations: [clip], autoUpdate: false });
  runtime.onAnimationEvent(event);
  runtime.play('move');
  runtime.update(1000);
  assert.deepEqual(
    event.mock.calls.map(([marker]) => marker.name),
    ['start', 'middle', 'start', 'end'],
  );
  runtime.destroy();
});

test.each(['right', 'left'] as const)(
  'temporary local values and keys remain pre-IK and canonical when facing %s',
  (facing) => {
    const rig = new Rig({
      root: 'root',
      bones: [
        { id: 'root', x: 100, rotation: 0.3, scaleX: 1.1 },
        { id: 'upper', parent: 'root', x: 10, y: 20, rotation: 0.2 },
        { id: 'lower', parent: 'upper', y: 60 },
        { id: 'hand', parent: 'lower', y: 50 },
      ],
    });
    const clip: AnimationClip = { name: 'move', duration: 2000, loop: false, tracks: {} };
    const state = new AnimationEditorState(rig, [clip]);
    state.selectAnimation('move');
    state.setCurrentTime(0.5);
    state.selectBone('lower');
    const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false, facing });
    const constraint = puppet.addIK({ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand' });
    constraint.setTarget({ x: facing === 'right' ? 150 : -150, y: 90 });
    const preview = new AnimationEditorPreview(state, puppet);
    const before = JSON.stringify(clip);
    const bind = { ...puppet.getBone('lower').bindPose };
    state.setTemporaryBoneProperty('rotation', 0.7);
    state.setTemporaryBoneProperty('x', 9);
    assert.equal(state.selectedBoneTransform!.rotation, 0.7);
    assert.equal(state.selectedBoneTransform!.x, 9);
    assert.notEqual(puppet.getBone('lower').pose.rotation, 0.7, 'IK corrects the rendered rotation');
    assert.equal(puppet.getBone('lower').pose.x, 9);
    assert.equal(constraint.status, 'solved');
    assert.isFalse(state.dirty);
    state.commitBoneProperty('rotation');
    assert.deepEqual(state.findBonePropertyKeyframe('lower', 'rotation'), { time: 500, value: 0.7 });
    assert.deepEqual(state.getKeyedPropertiesAtTime('lower'), ['rotation']);
    assert.approximately(state.selectedBoneTransform!.rotation, 0.7, 1e-12);
    // Cancel also restores a draft property that the player does not own.
    state.cancelTransformEdit();
    assert.equal(puppet.getBone('lower').pose.x, 0);
    const keyed = state.workingAnimation;
    state.undo();
    assert.deepEqual(state.workingAnimation!.tracks, {});
    assert.isFalse(state.dirty);
    assert.equal(state.selectedBoneTransform!.rotation, 0);
    assert.equal(constraint.status, 'solved');
    state.redo();
    assert.strictEqual(state.workingAnimation, keyed);
    assert.approximately(state.selectedBoneTransform!.rotation, 0.7, 1e-12);
    assert.notEqual(puppet.getBone('lower').pose.rotation, 0.7, 'redo retains IK as a separate preview pass');
    puppet.setFacing(facing === 'right' ? 'left' : 'right');
    puppet.posePipeline.syncPose();
    puppet.setFacing(facing);
    puppet.posePipeline.syncPose();
    assert.strictEqual(state.workingAnimation, keyed);
    assert.deepEqual(state.findBonePropertyKeyframe('lower', 'rotation'), { time: 500, value: 0.7 });
    constraint.enabled = false;
    puppet.posePipeline.syncPose();
    assert.approximately(puppet.getBone('lower').pose.rotation, 0.7, 1e-12);
    state.setTemporaryBoneProperty('y', 75);
    state.commitBoneProperty('y');
    assert.equal(puppet.getBone('lower').pose.y, 75);
    assert.equal(puppet.getBone('lower').container.y, 75);
    assert.deepEqual(puppet.getBone('lower').bindPose, bind);
    state.setCurrentTime(1.2);
    state.setCurrentTime(0.5);
    assert.approximately(puppet.getBone('lower').pose.rotation, 0.7, 1e-12);
    state.deleteBonePropertyKey('rotation');
    assert.equal(state.selectedBoneTransform!.rotation, 0);
    assert.equal(puppet.getBone('lower').pose.rotation, 0);
    assert.deepEqual(state.getKeyedPropertiesAtTime('lower'), ['y']);
    assert.equal(JSON.stringify(clip), before);
    assert.deepEqual(state.sourceAnimation!.tracks, {});
    preview.dispose();
    puppet.destroy();
  },
);

test('draft cancellation, selection, navigation and Play restore untracked preview properties immediately', () => {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', x: 4 },
      { id: 'child', parent: 'root', y: 20 },
    ],
  });
  const state = new AnimationEditorState(rig, [{ name: 'move', duration: 2000, loop: false, tracks: {} }]);
  state.selectAnimation('move');
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  state.selectBone('root');
  state.setTemporaryBoneProperty('x', 10);
  assert.equal(puppet.getBone('root').pose.x, 10);
  state.cancelTransformEdit();
  assert.equal(puppet.getBone('root').pose.x, 4);
  state.setTemporaryBoneProperty('x', 10);
  state.selectBone('child');
  assert.equal(puppet.getBone('root').pose.x, 4);
  state.setTemporaryBoneProperty('y', 50);
  state.setCurrentTime(0.5);
  assert.equal(puppet.getBone('child').pose.y, 20);
  state.setTemporaryBoneProperty('y', 50);
  state.play();
  assert.equal(puppet.getBone('child').pose.y, 20);
  assert.isFalse(state.dirty);
  preview.dispose();
  puppet.destroy();
});
