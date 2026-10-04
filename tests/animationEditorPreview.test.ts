import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import type { AnimationClip, AnimationPlaybackMode } from '../src/engine/AnimationClip.js';
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
