import { afterEach, assert, test, vi } from 'vitest';
import { Actor } from '../src/engine/Actor.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const puppets: Puppet[] = [];
afterEach(() => {
  for (const puppet of puppets.splice(0)) puppet.destroy();
  vi.restoreAllMocks();
});

function fixture() {
  const scene = puppetScene();
  const animation: AnimationClip = {
    name: 'reach',
    duration: 1000,
    loop: true,
    tracks: {
      root: [
        { time: 0, rotation: 0.1 },
        { time: 1000, rotation: 0.3 },
      ],
    },
    ikTracks: {
      chain: [
        { time: 0, x: 8, y: 12, mix: 1 },
        { time: 1000, x: 12, y: 8, mix: 1 },
      ],
    },
  };
  const puppet = new Puppet(scene, {
    autoUpdate: false,
    x: 100,
    y: 200,
    rig: {
      root: 'root',
      bones: [{ id: 'root' }, { id: 'middle', parent: 'root', y: 10 }, { id: 'end', parent: 'middle', y: 10 }],
      slots: [{ id: 'hand', bone: 'end', x: 2, y: 1 }],
      attachments: [{ id: 'weapon', texture: 'weapon-art', x: 1 }],
      skins: [{ version: 1, name: 'default', slots: { hand: 'weapon' } }],
      ik: [{ name: 'chain', rootBone: 'root', middleBone: 'middle', endBone: 'end' }],
    },
    skin: 'default',
    animations: [animation],
  });
  puppets.push(puppet);
  return { scene, puppet, actor: new Actor({ id: 'actor', puppet }), animation };
}

test('explicit facing delegates to Puppet, preserves scale magnitude and exposes external changes', () => {
  const { actor, puppet } = fixture();
  puppet.container.setScale(2, 3);
  assert.strictEqual(actor.faceLeft(), actor);
  assert.equal(actor.facingDirection, 'left');
  assert.equal(puppet.container.scaleX, -2);
  assert.strictEqual(actor.faceRight(), actor);
  assert.equal(actor.facingDirection, 'right');
  assert.equal(puppet.container.scaleX, 2);
  assert.equal(puppet.container.scaleY, 3);
  puppet.setFacing('left');
  assert.equal(actor.facingDirection, 'left');
});

test('point targets use horizontal world position, preserve ties and avoid redundant pose synchronization', () => {
  const { actor, puppet } = fixture();
  const setFacing = vi.spyOn(puppet, 'setFacing');
  assert.strictEqual(actor.lookAt({ x: 90, y: 900 }), actor);
  assert.equal(actor.facingDirection, 'left');
  actor.lookAt({ x: 0, y: -900 });
  actor.lookAt({ x: 100, y: 200 });
  actor.lookAt({ x: 100, y: 900 });
  actor.lookAt({ x: 100 + 1e-10, y: 900 });
  assert.equal(actor.facingDirection, 'left');
  assert.equal(setFacing.mock.calls.length, 1);
  actor.lookAt({ x: 110, y: 0 });
  assert.equal(actor.facingDirection, 'right');
  actor.lookAt({ x: 100, y: 0 });
  assert.equal(actor.facingDirection, 'right');
});

test('Actor targets sample their current world origin once, independently of bone animation', () => {
  const source = fixture();
  const target = fixture();
  target.actor.setPosition(50, 200).play('reach');
  target.puppet.update(500);
  source.actor.lookAt(target.actor);
  assert.equal(source.actor.facingDirection, 'left');
  target.actor.setPosition(150, 200);
  source.puppet.update(500);
  assert.equal(source.actor.facingDirection, 'left', 'No retained target or continuous tracking.');
  source.actor.lookAt(target.actor);
  assert.equal(source.actor.facingDirection, 'right');
});

test('world snapshots and targeting include separate nested scaled/rotated parents', () => {
  const source = fixture();
  const target = fixture();
  const outer = source.scene.add.container(500, 100).setScale(2, 3);
  outer.add(
    source.scene.add
      .container(10, 20)
      .setRotation(Math.PI / 6)
      .add(source.puppet.container),
  );
  target.scene.add.container(-1000, 0).setScale(2).add(target.puppet.container);
  assert.deepEqual(source.actor.position, { x: 100, y: 200 });
  const matrix = source.puppet.container.getWorldTransformMatrix();
  const snapshot = source.actor.worldPosition;
  assert.deepEqual(snapshot, { x: matrix.tx, y: matrix.ty });
  assert.isTrue(Object.isFrozen(snapshot));
  assert.isFalse(Reflect.set(snapshot, 'x', -999));
  source.actor.lookAt(target.actor);
  assert.equal(source.actor.facingDirection, 'left', 'Equal local x values have different world x positions.');
  source.actor.lookAt({ x: snapshot.x + 1, y: snapshot.y });
  assert.equal(source.actor.facingDirection, 'right');
  assert.deepEqual(source.actor.worldPosition, snapshot);
});

