import { assert, test, vi } from 'vitest';
import { sampleProperty } from '../src/engine/AnimationClip.js';
import { shortestRotationDelta } from '../src/engine/animationMath.js';
import { ClipPoseBuffer } from '../src/engine/AnimationPose.js';
import {
  AnimationPlayer,
  type CompiledClip,
  compileClip,
  evaluateClip,
  Joint,
  lerpProperty,
  Rig,
} from '../src/engine/core.js';
import { animationClipSchema } from '../src/engine/schemas.js';

const externalClip = (patch: Partial<CompiledClip> = {}): CompiledClip => ({
  name: 'external',
  duration: 100,
  loop: true,
  tracks: [],
  events: [],
  ...patch,
});

test.each([0, -1, NaN, Infinity])('external compiled clips reject duration %s before changing poses', (duration) => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const joint = new Joint('root');
  joint.pose.x = 42;
  assert.throws(() => new AnimationPlayer(rig, new Map([['root', joint]]), [externalClip({ duration })]));
  assert.equal(joint.pose.x, 42);
});

test.each(
  [
    [{ time: -1, value: 0 }],
    [{ time: 101, value: 0 }],
    [{ time: NaN, value: 0 }],
    [{ time: 0, value: Infinity }],
    [
      { time: 50, value: 0 },
      { time: 0, value: 1 },
    ],
    [
      { time: 0, value: 0 },
      { time: 0, value: 1 },
    ],
    [],
  ].map((keys) => ({ keys })),
)('external compiled clips reject invalid property keys %j', ({ keys }) => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const clip = externalClip({ tracks: [{ bone: 'root', properties: new Map([['x', keys]]) }] });
  assert.throws(() => new AnimationPlayer(rig, new Map([['root', new Joint('root')]]), [clip]));
});

test.each([
  { events: [{ time: -1, name: 'marker' }] },
  { events: [{ time: 101, name: 'marker' }] },
  { events: [{ time: NaN, name: 'marker' }] },
  { playback: { mode: 'stepped' as const, fps: 0 } },
  { playback: { mode: 'stepped' as const, fps: Infinity } },
  {
    tracks: [
      { bone: 'root', properties: new Map() },
      { bone: 'root', properties: new Map() },
    ],
  },
])('external compiled clips reject invalid metadata %j', (patch) => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  assert.throws(() => new AnimationPlayer(rig, new Map([['root', new Joint('root')]]), [externalClip(patch)]));
});

test('compiler-owned clips bypass repeated scalar validation', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const clip = compileClip({ name: 'owned', duration: 100, loop: true, tracks: {} }, rig);
  const parse = vi.spyOn(animationClipSchema, 'parse');
  try {
    const player = new AnimationPlayer(rig, new Map([['root', new Joint('root')]]), [clip]);
    player.play('owned');
    player.update(50);
    assert.equal(player.elapsedTime, 50);
    assert.equal(parse.mock.calls.length, 0);
  } finally {
    parse.mockRestore();
  }
});

test('precompiled clips reject unknown bones before changing joint poses', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root', x: 3 }] });
  const otherRig = new Rig({ root: 'other', bones: [{ id: 'other' }] });
  const joint = new Joint('root', rig.getBone('root'));
  joint.pose.x = 42;
  const clip = compileClip(
    { name: 'incompatible', duration: 100, loop: false, tracks: { other: [{ time: 0, x: 10 }] } },
    otherRig,
  );
  assert.throws(
    () => new AnimationPlayer(rig, new Map([['root', joint]]), [clip]),
    /Animation "incompatible" references unknown bone "other"/,
  );
  assert.equal(joint.pose.x, 42);
});

test('precompiled clips can be reused by compatible rigs without recompilation', () => {
  const sourceRig = new Rig({ root: 'root', bones: [{ id: 'root', x: 3 }] });
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root', x: 8 },
      { id: 'extra', parent: 'root' },
    ],
  });
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const clip = compileClip(
    {
      name: 'move',
      duration: 100,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 100, x: 10 },
        ],
      },
    },
    sourceRig,
  );
  const player = new AnimationPlayer(rig, joints, [clip]);
  player.play('move');
  player.update(50);
  assert.equal(joints.get('root')!.pose.x, 5);
  assert.deepEqual(joints.get('extra')!.pose, joints.get('extra')!.bindPose);
});

