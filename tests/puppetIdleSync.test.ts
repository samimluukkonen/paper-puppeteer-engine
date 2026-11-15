import { afterEach, assert, test, vi } from 'vitest';
import { Bone } from '../src/engine/Bone.js';
import type { IKAnimationValues } from '../src/engine/ik/AnimationIKPose.js';
import { IKDebug } from '../src/engine/ik/IKDebug.js';
import type { MeshVertexOffsets } from '../src/engine/meshDeformation.js';
import { Puppet, type PuppetOptions } from '../src/engine/Puppet.js';
import { PuppetDebug } from '../src/engine/PuppetDebug.js';
import { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
import { SlotDebug } from '../src/engine/SlotDebug.js';
import { productionMesh } from './helpers/productionMesh.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.restoreAllMocks());

function fixture(idleSync?: PuppetOptions['idleSync']) {
  const puppet = new Puppet(puppetScene(), {
    rig: productionMesh(2).rig,
    skin: 'default',
    autoUpdate: false,
    ...(idleSync === undefined ? {} : { idleSync }),
  });
  puppet.update(0);
  return puppet;
}

test('dirty idle puppets skip bones, rendering, IK, meshes and debug while still delivering update callbacks', () => {
  const puppet = fixture('dirty');
  const debug = [PuppetDebug, IKDebug, SlotDebug].map((view) =>
    vi.spyOn(view.prototype, 'update').mockImplementation(() => {}),
  );
  puppet.setDebug(true).setIKDebug(true).setSlotDebug(true);
  puppet.syncPose();
  for (const update of debug) update.mockClear();
  const bones = vi.spyOn(Bone.prototype, 'syncTransform');
  const rendering = vi.spyOn(PuppetRenderer.prototype, 'sync');
  const meshes = vi.spyOn(PuppetRenderer.prototype, 'syncMeshes');
  const ik = vi.spyOn(puppet.getIK('arm'), 'apply');
  const listener = vi.fn();
  puppet.onUpdate(listener);
  const vertices = [...puppet.getSlotMesh('cloth')!.vertices];
  for (let frame = 0; frame < 120; frame++) puppet.update(16);
  assert.equal(bones.mock.calls.length, 0);
  assert.equal(rendering.mock.calls.length, 0);
  assert.equal(meshes.mock.calls.length, 0);
  assert.equal(ik.mock.calls.length, 0);
  for (const update of debug) assert.equal(update.mock.calls.length, 0);
  assert.equal(listener.mock.calls.length, 120);
  assert.deepEqual(puppet.getSlotMesh('cloth')!.vertices, vertices);
  puppet.destroy();
});

test('direct edits opt into one coalesced synchronization and explicit syncPose consumes pending work', () => {
  const puppet = fixture('dirty');
  const vertices = [...puppet.getSlotMesh('cloth')!.vertices];
  const rendering = vi.spyOn(PuppetRenderer.prototype, 'sync');
  puppet.getIK('arm').enabled = false;
  puppet.getBone('lower').pose.x = 60;
  assert.strictEqual(puppet.markPoseDirty().markPoseDirty(), puppet);
  puppet.update(16);
  assert.equal(puppet.getBone('lower').container.x, 60);
  assert.notDeepEqual(puppet.getSlotMesh('cloth')!.vertices, vertices);
  puppet.update(16);
  assert.equal(rendering.mock.calls.length, 1);
  puppet.getBone('lower').pose.x = 50;
  puppet.markPoseDirty().syncPose();
  assert.equal(puppet.getBone('lower').container.x, 50);
  puppet.update(16);
  assert.equal(rendering.mock.calls.length, 2);
  puppet.destroy();
});

test('default idle synchronization retains directly mutable poses and procedural targets', () => {
  const puppet = fixture();
  puppet.getBone('lower').pose.x = 50;
  puppet.update(16);
  assert.equal(puppet.getBone('lower').container.x, 50);
  let x = 40;
  const provider = vi.fn(() => ({ x: ++x, y: 20 }));
  puppet.getIK('arm').setTargetProvider(provider);
  puppet.update(16);
  puppet.update(16);
  assert.equal(provider.mock.calls.length, 2);
  assert.deepEqual(puppet.getIK('arm').resolvedTarget, { x: 42, y: 20 });
  puppet.destroy();
});

test('dirty mode keeps polling target providers, including providers returning no target and paused animation', () => {
  const puppet = fixture('dirty');
  puppet.addAnimation({ name: 'held', duration: 100, loop: true, tracks: {} }).play('held').pauseAnimation();
  const provider = vi.fn<() => { x: number; y: number } | undefined>();
  provider.mockReturnValueOnce(undefined).mockReturnValue({ x: 40, y: 20 });
  const constraint = puppet.getIK('arm').setTargetProvider(provider);
  puppet.update(16);
  assert.isUndefined(constraint.resolvedTarget);
  puppet.update(16);
  assert.deepEqual(constraint.resolvedTarget, { x: 40, y: 20 });
  assert.equal(provider.mock.calls.length, 2);
  puppet.destroy();
});

test.each(['paused', 'stopped', 'completed'] as const)(
  'dirty mode sleeps after %s playback and wakes for edits',
  (state) => {
    const puppet = fixture('dirty');
    puppet.addAnimation({
      name: 'move',
      duration: 100,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 100, x: 20 },
        ],
      },
      events: [
        { time: 0, name: 'start' },
        { time: 100, name: 'end' },
      ],
    });
    const observed: number[] = [];
    puppet.onAnimationEvent(() => observed.push(puppet.getBone('root').container.x));
    puppet.play('move');
    puppet.update(50);
    assert.equal(puppet.getBone('root').container.x, 10);
    if (state === 'paused') puppet.pauseAnimation();
    else if (state === 'stopped') puppet.stop();
    else puppet.update(50);
    assert.deepEqual(observed, state === 'completed' ? [0, 20] : [0]);
    const rendering = vi.spyOn(PuppetRenderer.prototype, 'sync');
    puppet.update(16);
    assert.equal(rendering.mock.calls.length, 0);
    puppet.getBone('root').pose.x = 30;
    puppet.markPoseDirty().update(16);
    assert.equal(puppet.getBone('root').container.x, 30);
    puppet.update(16);
    assert.equal(rendering.mock.calls.length, 1);
    puppet.restart();
    assert.equal(puppet.getBone('root').container.x, 0);
    puppet.destroy();
  },
);