test('reflected parents reverse the supported mirror; vertical/collapsed facing axes preserve it', () => {
  const { scene, actor, puppet } = fixture();
  const parent = scene.add.container(500, 0).setScale(-2, 3).add(puppet.container);
  actor.lookAt({ x: actor.worldPosition.x + 100, y: 0 });
  assert.equal(actor.facingDirection, 'left');
  assert.isAbove(puppet.container.getWorldTransformMatrix().a, 0);
  actor.lookAt({ x: actor.worldPosition.x - 100, y: 0 });
  assert.equal(actor.facingDirection, 'right');
  parent.setScale(1).setRotation(Math.PI / 2);
  actor.lookAt({ x: actor.worldPosition.x - 100, y: 0 });
  assert.equal(actor.facingDirection, 'right');
  parent.setScale(0);
  actor.lookAt({ x: 0, y: 0 });
  assert.equal(actor.facingDirection, 'right');
});

test('self and stale Actor targets preserve facing without reading a dead position', () => {
  const source = fixture();
  const target = fixture();
  source.actor.faceLeft();
  assert.strictEqual(source.actor.lookAt(source.actor), source.actor);
  target.actor.dispose();
  source.actor.lookAt(target.actor);
  assert.equal(source.actor.facingDirection, 'left');
  const destroyed = fixture();
  destroyed.puppet.destroy();
  source.actor.lookAt(destroyed.actor);
  const disposedPlayer = fixture();
  disposedPlayer.puppet.animationPlayer.dispose();
  source.actor.lookAt(disposedPlayer.actor);
  assert.equal(source.actor.facingDirection, 'left');
});

test.each([NaN, Infinity, -Infinity])(
  'invalid target/source coordinate %s rejects without changing facing',
  (value) => {
    const { actor, puppet } = fixture();
    actor.faceLeft();
    assert.throws(() => actor.lookAt({ x: value, y: 0 }), /finite/);
    assert.throws(() => actor.lookAt({ x: 1000, y: value }), /finite/);
    const target = fixture();
    target.puppet.container.x = value;
    assert.throws(() => actor.lookAt(target.actor), /finite/);
    puppet.container.y = value;
    assert.throws(() => actor.lookAt({ x: 1000, y: 0 }), /finite/);
    assert.equal(actor.facingDirection, 'left');
  },
);

test('new facing operations follow the existing disposed-source contract', () => {
  const { actor } = fixture();
  actor.dispose();
  for (const call of [
    () => actor.faceLeft(),
    () => actor.faceRight(),
    () => actor.facingDirection,
    () => actor.worldPosition,
    () => actor.lookAt({ x: 0, y: 0 }),
    () => actor.lookAt(actor),
  ])
    assert.throws(call, /disposed/);
});

test('facing mirrors the outer transform without changing evaluated local animation poses or clocks', () => {
  const { actor, puppet } = fixture();
  puppet.getIK('chain').enabled = false;
  actor.play('reach');
  puppet.update(500);
  const poses = puppet.rig.bones.map(({ id }) => ({ ...puppet.getBone(id).pose }));
  const playback = puppet.getPlaybackStatus();
  actor.faceLeft().faceRight().lookAt({ x: 0, y: 0 });
  assert.deepEqual(
    puppet.rig.bones.map(({ id }) => ({ ...puppet.getBone(id).pose })),
    poses,
  );
  assert.deepEqual(puppet.getPlaybackStatus(), playback);
  assert.deepEqual(actor.position, { x: 100, y: 200 });
  assert.equal(puppet.container.rotation, 0);
});

test.each(['world', 'authored'] as const)(
  'facing preserves %s IK, weapon mounts, hierarchy and authored data',
  (mode) => {
    const { actor, puppet, scene, animation } = fixture();
    const before = JSON.stringify(animation);
    const rigBefore = JSON.stringify(puppet.rig);
    const parents = puppet.rig.bones.map(({ id }) => puppet.getBone(id).container.parentContainer);
    actor.play('reach');
    puppet.update(500);
    const target = { x: 108, y: 212 };
    if (mode === 'world') puppet.setIKTarget('chain', target);
    puppet.getIK('chain').enabled = true;
    const weapon = scene.add.container();
    puppet.attachToSlot('hand', weapon, { x: 3, y: 4 });
    const mount = weapon.parentContainer;
    const image = puppet.getSlotImage('hand');
    for (const facing of ['left', 'right', 'left', 'right'] as const) {
      actor.lookAt({ x: facing === 'left' ? 0 : 200, y: 200 });
      const end = puppet.getBone('end').container.getWorldTransformMatrix();
      const expected = mode === 'world' ? target : puppet.container.getWorldTransformMatrix().transformPoint(10, 10);
      assert.closeTo(end.tx, expected.x, 1e-8);
      assert.closeTo(end.ty, expected.y, 1e-8);
      const prop = weapon.getWorldTransformMatrix();
      const grip = end.transformPoint(5, 5);
      assert.closeTo(prop.tx, grip.x, 1e-8);
      assert.closeTo(prop.ty, grip.y, 1e-8);
      assert.strictEqual(weapon.parentContainer, mount);
      assert.strictEqual(puppet.getSlotImage('hand'), image);
      assert.equal(puppet.getAttachment('hand'), 'weapon');
      assert.deepEqual(
        puppet.rig.bones.map(({ id }) => puppet.getBone(id).container.parentContainer),
        parents,
      );
      assert.equal(puppet.animationPlayer.elapsedTime, 500);
    }
    assert.equal(JSON.stringify(animation), before);
    assert.equal(JSON.stringify(puppet.rig), rigBefore);
  },
);
