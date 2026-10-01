import { assert, test } from 'vitest';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { blendPose, lerpProperty } from '../src/engine/AnimationPose.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';

function fixture() {
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'arm', parent: 'root', x: 10 }, { id: 'leg', parent: 'root', y: 10 }],
  });
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const player = new AnimationPlayer(rig, joints);
  player.addAnimation({
    name: 'a',
    duration: 1000,
    loop: true,
    tracks: { arm: [{ time: 0, x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }], leg: [{ time: 0, rotation: 0 }] },
  });
  player.addAnimation({
    name: 'b',
    duration: 1000,
    loop: true,
    tracks: { arm: [{ time: 0, x: 20, y: 10, rotation: 2, scaleX: 3, scaleY: 2 }] },
  });
  return { player, joints };
}

test('pose blending includes all transforms, endpoints and shortest rotation path', () => {
  const from = new Map([['arm', { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }]]);
  const to = new Map([['arm', { x: 20, y: 10, rotation: 2, scaleX: 3, scaleY: 2 }]]);
  assert.deepEqual(blendPose(from, from, to, 0).get('arm'), from.get('arm'));
  assert.deepEqual(blendPose(from, from, to, 1).get('arm'), to.get('arm'));
  assert.deepEqual(blendPose(from, from, to, 0.5).get('arm'), { x: 15, y: 5, rotation: 1, scaleX: 2, scaleY: 1.5 });
  const midpoint = lerpProperty('rotation', (179 * Math.PI) / 180, (-179 * Math.PI) / 180, 0.5);
  assert.ok(Math.abs(midpoint - Math.PI) < 1e-10);
});

test('crossfade advances source and target, and a new fade does not snap', () => {
  const { player, joints } = fixture();
  player.play('a');
  player.play('b', { fadeDuration: 200 });
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  player.play('a', { fadeDuration: 200 });
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  player.update(200);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
});

test('partial target fades tracked properties toward bind without touching other bones', () => {
  const { player, joints } = fixture();
  player.addAnimation({ name: 'partial', duration: 1000, loop: true, tracks: { leg: [{ time: 0, rotation: 1 }] } });
  player.play('b');
  player.play('partial', { fadeDuration: 200 });
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  assert.strictEqual(joints.get('leg')!.pose.rotation, 0.5);
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  assert.strictEqual(joints.get('leg')!.pose.rotation, 1);
});

test('manual changes to untracked properties survive updates until a hard clip switch', () => {
  const { player, joints } = fixture();
  player.play('a');
  joints.get('leg')!.pose.x = 42;
  player.update(100);
  assert.strictEqual(joints.get('leg')!.pose.x, 42);
  player.play('b');
  assert.strictEqual(joints.get('leg')!.pose.x, 0);
});

test('stepped mode holds poses while the continuous timeline and smooth mode progress', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'move',
    duration: 1000,
    loop: false,
    tracks: {
      arm: [
        { time: 0, x: 0 },
        { time: 1000, x: 100 },
      ],
    },
  });
  player.setPlaybackMode({ mode: 'stepped', fps: 10 });
  player.play('move');
  player.update(99);
  assert.strictEqual(joints.get('arm')!.pose.x, 0);
  assert.strictEqual(player.elapsedTime, 99);
  player.update(1);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  player.update(50);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  player.setPlaybackMode({ mode: 'smooth' });
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  player.pause();
  player.update(200);
  assert.strictEqual(player.elapsedTime, 150);
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  player.resume();
  player.update(50);
  assert.strictEqual(joints.get('arm')!.pose.x, 20);
});

test('stepped crossfade also holds its blend factor between pose ticks', () => {
  const { player, joints } = fixture();
  player.setPlaybackMode({ mode: 'stepped', fps: 10 });
  player.play('a');
  player.play('b', { fadeDuration: 300 });
  player.update(50);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  player.update(49);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  player.update(1);
  assert.ok(Math.abs(joints.get('arm')!.pose.x - 13.333333333333334) < 1e-10);
});

test('clip playback overrides global mode and speed affects stepped time', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'clipStep',
    duration: 1000,
    loop: true,
    playback: { mode: 'stepped', fps: 10 },
    tracks: {
      arm: [
        { time: 0, x: 0 },
        { time: 1000, x: 100 },
      ],
    },
  });
  player.play('clipStep', { speed: 2 });
  player.update(49);
  assert.strictEqual(joints.get('arm')!.pose.x, 0);
  player.update(1);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
});

