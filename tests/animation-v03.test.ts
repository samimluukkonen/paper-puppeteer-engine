import { assert, test, vi } from 'vitest';
import type { AnimationPlaybackMode } from '../src/engine/AnimationClip.js';
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

test.each([0, 50])('JSON event payloads at %s are isolated from source data, listeners and later loops', (time) => {
  const { player } = fixture();
  const data = { nested: { values: [1] } };
  player.addAnimation({
    name: 'payload',
    duration: 100,
    loop: true,
    tracks: {},
    events: [{ time, name: 'hit', data }],
  });
  data.nested.values.push(2);
  const observed: number[][] = [];
  player.onAnimationEvent((event) => {
    (event.data as typeof data).nested.values.push(99);
    event.name = 'changed';
  });
  player.onAnimationEvent((event) => {
    assert.equal(event.name, 'hit');
    observed.push((event.data as typeof data).nested.values);
  });
  player.play('payload');
  player.update(150);
  assert.deepEqual(observed, [[1], [1]]);
  assert.notStrictEqual(observed[0], observed[1]);
  assert.deepEqual(data.nested.values, [1, 2]);
});

test('completion listeners receive independent events for base and overlay clips', () => {
  const { player } = fixture();
  player.addAnimation({ name: 'once', duration: 100, loop: false, tracks: {} });
  const observed: { clip: string; layer: string }[] = [];
  player.onAnimationComplete((event) => {
    event.clip = 'changed';
    event.layer = 'changed';
  });
  player.onAnimationComplete((event) => observed.push(event));
  player.play('once');
  player.play('once', { layer: 'upper' });
  player.update(100);
  player.update(100);
  assert.deepEqual(observed, [
    { clip: 'once', layer: 'base' },
    { clip: 'once', layer: 'upper' },
  ]);
  assert.notStrictEqual(observed[0], observed[1]);
});

test('non-JSON TypeScript event payloads retain reference semantics', () => {
  const { player } = fixture();
  const data = { callback: () => 42 };
  player.addAnimation({
    name: 'runtime-payload',
    duration: 100,
    loop: true,
    tracks: {},
    events: [{ time: 0, name: 'hit', data }],
  });
  const delivered: unknown[] = [];
  player.onAnimationEvent((event) => delivered.push(event.data));
  player.play('runtime-payload');
  player.update(100);
  assert.deepEqual(delivered, [data, data]);
  for (const payload of delivered) assert.strictEqual(payload, data);
});

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

test('interrupted fades retain independent snapshots across later buffered evaluations', () => {
  const { player, joints } = fixture();
  player.play('a');
  player.play('b', { fadeDuration: 200 });
  player.update(100);
  player.play('a', { fadeDuration: 200 });
  for (const [delta, expected] of [
    [50, 13.75],
    [50, 12.5],
    [100, 10],
  ]) {
    player.update(delta!);
    assert.strictEqual(joints.get('arm')!.pose.x, expected);
  }
});

test('an interrupted stepped overlay keeps its snapshot sparse while the underlying pose advances', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'move',
    duration: 1000,
    loop: true,
    tracks: {
      arm: [
        { time: 0, y: 0 },
        { time: 1000, y: 100 },
      ],
    },
  });
  player.addAnimation({ name: 'raise', duration: 1000, loop: true, tracks: { arm: [{ time: 0, x: 20 }] } });
  player.addAnimation({ name: 'reach', duration: 1000, loop: true, tracks: { arm: [{ time: 0, x: 40 }] } });
  player.setPlaybackMode({ mode: 'stepped', fps: 10 });
  player.setLayerWeight('upper', 0.5);
  player.play('move');
  player.play('raise', { layer: 'upper', fadeDuration: 200 });
  player.update(100);
  assert.equal(joints.get('arm')!.pose.x, 12.5);
  player.play('reach', { layer: 'upper', fadeDuration: 200 });
  assert.equal(joints.get('arm')!.pose.x, 12.5);
  for (const [delta, x, y] of [
    [50, 12.5, 10],
    [50, 18.75, 20],
    [50, 18.75, 20],
    [50, 25, 30],
  ]) {
    player.update(delta!);
    assert.equal(joints.get('arm')!.pose.x, x);
    assert.equal(joints.get('arm')!.pose.y, y, 'the snapshot does not take ownership of underlying properties');
  }
});