test('compiled metadata and tracks are immutable, including the property map and JSON event data', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const clip = compileClip(
    {
      name: 'move',
      duration: 100,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 100, x: 10 },
        ],
      },
      events: [{ time: 50, name: 'marker', data: { nested: [1] } }],
      playback: { mode: 'stepped', fps: 10 },
    },
    rig,
  );
  assert.isFalse(Reflect.set(clip, 'duration', 1));
  assert.isFalse(Reflect.set(clip.events[0]!, 'time', 75));
  assert.isFalse(Reflect.set(clip.playback!, 'fps', 1));
  const track = clip.tracks[0]!;
  assert.isFalse(Reflect.set(track, 'bone', 'missing'));
  assert.isFalse(Reflect.set(track.properties.get('x')![0]!, 'value', 99));
  assert.throws(() => (track.properties as Map<string, unknown>).clear(), TypeError);
  assert.throws(() => Map.prototype.set.call(track.properties, 'x', []), TypeError);
  assert.throws(() => (clip.events[0]!.data as { nested: number[] }).nested.push(2), TypeError);
  const entries: unknown[] = [];
  track.properties.forEach((value, key, map) => {
    assert.strictEqual(map, track.properties);
    entries.push([key, value]);
  });
  assert.deepEqual(entries, [...track.properties]);
  assert.deepEqual([...track.properties.keys()], ['x']);
  assert.deepEqual(
    [...track.properties.values()],
    [
      [
        { time: 0, value: 0 },
        { time: 100, value: 10 },
      ],
    ],
  );
  assert.deepEqual(evaluateClip(clip, 50).get('root'), { x: 5 });
});

test('players own externally assembled compiled clips without freezing caller data', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const joint = new Joint('root');
  const keys = [
    { time: 0, value: 0 },
    { time: 100, value: 10 },
  ];
  const properties = new Map([['x' as const, keys]]);
  const event = { time: 50, name: 'marker', data: { value: 1 } };
  const clip = {
    name: 'move',
    duration: 100,
    loop: false,
    tracks: [{ bone: 'root', properties }],
    events: [event],
    playback: { mode: 'stepped' as const, fps: 20 },
  };
  const player = new AnimationPlayer(rig, new Map([['root', joint]]), [clip]);
  clip.duration = 200;
  keys[0]!.value = 99;
  properties.clear();
  event.time = 75;
  event.name = 'changed';
  event.data.value = 2;
  clip.playback.fps = 1;
  const seen: unknown[] = [];
  player.onAnimationEvent((marker) => seen.push(marker));
  player.play('move');
  player.update(50);
  assert.equal(player.duration, 100);
  assert.equal(joint.pose.x, 5);
  assert.deepEqual(seen, [{ time: 50, name: 'marker', data: { value: 1 }, clip: 'move', layer: 'base' }]);
});

test.each([NaN, Infinity, -Infinity])('sampling rejects nonfinite time %s before changing buffered poses', (time) => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const clip = compileClip(
    {
      name: 'preview',
      duration: 1000,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1000, x: 10 },
        ],
      },
    },
    rig,
  );
  const empty = compileClip({ name: 'empty', duration: 1000, loop: false, tracks: {} }, rig);
  for (const compiled of [clip, empty]) {
    assert.throws(() => evaluateClip(compiled, time), /Sample time must be a finite number/);
    const buffer = new ClipPoseBuffer();
    assert.throws(() => buffer.evaluate(compiled, time), /Sample time must be a finite number/);
    const held = buffer.evaluate(compiled, 500);
    const snapshot = structuredClone(held);
    assert.throws(() => buffer.evaluate(compiled, time), /Sample time must be a finite number/);
    assert.deepEqual(held, snapshot);
  }
});

test('the public core API compiles and evaluates an authored clip without runtime player state', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root', x: 3 }] });
  const compiled: CompiledClip = compileClip(
    {
      name: 'preview',
      duration: 1000,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1000, x: 10 },
        ],
      },
    },
    rig,
  );
  assert.deepEqual(evaluateClip(compiled, 500).get('root'), { x: 5 });
  assert.deepEqual(evaluateClip(compiled, 200).get('root'), { x: 2 });
  assert.equal(rig.getBone('root').x, 3);
});

