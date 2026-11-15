import { assert, test, vi } from 'vitest';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { inspectMeshDeformation } from '../src/engine/meshDiagnostics.js';
import { Puppet } from '../src/engine/Puppet.js';
import { productionMesh } from './helpers/productionMesh.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

for (const side of [2, 12, 32]) {
  test(`production ${side * side}-vertex mesh: FK/IK, corrections, independent instances, deterministic seeking and disposal`, () => {
    const { rig, mesh } = productionMesh(side);
    const scene = puppetScene();
    const actors = Array.from(
      { length: 3 },
      (_, index) => new Puppet(scene, { rig, skin: 'default', autoUpdate: false, x: index * 100 }),
    );
    const clip: AnimationClip = {
      name: 'sword-attack',
      duration: 1000,
      loop: false,
      tracks: {
        lower: [
          { time: 0, rotation: 0 },
          { time: 1000, rotation: 1 },
        ],
      },
      deformationTracks: {
        sleeve: [
          { time: 0, offsets: {} },
          { time: 500, offsets: { v0: { x: 2, y: -1 } } },
          { time: 1000, offsets: {} },
        ],
      },
    };
    for (const actor of actors) {
      actor.posePipeline.player.addAnimation(clip);
      actor.play('sword-attack');
    }
    const buffers = actors.map((actor) => actor.getSlotMesh('cloth')!.vertices);
    assert.notStrictEqual(buffers[0], buffers[1]);
    for (const actor of actors) {
      actor.sampleAnimation(500);
    }
    const expected = [...buffers[0]!];
    actors[0]!.setFacing('left');
    for (const time of [1000, 0, 800, 200, 500]) {
      actors[0]!.sampleAnimation(time);
      assert.isTrue(buffers[0]!.every(Number.isFinite));
    }
    assert.deepEqual(buffers[0], expected);
    assert.deepEqual(buffers[1], expected);
    assert.deepEqual(buffers[2], expected);
    assert.strictEqual(actors[0]!.getSlotMesh('cloth')!.vertices, buffers[0]);
    assert.isArray(inspectMeshDeformation(mesh, buffers[0]!));
    const objects = actors.map((actor) => actor.getSlotMesh('cloth')!);
    for (const actor of actors) {
      actor.destroy();
      actor.destroy();
    }
    assert.isTrue(objects.every((object) => object.isDestroyed));
  });
}

test('long hair, cape and clothing coexist with rigid artwork and corrections remain attachment-specific', () => {
  const { attachments: _attachments, skins: _skins, ...base } = productionMesh(2).rig;
  const rest = {
    ...base,
    slots: [
      { id: 'hair', bone: 'upper' },
      { id: 'cape', bone: 'root' },
      { id: 'sleeve', bone: 'lower' },
      { id: 'rigid', bone: 'root' },
    ],
  };
  const attachments = [
    ['hair', 20, 150],
    ['cape', 100, 140],
    ['sleeve', 80, 40],
  ].map(([id, width, height]) => {
    const value = createRectangleMeshAttachment(
      { id: String(id), texture: 'paper' },
      { width: Number(width), height: Number(height) },
      rest,
      'upper',
    );
    return {
      ...value,
      vertices: value.vertices.map((v) => ({
        ...v,
        influences: [
          { boneId: 'upper', weight: 0.4 },
          { boneId: 'lower', weight: 0.6 },
        ],
      })),
    };
  });
  const rig = {
    ...rest,
    attachments: [...attachments, { id: 'rigid', texture: 'paper' }],
    skins: [
      { version: 1 as const, name: 'default', slots: { hair: 'hair', cape: 'cape', sleeve: 'sleeve', rigid: 'rigid' } },
    ],
  };
  const puppet = new Puppet(puppetScene(), { rig, autoUpdate: false, skin: 'default' });
  const before = new Map(['hair', 'cape', 'sleeve'].map((id) => [id, [...puppet.getSlotMesh(id)!.vertices]]));
  puppet.attachPoseSource({ meshDeformation: new Map([['sleeve', new Map([['top-left', { x: 3, y: -2 }]])]]) });
  puppet.posePipeline.syncPose();
  assert.deepEqual(puppet.getSlotMesh('hair')!.vertices, before.get('hair'));
  assert.deepEqual(puppet.getSlotMesh('cape')!.vertices, before.get('cape'));
  assert.notDeepEqual(puppet.getSlotMesh('sleeve')!.vertices, before.get('sleeve'));
  const malformed = structuredClone(rig);
  malformed.attachments[1] = { ...attachments[1]!, triangles: [0, 1, 999] };
  assert.throws(() => new Puppet(puppetScene(), { rig: malformed }), /vertex|index/);
  assert.deepEqual(puppet.getSlotMesh('hair')!.vertices, before.get('hair'));
  puppet.destroy();
});
