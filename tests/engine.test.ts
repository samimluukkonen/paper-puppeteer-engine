import { assert, test, vi } from 'vitest';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { Joint } from '../src/engine/Joint.js';
import { Rig } from '../src/engine/Rig.js';
import { rigDefinitionSchema } from '../src/engine/schemas.js';
import type { RigDefinition } from '../src/engine/types.js';

const definition: RigDefinition = {
  root: 'root',
  bones: [
    { id: 'hand', parent: 'arm', y: 30, rotation: 0.2 },
    { id: 'root' },
    { id: 'arm', parent: 'root', x: 10, y: 20 },
  ],
};

function fixture() {
  const rig = new Rig(definition);
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  return { rig, joints, player: new AnimationPlayer(rig, joints) };
}

test('rig accepts unordered definitions and creates an immutable parent-first snapshot', () => {
  const rig = new Rig(definition);
  assert.deepEqual(
    rig.bones.map((bone) => bone.id),
    ['root', 'arm', 'hand'],
  );
  assert.strictEqual(rig.getBone('hand').parent, 'arm');
  assert.ok(Object.isFrozen(rig.bones));
  assert.ok(Object.isFrozen(rig.getBone('hand')));
  assert.throws(() => rig.getBone('absent'), /Unknown bone/);
});

test('existing rigs share validated skeleton data while skin overrides remain independent', () => {
  const source = new Rig({
    ...definition,
    slots: [{ id: 'visual', bone: 'hand' }],
    attachments: [{ id: 'art', texture: 'hand' }],
    skins: [{ version: 1, name: 'default', slots: { visual: null } }],
  });
  const skins = [{ version: 1 as const, name: 'default', slots: { visual: 'art' } }];
  const parse = vi.spyOn(rigDefinitionSchema, 'parse');
  try {
    const copy = new Rig(source);
    const preview = new Rig(source, skins);
    assert.equal(parse.mock.calls.length, 0);
    for (const rig of [copy, preview]) {
      assert.strictEqual(rig.bones, source.bones);
      assert.strictEqual(rig.slots, source.slots);
      assert.strictEqual(rig.attachments, source.attachments);
      assert.strictEqual(rig.renderOrder, source.renderOrder);
      assert.strictEqual(rig.getBone('hand'), source.getBone('hand'));
      assert.strictEqual(rig.getSlot('visual'), source.getSlot('visual'));
      assert.strictEqual(rig.getAttachment('art'), source.getAttachment('art'));
    }
    assert.strictEqual(copy.skins, source.skins);
    skins[0]!.slots.visual = 'changed';
    assert.equal(preview.skins[0]!.slots.visual, 'art');
    assert.isTrue(Object.isFrozen(preview.skins[0]!.slots));
    assert.isNull(source.skins[0]!.slots.visual);
    assert.throws(() => new Rig(source, [{ version: 1, name: 'bad', slots: { missing: 'art' } }]), /unknown slot/i);
    assert.throws(
      () => new Rig(source, [{ version: 1, name: 'bad', slots: { visual: 'missing' } }]),
      /unknown attachment/i,
    );
    assert.throws(() => new Rig(source, [{ version: 1, name: '', slots: {} }]));
    const duplicate = { version: 1 as const, name: 'same', slots: {} };
    assert.throws(() => new Rig(source, [duplicate, duplicate]), /Duplicate skin/);
  } finally {
    parse.mockRestore();
  }
});

test('rig rejects missing roots, duplicate ids, missing parents, extra roots and cycles', () => {
  assert.throws(() => new Rig({ root: 'missing', bones: [{ id: 'root' }] }), /Unknown bone/);
  assert.throws(() => new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'root' }] }), /duplicate/);
  assert.throws(
    () => new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'missing' }] }),
    /Unknown parent/,
  );
  assert.throws(() => new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'other' }] }), /needs a parent/);
  assert.throws(
    () =>
      new Rig({ root: 'root', bones: [{ id: 'root' }, { id: 'arm', parent: 'hand' }, { id: 'hand', parent: 'arm' }] }),
    /cycle/,
  );
  assert.throws(() => new Rig({ root: 'root', bones: [{ id: 'root', parent: 'root' }] }), /cannot have a parent/);
});

test('rig rejects nonfinite transforms and invalid sprite origins', () => {
  assert.throws(() => new Rig({ root: 'root', bones: [{ id: 'root', x: NaN }] }), /finite/);
  assert.throws(
    () => new Rig({ root: 'root', bones: [{ id: 'root', sprite: { texture: 'part', originX: 2 } }] }),
    /between/,
  );
});