test('player sampling reuses pose storage across seeks and rebuilds it when the clip changes', () => {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root', x: 3, y: 4 }] });
  const joint = new Joint('root', rig.getBone('root'));
  const player = new AnimationPlayer(rig, new Map([['root', joint]]));
  player.addAnimation({
    name: 'horizontal',
    duration: 1000,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: 0 },
        { time: 1000, x: 100 },
      ],
    },
  });
  player.addAnimation({
    name: 'vertical',
    duration: 1000,
    loop: false,
    tracks: {
      root: [
        { time: 0, y: 0 },
        { time: 1000, y: 200 },
      ],
    },
  });
  player.play('horizontal');
  const evaluate = vi.spyOn(ClipPoseBuffer.prototype, 'evaluate');
  try {
    let heldPose: ReturnType<ClipPoseBuffer['evaluate']> | undefined;
    let heldValues: unknown;
    for (const time of [750, 250, 1000, 0, 500]) {
      evaluate.mockClear();
      player.sample(time);
      const pose = evaluate.mock.results[0]!.value as ReturnType<ClipPoseBuffer['evaluate']>;
      if (heldPose) {
        assert.strictEqual(pose, heldPose);
        assert.strictEqual(pose.get('root'), heldValues);
      }
      heldPose = pose;
      heldValues = pose.get('root');
      assert.equal(joint.pose.x, time / 10);
      assert.equal(joint.pose.y, 4);
      assert.equal(player.elapsedTime, 0);
    }
    player.play('vertical');
    evaluate.mockClear();
    player.sample(250);
    const verticalPose = evaluate.mock.results[0]!.value;
    assert.notStrictEqual(verticalPose, heldPose);
    assert.deepEqual(verticalPose.get('root'), { y: 50 });
    assert.equal(joint.pose.x, 3);
    assert.equal(joint.pose.y, 50);
  } finally {
    evaluate.mockRestore();
    player.dispose();
  }
});

test('dense tracks interpolate the correct interval when seeking in both directions', () => {
  const keys = Array.from({ length: 512 }, (_, index) => ({ time: index * 17, value: index ** 2 }));
  for (const index of [510, 1, 256, 42, 0, 509]) {
    assert.equal(sampleProperty(keys, index * 17), index ** 2);
    assert.closeTo(sampleProperty(keys, (index + 0.25) * 17), index ** 2 * 0.75 + (index + 1) ** 2 * 0.25, 1e-8);
  }
  assert.equal(sampleProperty(keys, -20), 0);
  assert.equal(sampleProperty(keys, 10000), 511 ** 2);
});

test('nonuniform key spacing, single keys, and empty tracks keep their sampling behavior', () => {
  const keys = [
    { time: 10, value: 1 },
    { time: 20, value: 3 },
    { time: 80, value: 9 },
  ];
  assert.equal(sampleProperty(keys, 15), 2);
  assert.equal(sampleProperty(keys, 20), 3);
  assert.equal(sampleProperty(keys, 50), 6);
  assert.equal(sampleProperty(keys, 80), 9);
  assert.equal(sampleProperty([{ time: 10, value: 7 }], 0), 7);
  assert.equal(sampleProperty([{ time: 10, value: 7 }], 100), 7);
  assert.throws(() => sampleProperty([], 0), /empty property track/);
});

test('exact angular keys retain the shortest-path equivalent angle until past the final key', () => {
  const degrees = (value: number) => (value * Math.PI) / 180;
  const keys = [
    { time: 0, value: degrees(179) },
    { time: 100, value: degrees(-179) },
  ];
  assert.closeTo(sampleProperty(keys, 50, 'rotation'), Math.PI, 1e-12);
  assert.closeTo(sampleProperty(keys, 100, 'rotation'), degrees(181), 1e-12);
  assert.equal(sampleProperty(keys, 101, 'rotation'), degrees(-179));
});

test.each([-1, 1])(
  'opposite finite extremes remain finite during sampling and blending (direction %s)',
  (direction) => {
    const from = direction * Number.MAX_VALUE;
    const to = -from;
    const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
    const compiled = compileClip(
      {
        name: 'extremes',
        duration: 100,
        loop: false,
        tracks: {
          root: [
            { time: 0, x: from, rotation: from },
            { time: 100, x: to, rotation: to },
          ],
        },
      },
      rig,
    );
    for (const weight of [0, 0.25, 0.5, 0.75, 1]) {
      const pose = evaluateClip(compiled, weight * 100).get('root')!;
      assert.isTrue(Number.isFinite(pose.x));
      assert.isTrue(Number.isFinite(pose.rotation));
      assert.isTrue(Number.isFinite(lerpProperty('x', from, to, weight)));
      assert.isTrue(Number.isFinite(lerpProperty('rotation', from, to, weight)));
      assert.equal(pose.x, lerpProperty('x', from, to, weight));
    }
    assert.equal(evaluateClip(compiled, 50).get('root')!.x, 0);
    const delta = shortestRotationDelta(from, to);
    assert.isTrue(Number.isFinite(delta));
    assert.isAtLeast(delta, -Math.PI);
    assert.isBelow(delta, Math.PI);
  },
);