test.each([1, 0.5, 0])('interrupted arm-only overlay fades preserve sparse ownership at weight %s', (weight) => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'walk',
    duration: 1000,
    loop: true,
    tracks: {
      leg: [
        { time: 0, x: 0 },
        { time: 1000, x: 100 },
      ],
    },
  });
  player.addAnimation({ name: 'raise', duration: 1000, loop: true, tracks: { arm: [{ time: 0, x: 20 }] } });
  player.addAnimation({ name: 'reach', duration: 1000, loop: true, tracks: { arm: [{ time: 0, x: 40 }] } });
  player.play('walk');
  player.setLayerWeight('upper', weight);
  const arm = joints.get('arm')!;
  arm.pose.y = 42;
  joints.get('root')!.pose.rotation = 0.25;
  player.play('raise', { layer: 'upper', fadeDuration: 200 });
  player.update(100);
  assert.strictEqual(arm.pose.x, 10 + 5 * weight);
  player.play('reach', { layer: 'upper', fadeDuration: 200 });
  assert.strictEqual(arm.pose.x, 10 + 5 * weight);
  player.update(50);
  assert.strictEqual(joints.get('leg')!.pose.x, 15);
  assert.strictEqual(arm.pose.x, 10 + 11.25 * weight);
  assert.strictEqual(arm.pose.y, 42);
  assert.strictEqual(joints.get('root')!.pose.rotation, 0.25);
  player.setLayerWeight('upper', 1);
  assert.strictEqual(arm.pose.x, 21.25);
  player.play('raise', { layer: 'upper', fadeDuration: 200 });
  player.update(50);
  assert.strictEqual(joints.get('leg')!.pose.x, 20);
  assert.strictEqual(arm.pose.y, 42);
  player.clearLayer('upper');
  assert.strictEqual(arm.pose.x, 10);
  assert.strictEqual(arm.pose.y, 42);
  assert.strictEqual(joints.get('root')!.pose.rotation, 0.25);
});

test('shared clips on separate layers keep independent evaluation times and sparse ownership', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'move',
    duration: 1000,
    loop: true,
    tracks: {
      arm: [
        { time: 0, x: 0 },
        { time: 1000, x: 100 },
      ],
    },
  });
  player.play('move');
  player.update(100);
  player.play('move', { layer: 'upper' });
  player.setLayerWeight('upper', 0.5);
  joints.get('arm')!.pose.y = 42;
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 25);
  assert.strictEqual(joints.get('arm')!.pose.y, 42);
});

test('completing a fade releases properties controlled only by its source', () => {
  const { player, joints } = fixture();
  player.addAnimation({ name: 'partial', duration: 1000, loop: true, tracks: { leg: [{ time: 0, rotation: 1 }] } });
  player.play('b');
  player.play('partial', { fadeDuration: 200 });
  player.update(200);
  joints.get('arm')!.pose.x = 42;
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 42);
  assert.strictEqual(joints.get('leg')!.pose.rotation, 1);
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

test('raw sampling remains available while playback sampling holds the 10 FPS pose at 50 ms', () => {
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
    events: [{ time: 25, name: 'marker' }],
  });
  const events: string[] = [];
  const completions: string[] = [];
  player.onAnimationEvent(({ name }) => events.push(name));
  player.onAnimationComplete(({ clip }) => completions.push(clip));
  player.setPlaybackMode({ mode: 'stepped', fps: 10 });
  player.play('move', { speed: 2 });
  player.setSpeed(2);
  player.pause();
  joints.get('leg')!.pose.x = 42;

  player.sample(50);
  assert.strictEqual(joints.get('arm')!.pose.x, 5);
  player.sample(50, { mode: 'playback' });
  assert.strictEqual(joints.get('arm')!.pose.x, 0);
  player.sample(50, { mode: 'raw' });
  assert.strictEqual(joints.get('arm')!.pose.x, 5);
  player.sample(1000, { mode: 'playback' });
  assert.strictEqual(joints.get('arm')!.pose.x, 100);
  assert.strictEqual(joints.get('leg')!.pose.x, 42);
  assert.strictEqual(player.elapsedTime, 0);
  assert.strictEqual(player.isPlaying, true);
  assert.strictEqual(player.isPaused, true);
  assert.deepEqual(events, []);
  assert.deepEqual(completions, []);

  player.resume();
  player.update(25);
  assert.strictEqual(player.elapsedTime, 100);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  assert.deepEqual(events, ['marker']);
});

