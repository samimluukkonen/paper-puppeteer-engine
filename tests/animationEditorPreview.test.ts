import { assert, test, vi } from 'vitest';
import { katanaGrips } from '../src/demo/Katana.js';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
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
  const gripSpacing = katanaGrips.primary.x - katanaGrips.secondary.x;
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
  const sync = vi.spyOn(puppet, 'syncPose');
  try {
    state.setPreviewLoop(true);
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
    const event = vi.fn();
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