test('animation interpolates all five properties independently across sparse keys', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'pose',
    duration: 1000,
    loop: false,
    tracks: {
      arm: [
        { time: 0, rotation: 0, x: 10, y: 20, scaleX: 1, scaleY: 1 },
        { time: 500, x: 20 },
        { time: 1000, rotation: 2, x: 30, y: 40, scaleX: 3, scaleY: 0.5 },
      ],
    },
  });
  player.play('pose');
  player.update(500);
  assert.deepEqual(joints.get('arm')!.pose, { x: 20, y: 30, rotation: 1, scaleX: 2, scaleY: 0.75 });
  assert.strictEqual(joints.get('hand')!.pose.rotation, 0.2);
  player.sample(250);
  assert.strictEqual(joints.get('arm')!.pose.rotation, 0.5);
  assert.strictEqual(player.elapsedTime, 500);
});

test('looping handles large deltas, stopping freezes time and replay/restart begins at zero', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'loop',
    duration: 1000,
    loop: true,
    tracks: {
      arm: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 1 },
      ],
    },
  });
  player.play('loop');
  player.update(2250);
  assert.strictEqual(player.elapsedTime, 250);
  assert.strictEqual(joints.get('arm')!.pose.rotation, 0.25);
  player.stop();
  player.update(200);
  assert.strictEqual(player.elapsedTime, 250);
  assert.strictEqual(player.isPlaying, false);
  player.restart();
  assert.strictEqual(player.elapsedTime, 0);
  assert.strictEqual(player.isPlaying, true);
  player.update(250);
  player.play('loop');
  assert.strictEqual(player.elapsedTime, 0);
  player.update(1000);
  assert.strictEqual(player.elapsedTime, 0);
});

test('nonlooping clips hold their exact final pose and stop', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'once',
    duration: 100,
    loop: false,
    tracks: {
      hand: [
        { time: 0, rotation: 0 },
        { time: 100, rotation: 1 },
      ],
    },
  });
  player.play('once');
  player.update(150);
  assert.strictEqual(player.elapsedTime, 100);
  assert.strictEqual(player.isPlaying, false);
  assert.strictEqual(joints.get('hand')!.pose.rotation, 1);
  player.update(100);
  assert.strictEqual(joints.get('hand')!.pose.rotation, 1);
});

test('switching clips resets untracked properties and bones to the bind pose', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'stretch',
    duration: 100,
    loop: true,
    tracks: {
      arm: [{ time: 0, scaleX: 2, x: 99 }],
      hand: [{ time: 0, rotation: 1 }],
    },
  });
  player.addAnimation({
    name: 'rest',
    duration: 100,
    loop: true,
    tracks: {
      arm: [{ time: 0, rotation: 0.1 }],
    },
  });
  player.play('stretch');
  player.play('rest');
  assert.strictEqual(joints.get('arm')!.pose.scaleX, 1);
  assert.strictEqual(joints.get('arm')!.pose.x, 10);
  assert.strictEqual(joints.get('hand')!.pose.rotation, 0.2);
  assert.strictEqual(joints.get('arm')!.pose.rotation, 0.1);
});

test('sampling holds endpoints before the first key and after the last key', () => {
  const { player, joints } = fixture();
  player.addAnimation({
    name: 'hold',
    duration: 1000,
    loop: false,
    tracks: {
      arm: [
        { time: 200, rotation: 0.2 },
        { time: 800, rotation: 0.8 },
      ],
    },
  });
  player.play('hold');
  assert.strictEqual(joints.get('arm')!.pose.rotation, 0.2);
  player.sample(1000);
  assert.strictEqual(joints.get('arm')!.pose.rotation, 0.8);
});

test('clip registration snapshots source keys instead of retaining mutable references', () => {
  const { player, joints } = fixture();
  const keys = [{ time: 0, rotation: 0.2 }];
  player.addAnimation({ name: 'snapshot', duration: 100, loop: true, tracks: { arm: keys } });
  keys[0]!.rotation = 99;
  player.play('snapshot');
  assert.strictEqual(joints.get('arm')!.pose.rotation, 0.2);
});

test('animation validation rejects malformed keys and unknown bones without changing the current clip', () => {
  const { player } = fixture();
  const clip = { name: 'bad', duration: 100, loop: false, tracks: {} };
  assert.throws(() => player.addAnimation({ ...clip, duration: 0 }), /greater than zero/);
  assert.throws(() => player.addAnimation({ ...clip, duration: Infinity }), /finite/);
  assert.throws(() => player.addAnimation({ ...clip, tracks: { missing: [] } }), /Unknown bone/);
  for (const keys of [
    [{ time: -1 }],
    [{ time: 101 }],
    [{ time: NaN }],
    [{ time: 0 }, { time: 0 }],
    [{ time: 50 }, { time: 20 }],
    [{ time: 0, rotation: NaN }],
  ])
    assert.throws(() => player.addAnimation({ ...clip, tracks: { arm: keys } }));
  player.addAnimation({ ...clip, name: 'valid' });
  assert.throws(() => player.addAnimation({ ...clip, name: 'valid' }), /already registered/);
  player.play('valid');
  assert.throws(() => player.play('missing'), /Unknown animation/);
  assert.strictEqual(player.currentAnimation, 'valid');
  assert.throws(() => player.update(-1), /negative/);
  assert.throws(() => player.update(NaN), /finite/);
});