const samplingModes: { name: string; global: AnimationPlaybackMode; clip?: AnimationPlaybackMode }[] = [
  { name: 'smooth playback', global: { mode: 'smooth' } },
  { name: 'global stepped playback', global: { mode: 'stepped', fps: 10 } },
  { name: 'clip stepped override', global: { mode: 'smooth' }, clip: { mode: 'stepped', fps: 12 } },
  { name: 'clip FPS override', global: { mode: 'stepped', fps: 10 }, clip: { mode: 'stepped', fps: 20 } },
  { name: 'clip smooth override', global: { mode: 'stepped', fps: 10 }, clip: { mode: 'smooth' } },
];

for (const mode of samplingModes) {
  test(`playback sampling matches updates with ${mode.name}, boundaries and nonlooping completion`, () => {
    const { player, joints } = fixture();
    player.addAnimation({
      name: 'move',
      duration: 1050,
      loop: false,
      ...(mode.clip ? { playback: mode.clip } : {}),
      tracks: {
        arm: [
          { time: 0, x: 0 },
          { time: 1050, x: 105 },
        ],
      },
    });
    player.setPlaybackMode(mode.global);
    for (const time of [-50, 0, 50, 99, 100, 125, 1049, 1050, 1500]) {
      player.play('move');
      player.sample(time, { mode: 'playback' });
      const sampled = joints.get('arm')!.pose.x;
      assert.strictEqual(player.elapsedTime, 0);
      player.update(Math.max(0, time));
      assert.strictEqual(sampled, joints.get('arm')!.pose.x, `sample at ${time} ms`);
      if (time >= 1050) assert.strictEqual(sampled, 105);
    }
  });
}

test('playback sampling clamps looping clips without wrapping or forcing their exact endpoint', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'loop',
    duration: 1050,
    loop: true,
    tracks: {
      arm: [
        { time: 0, x: 0 },
        { time: 1050, x: 105 },
      ],
    },
  });
  player.setPlaybackMode({ mode: 'stepped', fps: 10 });
  player.play('loop');
  player.sample(-50, { mode: 'playback' });
  assert.strictEqual(joints.get('arm')!.pose.x, 0);
  for (const time of [1050, 1500]) {
    player.sample(time, { mode: 'playback' });
    assert.strictEqual(joints.get('arm')!.pose.x, 100);
    player.sample(time);
    assert.strictEqual(joints.get('arm')!.pose.x, 105);
  }
});

test('playback sampling excludes active fades and overlay layers without changing their state', () => {
  const { player, joints } = fixture();
  player.setPlaybackMode({ mode: 'stepped', fps: 10 });
  player.play('a');
  player.play('b', { fadeDuration: 300 });
  player.play('a', { layer: 'upper' });
  player.update(150);
  const pose = { ...joints.get('arm')!.pose };
  const transition = player.transition;
  for (const time of [-50, 50, 1500]) {
    player.sample(time, { mode: 'playback' });
    assert.strictEqual(joints.get('arm')!.pose.x, 20);
    assert.strictEqual(player.elapsedTime, 150);
    assert.deepEqual(player.transition, transition);
    player.applyCurrentPose();
    assert.deepEqual(joints.get('arm')!.pose, pose);
  }
});