test('Puppet target and batched slot APIs invalidate idle synchronization', () => {
  const puppet = fixture('dirty');
  const rendering = vi.spyOn(PuppetRenderer.prototype, 'sync');
  puppet.setIKTarget('arm', 40, 30);
  puppet.setSlotTransform('cloth', { x: 5 }, false);
  puppet.update(16);
  assert.deepEqual(puppet.getIK('arm').resolvedTarget, { x: 40, y: 30 });
  assert.equal(rendering.mock.calls.length, 1);
  puppet.update(16);
  assert.equal(rendering.mock.calls.length, 1);
  puppet.setBoneRotation('root', 0.5);
  assert.closeTo(puppet.getBone('root').container.rotation, 0.5, 1e-10);
  puppet.update(16);
  assert.equal(rendering.mock.calls.length, 2, 'an immediate setter consumes its own invalidation');
  puppet.destroy();
});

test('IK-only synchronization does not consume pending full pose edits', () => {
  const puppet = fixture('dirty');
  puppet.preparePose();
  puppet.getBone('root').pose.x = 12;
  puppet.syncIK();
  puppet.update(16);
  assert.equal(puppet.getBone('root').container.x, 12);
  puppet.destroy();
});

test('failed explicit synchronization is retried on update before returning to sleep', () => {
  const puppet = fixture('dirty');
  const listener = vi.fn();
  puppet.onUpdate(listener);
  const meshes = vi.spyOn(PuppetRenderer.prototype, 'syncMeshes');
  meshes.mockImplementationOnce(() => {
    throw new Error('projection failed');
  });
  assert.throws(() => puppet.syncPose(), /projection failed/);
  puppet.update(16);
  puppet.update(16);
  assert.equal(meshes.mock.calls.length, 2);
  assert.equal(listener.mock.calls.length, 2);
  puppet.markPoseDirty();
  assert.throws(() => puppet.update(-1), /negative/);
  assert.throws(() => puppet.update(NaN), /finite/);
  puppet.update(16);
  assert.equal(meshes.mock.calls.length, 3);
  puppet.destroy();
  assert.doesNotThrow(() => puppet.markPoseDirty().update(16));
});

test('invalidation from an update callback is preserved for the next idle frame', () => {
  const puppet = fixture('dirty');
  const rendering = vi.spyOn(PuppetRenderer.prototype, 'sync');
  const unsubscribe = puppet.onUpdate(() => {
    puppet.getBone('root').pose.x = 12;
    puppet.markPoseDirty();
  });
  puppet.update(16);
  unsubscribe();
  assert.equal(rendering.mock.calls.length, 0);
  puppet.update(16);
  assert.equal(puppet.getBone('root').container.x, 12);
  puppet.update(16);
  assert.equal(rendering.mock.calls.length, 1);
  puppet.destroy();
});

test('invalidation during synchronization survives even when a provider removes itself', () => {
  const puppet = fixture('dirty');
  const constraint = puppet.getIK('arm');
  constraint.setTargetProvider(() => {
    puppet.getBone('root').pose.x = 12;
    puppet.markPoseDirty();
    constraint.setTargetProvider(undefined);
    return undefined;
  });
  puppet.update(16);
  assert.equal(puppet.getBone('root').container.x, 0);
  puppet.update(16);
  assert.equal(puppet.getBone('root').container.x, 12);
  const rendering = vi.spyOn(PuppetRenderer.prototype, 'sync');
  puppet.update(16);
  assert.equal(rendering.mock.calls.length, 0);
  puppet.destroy();
});

test('external pose sources remain live and detaching them restores idle sleep', () => {
  const puppet = fixture('dirty');
  const ik = new Map<string, IKAnimationValues>();
  const detachIK = puppet.attachPoseSource({ ikAnimation: ik });
  puppet.update(16);
  ik.set('arm', { x: { value: 30, weight: 1 }, y: { value: 10, weight: 1 } });
  puppet.update(16);
  // The fixture has an authored target; animation takes ownership when no runtime target is set.
  assert.deepEqual(puppet.getIK('arm').resolvedTarget, { x: 30, y: 10 });
  detachIK();
  puppet.update(16);
  assert.deepEqual(puppet.getIK('arm').resolvedTarget, { x: 65, y: 20 });
  const shapes = new Map<string, MeshVertexOffsets>();
  const detachShapes = puppet.attachPoseSource({ meshDeformation: shapes });
  puppet.update(16);
  const vertices = [...puppet.getSlotMesh('cloth')!.vertices];
  shapes.set('sleeve', new Map([['v0', { x: 5, y: -3 }]]));
  puppet.update(16);
  assert.notDeepEqual(puppet.getSlotMesh('cloth')!.vertices, vertices);
  detachShapes();
  puppet.update(16);
  assert.deepEqual(puppet.getSlotMesh('cloth')!.vertices, vertices);
  const rendering = vi.spyOn(PuppetRenderer.prototype, 'sync');
  puppet.update(16);
  assert.equal(rendering.mock.calls.length, 0);
  puppet.destroy();
});