test('events cross timestamps once, loop with large deltas, obey speed and exclude fade source', () => {
  const { player } = fixture();
  const seen: string[] = [];
  player.addAnimation({
    name: 'steps',
    duration: 100,
    loop: true,
    tracks: {},
    events: [
      { time: 20, name: 'left' },
      { time: 70, name: 'right' },
    ],
  });
  player.onAnimationEvent((event) => seen.push(event.name));
  player.play('steps');
  player.update(20);
  player.update(0);
  player.update(100);
  assert.deepEqual(seen, ['left', 'right', 'left']);
  player.setSpeed(2);
  player.update(50);
  assert.deepEqual(seen.slice(3), ['right', 'left']);
  player.play('a', { fadeDuration: 50 });
  player.update(100);
  assert.strictEqual(seen.length, 5);
});

test('events fire across stepped frames and completion fires once only for nonlooping clips', () => {
  const { player } = fixture();
  const events: string[] = [];
  const completions: string[] = [];
  player.onAnimationEvent((event) => events.push(event.name));
  player.onAnimationComplete((event) => completions.push(event.clip));
  player.addAnimation({ name: 'once', duration: 100, loop: false, tracks: {}, events: [{ time: 30, name: 'hit' }] });
  player.setPlaybackMode({ mode: 'stepped', fps: 8 });
  player.play('once');
  player.update(20);
  player.update(80);
  player.update(200);
  assert.deepEqual(events, ['hit']);
  assert.deepEqual(completions, ['once']);
  player.play('a');
  player.update(5000);
  assert.deepEqual(completions, ['once']);
});

test('zero-time markers fire at start and wraps, while restart:false leaves the clock alone', () => {
  const { player } = fixture();
  const seen: string[] = [];
  player.addAnimation({ name: 'zero', duration: 100, loop: true, tracks: {}, events: [{ time: 0, name: 'cycle' }] });
  player.onAnimationEvent(({ name }) => seen.push(name));
  player.play('zero');
  player.update(50);
  player.play('zero', { restart: false });
  assert.strictEqual(player.elapsedTime, 50);
  player.update(250);
  assert.deepEqual(seen, ['cycle', 'cycle', 'cycle', 'cycle']);
});

test('stop freezes a transition and reset pose remains at bind on later updates', () => {
  const { player, joints } = fixture();
  player.play('a');
  player.play('b', { fadeDuration: 200 });
  player.update(100);
  player.stop();
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  player.resetPose();
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
});

test('masked overlay respects weights and preserves untracked bones', () => {
  const { player, joints } = fixture();
  player.play('a');
  player.setLayerMask('upper', ['arm']);
  player.setLayerWeight('upper', 0);
  player.play('b', { layer: 'upper' });
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  player.setLayerWeight('upper', 0.5);
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  assert.strictEqual(joints.get('leg')!.pose.rotation, 0);
  player.setLayerWeight('upper', 1);
  assert.strictEqual(joints.get('arm')!.pose.x, 20);
  player.setLayerMask('upper', ['leg']);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  player.clearLayer('upper');
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
});

for (const interrupted of [false, true]) {
  for (const cleanup of ['clear', 'mask'] as const) {
    test(`${cleanup} layer during ${interrupted ? 'an interrupted' : 'a'} crossfade resets all controlled properties`, () => {
      const { player, joints } = fixture();
      player.addAnimation({ name: 'base', duration: 1000, loop: true, tracks: { root: [{ time: 0, x: 5 }] } });
      player.addAnimation({ name: 'partial', duration: 1000, loop: true, tracks: { leg: [{ time: 0, rotation: 1 }] } });
      player.play('base');
      player.setLayerMask('upper', ['arm', 'leg']);
      joints.get('root')!.pose.rotation = 0.25;
      player.play('b', { layer: 'upper' });
      player.play('partial', { layer: 'upper', fadeDuration: 200 });
      player.update(100);
      if (interrupted) {
        player.play('partial', { layer: 'upper', fadeDuration: 200 });
        player.update(100);
      }
      const arm = joints.get('arm')!;
      const leg = joints.get('leg')!;
      assert.ok(arm.pose.x > arm.bindPose.x);
      assert.ok(leg.pose.rotation > leg.bindPose.rotation);

      if (cleanup === 'clear') player.clearLayer('upper');
      else player.setLayerMask('upper', []);

      assert.deepEqual(arm.pose, arm.bindPose);
      assert.deepEqual(leg.pose, leg.bindPose);
      assert.strictEqual(joints.get('root')!.pose.x, 5);
      assert.strictEqual(joints.get('root')!.pose.rotation, 0.25);
      player.update(50);
      assert.deepEqual(arm.pose, arm.bindPose);
      assert.deepEqual(leg.pose, leg.bindPose);
    });
  }
}

test('a new layer fades in from the pose below it', () => {
  const { player, joints } = fixture();
  player.play('a');
  player.setLayerMask('upper', ['arm']);
  player.play('b', { layer: 'upper', fadeDuration: 200 });
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 20);
});