test('both sampling modes reject nonfinite time and allow sampling without an active clip', () => {
  const { player, joints } = fixture();
  for (const mode of ['raw', 'playback'] as const) {
    for (const time of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(() => player.sample(time, { mode }), /Sample time must be a finite number/);
    }
    player.sample(50, { mode });
    assert.deepEqual(joints.get('arm')!.pose, joints.get('arm')!.bindPose);
  }
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

test.each([Number.MIN_VALUE, 1e-308, Number.MAX_VALUE])(
  'stepped playback remains finite at FPS %s for player and clip settings',
  (fps) => {
    for (const clipOverride of [false, true]) {
      const { player, joints } = fixture();
      player.addAnimation({
        name: 'extreme',
        duration: 100,
        loop: false,
        tracks: {
          arm: [
            { time: 0, x: 0 },
            { time: 100, x: 100 },
          ],
        },
        ...(clipOverride ? { playback: { mode: 'stepped' as const, fps } } : {}),
      });
      player.play('extreme');
      if (!clipOverride) player.setPlaybackMode({ mode: 'stepped', fps });
      assert.equal(joints.get('arm')!.pose.x, 0);
      player.update(50);
      assert.equal(joints.get('arm')!.pose.x, fps === Number.MAX_VALUE ? 50 : 0);
      player.sample(50, { mode: 'playback' });
      assert.equal(joints.get('arm')!.pose.x, fps === Number.MAX_VALUE ? 50 : 0);
      player.update(50);
      assert.equal(joints.get('arm')!.pose.x, 100);
    }
  },
);

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

for (const withBase of [false, true]) {
  test.each(['clip', 'fade', 'interrupted fade'] as const)(
    `switching an overlay from a %s releases previous properties ${withBase ? 'with' : 'without'} a base`,
    (previous) => {
      const { player, joints } = fixture();
      player.addAnimation({ name: 'armY', duration: 1000, loop: true, tracks: { arm: [{ time: 0, y: 8 }] } });
      player.addAnimation({ name: 'leg', duration: 1000, loop: true, tracks: { leg: [{ time: 0, rotation: 1 }] } });
      player.addAnimation({
        name: 'accent',
        duration: 1000,
        loop: true,
        tracks: { arm: [{ time: 0, rotation: 0.5 }] },
      });
      if (withBase) player.play('a');
      player.play('b', { layer: 'upper' });
      player.setLayerWeight('upper', 0.5);
      player.play('accent', { layer: 'accent' });
      if (previous !== 'clip') {
        player.play('armY', { layer: 'upper', fadeDuration: 200 });
        player.update(50);
        if (previous === 'interrupted fade') {
          player.play('armY', { layer: 'upper', fadeDuration: 200 });
          player.update(50);
        }
      }
      const arm = joints.get('arm')!;
      const leg = joints.get('leg')!;
      assert.ok(arm.pose.x > arm.bindPose.x);
      leg.pose.y = 42;
      joints.get('root')!.pose.x = 7;
      player.play('leg', { layer: 'upper' });
      assert.deepEqual(arm.pose, { ...arm.bindPose, rotation: 0.5 });
      assert.strictEqual(leg.pose.rotation, 0.5);
      assert.strictEqual(leg.pose.y, 42);
      assert.strictEqual(joints.get('root')!.pose.x, 7);
      arm.pose.x = withBase ? 10 : 99;
      player.update(50);
      assert.strictEqual(arm.pose.x, withBase ? 10 : 99);
      assert.strictEqual(arm.pose.rotation, 0.5);
    },
  );
}

test('switching a muted masked overlay preserves manual edits and restores only its contributions', () => {
  const { player, joints } = fixture();
  player.addAnimation({ name: 'leg', duration: 1000, loop: true, tracks: { leg: [{ time: 0, rotation: 1 }] } });
  player.setLayerMask('upper', ['arm']);
  player.play('b', { layer: 'upper' });
  player.setLayerWeight('upper', 0);
  joints.get('arm')!.pose.x = 42;
  joints.get('leg')!.pose.rotation = 0.25;
  player.play('leg', { layer: 'upper' });
  assert.strictEqual(joints.get('arm')!.pose.x, 42);
  assert.strictEqual(joints.get('leg')!.pose.rotation, 0.25);
  player.setLayerWeight('upper', 1);
  assert.strictEqual(joints.get('arm')!.pose.x, 42);
  assert.strictEqual(joints.get('leg')!.pose.rotation, 0.25);
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

test.each(['clear', 'mask'] as const)('zero-weight layers preserve manual edits through updates and %s', (cleanup) => {
  const { player, joints } = fixture();
  player.addAnimation({ name: 'base', duration: 1000, loop: true, tracks: { root: [{ time: 0, x: 5 }] } });
  player.play('base');
  player.setLayerWeight('upper', 0);
  const arm = joints.get('arm')!;
  arm.pose.x = 42;
  player.play('b', { layer: 'upper' });
  player.update(100);
  player.applyCurrentPose();
  assert.strictEqual(arm.pose.x, 42);
  assert.strictEqual(joints.get('root')!.pose.x, 5);
  if (cleanup === 'clear') player.clearLayer('upper');
  else player.setLayerMask('upper', []);
  assert.strictEqual(arm.pose.x, 42);
});

test('muting a contributing layer releases its properties while the base retains its own', () => {
  const { player, joints } = fixture();
  player.addAnimation({ name: 'base', duration: 1000, loop: true, tracks: { arm: [{ time: 0, rotation: 0.5 }] } });
  player.play('base');
  player.play('b', { layer: 'upper' });
  player.setLayerWeight('upper', 0);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  assert.strictEqual(joints.get('arm')!.pose.rotation, 0.5);
  joints.get('arm')!.pose.x = 42;
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 42);
  player.setLayerWeight('upper', 0.5);
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  assert.strictEqual(joints.get('arm')!.pose.rotation, 1.25);
});

test('an overlay without a base evaluates masks, weights, clocks, events and its final pose', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'move',
    duration: 100,
    loop: false,
    tracks: {
      arm: [
        { time: 0, x: 20 },
        { time: 100, x: 40 },
      ],
      leg: [{ time: 0, x: 99 }],
    },
    events: [{ time: 50, name: 'halfway' }],
  });
  const events: string[] = [];
  const completions: string[] = [];
  player.onAnimationEvent(({ name, layer }) => events.push(`${layer}:${name}`));
  player.onAnimationComplete(({ clip, layer }) => completions.push(`${layer}:${clip}`));
  player.setLayerMask('upper', ['arm']);
  player.setLayerWeight('upper', 0.5);
  joints.get('arm')!.pose.y = 42;
  joints.get('leg')!.pose.x = 7;
  player.play('move', { layer: 'upper' });
  assert.isUndefined(player.currentAnimation);
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  player.update(50);
  assert.strictEqual(joints.get('arm')!.pose.x, 20);
  assert.deepEqual(events, ['upper:halfway']);
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 25);
  assert.deepEqual(completions, ['upper:move']);
  assert.strictEqual(joints.get('arm')!.pose.y, 42);
  assert.strictEqual(joints.get('leg')!.pose.x, 7);
  player.clearLayer('upper');
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  assert.strictEqual(joints.get('arm')!.pose.y, 42);
});

test('an overlay without a base fades in and can release ownership at zero weight', () => {
  const { player, joints } = fixture();
  player.play('b', { layer: 'upper', fadeDuration: 200 });
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 15);
  player.setLayerWeight('upper', 0);
  joints.get('arm')!.pose.x = 42;
  player.update(100);
  assert.strictEqual(joints.get('arm')!.pose.x, 42);
  player.setLayerWeight('upper', 1);
  assert.strictEqual(joints.get('arm')!.pose.x, 20);
});

test.each([false, true])('overflowing advancement leaves all layers unchanged (events: %s)', (withEvents) => {
  const { player, joints } = fixture();
  const listener = vi.fn();
  player.onAnimationEvent(listener);
  player.play('a');
  player.play('b', { fadeDuration: 200 });
  player.addAnimation({
    name: 'overflow',
    duration: 1000,
    loop: true,
    tracks: { arm: [{ time: 0, x: 99 }] },
    ...(withEvents ? { events: [{ time: 1, name: 'marker' }] } : {}),
  });
  player.play('overflow', { layer: 'upper', speed: Number.MAX_VALUE });
  const before = { ...joints.get('arm')!.pose };
  const transition = player.transition;
  assert.throws(() => player.update(16), /advancement distance.*finite/);
  assert.equal(player.elapsedTime, 0);
  assert.deepEqual(player.transition, transition);
  assert.deepEqual(joints.get('arm')!.pose, before);
  assert.equal(listener.mock.calls.length, 0);
  player.clearLayer('upper');
  player.update(16);
  assert.equal(player.elapsedTime, 16);
});

test.each([1e-300, 1e-10])('unsafe or excessive event catch-up rejects promptly for duration %s', (duration) => {
  const { player } = fixture();
  player.addAnimation({ name: 'events', duration, loop: true, tracks: {}, events: [{ time: 0, name: 'cycle' }] });
  player.play('events');
  assert.throws(() => player.update(1e10), /finite|safe integers|exceeds/);
  assert.equal(player.elapsedTime, 0);
});

test('event catch-up is bounded across layers and preserves ordinary large-delta delivery', () => {
  const { player } = fixture();
  player.addAnimation({ name: 'events', duration: 1, loop: true, tracks: {}, events: [{ time: 0, name: 'cycle' }] });
  player.play('events');
  player.play('events', { layer: 'upper' });
  const listener = vi.fn();
  player.onAnimationEvent(listener);
  assert.throws(() => player.update(5001), /exceeds 10000 events/);
  assert.equal(player.elapsedTime, 0);
  assert.equal(listener.mock.calls.length, 0);
  player.update(5000);
  assert.equal(listener.mock.calls.length, 10_000);
});

test('zero playback speed does not overflow intermediate multiplication', () => {
  const { player } = fixture();
  player.play('a', { speed: 0 });
  player.setSpeed(Number.MAX_VALUE);
  player.update(Number.MAX_VALUE);
  assert.equal(player.elapsedTime, 0);
});
