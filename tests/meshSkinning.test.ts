import { assert, test, vi } from 'vitest';
import { Actor } from '../src/engine/Actor.js';
import * as affineMath from '../src/engine/affineMath.js';
import { localToWorld, worldToLocal } from '../src/engine/affineMath.js';
import { serializeRigDefinition } from '../src/engine/authoredSerialization.js';
import { Bone } from '../src/engine/Bone.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { createRectangleMeshAttachment, meshAttachmentToBindPose } from '../src/engine/meshAttachments.js';
import { boneBindMatrix } from '../src/engine/meshBindPose.js';
import { subdivideMeshEdge } from '../src/engine/meshEditing.js';
import { createMeshSkinBinding, deformMesh, normalizeBoneInfluences } from '../src/engine/meshSkinning.js';
import { Puppet } from '../src/engine/Puppet.js';
import { PuppetRenderer } from '../src/engine/PuppetRenderer.js';
import { Rig } from '../src/engine/Rig.js';
import type { BoneInfluence, MeshAttachmentDefinition, RigDefinition } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const rest: RigDefinition = {
  root: 'root',
  bones: [
    { id: 'root', x: 10, y: 5 },
    { id: 'child', parent: 'root', x: 20 },
  ],
  slots: [{ id: 'cloth', bone: 'root', x: 2, y: 3 }],
};
function mesh(influences?: readonly BoneInfluence[]): MeshAttachmentDefinition {
  const value = createRectangleMeshAttachment(
    { id: 'mesh', texture: 'paper', x: 4, y: -1, originX: 0, originY: 0 },
    { width: 20, height: 10 },
    rest,
  );
  return {
    ...value,
    vertices: value.vertices.map(({ influences: _old, ...vertex }) => ({
      ...vertex,
      ...(influences ? { influences } : {}),
    })),
  };
}
const blend = [
  { boneId: 'root', weight: 0.25 },
  { boneId: 'child', weight: 0.75 },
];

test('inverse bind identity and analytic one/two-bone rotation, translation and parent movement', () => {
  for (const influences of [undefined, [{ boneId: 'child', weight: 1 }], blend]) {
    const value = mesh(influences);
    const binding = createMeshSkinBinding(value, 'cloth');
    const bindMatrices = new Map(
      value.bindPose.bones.map((bone) => [bone.id, boneBindMatrix(value.bindPose, bone.id)]),
    );
    const before = structuredClone(value);
    const buffer: number[] = [];
    assert.strictEqual(
      deformMesh(binding, (id) => bindMatrices.get(id), buffer),
      buffer,
    );
    value.vertices.forEach((vertex, i) => {
      assert.closeTo(buffer[i * 4]!, vertex.x + 16, 1e-10);
      assert.closeTo(buffer[i * 4 + 1]!, vertex.y + 7, 1e-10);
      assert.equal(buffer[i * 4 + 2], vertex.u);
      assert.equal(buffer[i * 4 + 3], vertex.v);
    });
    // root T(100,50)R(90); child T(30,0)R(-90) relative to root.
    const posed = new Map([
      ['root', { a: 0, b: 1, c: -1, d: 0, tx: 100, ty: 50 }],
      ['child', { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 80 }],
    ]);
    deformMesh(binding, (id) => posed.get(id), buffer);
    const expected =
      influences === undefined ? { x: 98, y: 56 } : influences.length === 1 ? { x: 86, y: 82 } : { x: 89, y: 75.5 };
    assert.closeTo(buffer[0]!, expected.x, 1e-10);
    assert.closeTo(buffer[1]!, expected.y, 1e-10);
    deformMesh(binding, (id) => bindMatrices.get(id), buffer);
    assert.closeTo(buffer[0]!, 16, 1e-10);
    assert.deepEqual(value, before);
  }
});

test('accepted weight roundoff is normalized in the binding cache without changing authored weights', () => {
  const value = mesh([
    { boneId: 'root', weight: 0.25 },
    { boneId: 'child', weight: 0.750000005 },
  ]);
  assert.doesNotThrow(() => new Rig({ ...rest, attachments: [value] }));
  const binding = createMeshSkinBinding(value, 'cloth');
  const buffer = deformMesh(binding, (id) => boneBindMatrix(value.bindPose, id));
  assert.closeTo(buffer[0]!, 16, 1e-12);
  assert.closeTo(buffer[1]!, 7, 1e-12);
  assert.equal(value.vertices[0]!.influences![1]!.weight, 0.750000005);
});

test('normalization is explicit, bounded and stable even for large finite input weights', () => {
  assert.deepEqual(
    normalizeBoneInfluences([
      { boneId: 'root', weight: 2 },
      { boneId: 'child', weight: 6 },
    ]),
    blend,
  );
  assert.deepEqual(
    normalizeBoneInfluences([
      { boneId: 'root', weight: 1e308 },
      { boneId: 'child', weight: 1e308 },
    ]),
    [
      { boneId: 'root', weight: 0.5 },
      { boneId: 'child', weight: 0.5 },
    ],
  );
  for (const weights of [
    [],
    [{ boneId: 'root', weight: 0 }],
    [{ boneId: 'root', weight: -1 }],
    [{ boneId: 'root', weight: Infinity }],
    [{ boneId: 'root', weight: NaN }],
    [
      { boneId: 'root', weight: 1 },
      { boneId: 'root', weight: 1 },
    ],
  ])
    assert.throws(() => normalizeBoneInfluences(weights));
});

test('rig parsing rejects invalid weights and missing bones; weights survive canonical serialization', () => {
  const value = mesh(blend);
  const file = { version: 1 as const, ...rest, attachments: [value] };
  assert.deepEqual(parseRigDefinition(JSON.parse(serializeRigDefinition(file))).attachments, [value]);
  const invalid = [
    [],
    [{ boneId: 'absent', weight: 1 }],
    [{ boneId: 'root', weight: -1 }],
    [{ boneId: 'root', weight: NaN }],
    [{ boneId: 'root', weight: Infinity }],
    [{ boneId: 'root', weight: 0 }],
    [{ boneId: 'root', weight: 0.5 }],
    [
      { boneId: 'root', weight: 0.5 },
      { boneId: 'root', weight: 0.5 },
    ],
    Array.from({ length: 5 }, (_, i) => ({ boneId: `bone-${i}`, weight: 0.2 })),
  ];
  for (const influences of invalid) assert.throws(() => new Rig({ ...file, attachments: [mesh(influences)] }));
  assert.throws(
    () => createRectangleMeshAttachment({ id: 'bad', texture: 'paper' }, { width: 2, height: 2 }, rest, 'absent'),
    /influence bone/,
  );
});

test('subdivision interpolates weights and retains the four strongest influences deterministically', () => {
  const rig = {
    ...rest,
    bones: [...rest.bones, ...Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, parent: 'root' }))],
  };
  let value = createRectangleMeshAttachment({ id: 'mesh', texture: 'paper' }, { width: 20, height: 10 }, rig);
  value = {
    ...value,
    vertices: value.vertices.map((vertex, i) => ({
      ...vertex,
      influences:
        i === 0
          ? [
              { boneId: 'b0', weight: 0.4 },
              { boneId: 'b1', weight: 0.3 },
              { boneId: 'b2', weight: 0.2 },
              { boneId: 'b3', weight: 0.1 },
            ]
          : [
              { boneId: 'root', weight: 0.4 },
              { boneId: 'child', weight: 0.3 },
              { boneId: 'b4', weight: 0.2 },
              { boneId: 'b5', weight: 0.1 },
            ],
    })),
  };
  const weights = subdivideMeshEdge(value, 0, 1, rig).vertices[4]!.influences!;
  assert.deepEqual(
    weights.map((entry) => entry.boneId),
    ['b0', 'root', 'b1', 'child'],
  );
  assert.closeTo(
    weights.reduce((sum, entry) => sum + entry.weight, 0),
    1,
    1e-12,
  );
});

function runtime(withIK = false) {
  const rig: RigDefinition = {
    ...(withIK ? { ik: [{ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'tip' }] } : {}),
    root: 'root',
    bones: [
      { id: 'root', x: 7, y: -2 },
      { id: 'upper', parent: 'root' },
      { id: 'lower', parent: 'upper', x: 20 },
      { id: 'tip', parent: 'lower', x: 20 },
    ],
    slots: [
      { id: 'cloth', bone: 'upper', x: 3, y: 2, rotation: 0.2, scaleX: -1.2, scaleY: 0.8 },
      { id: 'second', bone: 'lower', depth: -2 },
      { id: 'rigid', bone: 'tip', depth: 15 },
    ],
  };
  const initial = createRectangleMeshAttachment(
    { id: 'mesh', texture: 'paper', x: 4, y: -3, rotation: 0.15 },
    { width: 20, height: 10 },
    rig,
    'upper',
  );
  const weighted = {
    ...initial,
    vertices: initial.vertices.map((vertex) => ({
      ...vertex,
      influences: [
        { boneId: 'upper', weight: 0.3 },
        { boneId: 'lower', weight: 0.7 },
      ],
    })),
  };
  const scene = puppetScene();
  const puppet = new Puppet(scene, {
    autoUpdate: false,
    x: 100,
    y: -50,
    scale: 1.5,
    rig: {
      ...rig,
      attachments: [weighted, { id: 'sprite', texture: 'paper' }],
      skins: [
        { version: 1, name: 'meshes', slots: { cloth: 'mesh', second: 'mesh', rigid: 'sprite' } },
        { version: 1, name: 'rigid', slots: { cloth: 'sprite', rigid: 'sprite' } },
      ],
    },
    skin: 'meshes',
  });
  return { puppet, weighted, scene };
}

/** Independent expected world point from final live joint matrices, authored binds and immutable vertices. */
function assertRendered(puppet: Puppet, value: MeshAttachmentDefinition, slot: string) {
  const object = puppet.getSlotMesh(slot)!;
  value.vertices.forEach((vertex, index) => {
    const bind = meshAttachmentToBindPose(value, slot, vertex);
    let x = 0,
      y = 0;
    for (const influence of vertex.influences!) {
      const local = worldToLocal(bind, boneBindMatrix(value.bindPose, influence.boneId))!;
      const final = localToWorld(local, puppet.getBone(influence.boneId).container.getWorldTransformMatrix());
      x += final.x * influence.weight;
      y += final.y * influence.weight;
    }
    const actual = localToWorld(
      { x: object.vertices[index * 4]!, y: object.vertices[index * 4 + 1]! },
      object.getWorldTransformMatrix(),
    );
    assert.closeTo(actual.x, x, 1e-8);
    assert.closeTo(actual.y, y, 1e-8);
    assert.equal(object.vertices[index * 4 + 2], vertex.u);
    assert.equal(object.vertices[index * 4 + 3], vertex.v);
  });
}

test.each([
  [1, 1],
  [-1.4, 0.7],
  [0.6, -1.8],
])('mixed multiple meshes follow FK, facing and Actor/world scale (%j)', (scaleX, scaleY) => {
  const { puppet, weighted, scene } = runtime();
  const actor = new Actor({ id: 'actor', puppet });
  const outer = scene.add.container(30, -20).setRotation(0.4).setScale(-0.7, 1.8);
  outer.add(puppet.container);
  Object.assign(puppet.getBone('root').pose, { x: -8, y: 12, rotation: 0.5, scaleX, scaleY });
  Object.assign(puppet.getBone('lower').pose, { x: 30, y: 5, rotation: -0.8 });
  puppet.syncPose();
  const buffer = puppet.getSlotMesh('cloth')!.vertices;
  for (const facing of ['left', 'right'] as const) {
    actor.setPosition(230, 120);
    puppet.setFacing(facing);
    assertRendered(puppet, weighted, 'cloth');
    assertRendered(puppet, weighted, 'second');
  }
  assert.strictEqual(puppet.getSlotMesh('cloth')!.vertices, buffer);
  assert.exists(puppet.getSlotImage('rigid'));
  const branch = puppet.getSlotMesh('second')!.parentContainer.parentContainer.parentContainer;
  assert.equal(branch.depth, -2);
  actor.dispose();
  puppet.destroy();
});

test('weighted updates invert each owning transform once and retain each vertex buffer', () => {
  const { puppet, weighted } = runtime();
  const slots = ['cloth', 'second'];
  const buffers = slots.map((slot) => puppet.getSlotMesh(slot)!.vertices);
  const invert = vi.spyOn(affineMath, 'invertAffine');
  const convertPoint = vi.spyOn(affineMath, 'worldToLocal');
  try {
    for (const rotation of [0.6, -0.4]) {
      invert.mockClear();
      Object.assign(puppet.getBone('root').pose, { rotation, scaleX: -1.4, scaleY: 0.7 });
      puppet.getBone('lower').pose.rotation = -rotation;
      puppet.syncPose();
      assert.equal(invert.mock.calls.length, slots.length);
      assert.equal(convertPoint.mock.calls.length, 0);
    }
  } finally {
    invert.mockRestore();
    convertPoint.mockRestore();
  }
  slots.forEach((slot, index) => {
    assert.strictEqual(puppet.getSlotMesh(slot)!.vertices, buffers[index]);
    assertRendered(puppet, weighted, slot);
  });
  puppet.destroy();
});

test('legacy unweighted geometry follows each assigned slot bone without changing stored local positions', () => {
  const { puppet, weighted } = runtime();
  const legacy = { ...weighted, vertices: weighted.vertices.map(({ influences: _weights, ...vertex }) => vertex) };
  puppet.updateSlotDefinitions([legacy, { id: 'sprite', texture: 'paper' }], puppet.rig.skins);
  Object.assign(puppet.getBone('root').pose, { rotation: 0.3, x: 20 });
  Object.assign(puppet.getBone('lower').pose, { rotation: -0.8, y: 15 });
  puppet.syncPose();
  const local = legacy.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.u, vertex.v]);
  assert.deepEqual(puppet.getSlotMesh('cloth')!.vertices, local);
  assert.deepEqual(puppet.getSlotMesh('second')!.vertices, local);
  puppet.destroy();
});

test('final IK and deterministic forward/backward animation sampling deform immutable bind geometry', () => {
  const { puppet, weighted } = runtime(true);
  puppet.addAnimation({
    name: 'pose',
    duration: 1000,
    loop: false,
    tracks: {
      root: [
        { time: 0, x: 7, rotation: 0 },
        { time: 1000, x: 30, rotation: 0.5 },
      ],
    },
    ikTracks: {
      arm: [
        { time: 0, x: 25, y: 20 },
        { time: 1000, x: 15, y: 25 },
      ],
    },
  });
  puppet.play('pose');
  puppet.sampleAnimation(650);
  const snapshot = [...puppet.getSlotMesh('cloth')!.vertices];
  const lower = puppet.getBone('lower').pose.rotation;
  assert.isAbove(Math.abs(lower), 0.1);
  for (const time of [0, 1000, 100, 800, 650]) {
    puppet.sampleAnimation(time);
    assertRendered(puppet, weighted, 'cloth');
  }
  assert.deepEqual(puppet.getSlotMesh('cloth')!.vertices, snapshot);
  puppet.getIK('arm').setTarget(12, 28);
  puppet.syncIK();
  assertRendered(puppet, weighted, 'cloth');
  puppet.destroy();
});

test('root motion applies world placement once, alongside skeletal animation', () => {
  const { puppet, weighted } = runtime();
  puppet.addAnimation({
    name: 'travel',
    duration: 1000,
    loop: false,
    tracks: {
      lower: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 0.6 },
      ],
    },
    rootMotion: {
      translationKeys: [
        { time: 0, x: 0, y: 0 },
        { time: 1000, x: 80, y: 20 },
      ],
    },
  });
  puppet.play('travel', { rootMotion: 'apply' });
  puppet.update(500);
  assert.closeTo(puppet.container.x, 160, 1e-10);
  assert.closeTo(puppet.container.y, -35, 1e-10);
  assertRendered(puppet, weighted, 'cloth');
  assertRendered(puppet, weighted, 'second');
  puppet.destroy();
});

test('skin changes, late assignments, slot transforms and resource disposal preserve textures and presentation', () => {
  const { puppet, weighted, scene } = runtime();
  const old = puppet.getSlotMesh('cloth')!;
  const removeTexture = vi.fn();
  Object.assign(scene.textures, { remove: removeTexture });
  old.setAlpha(0.35).setVisible(false).setDepth(4);
  puppet.getBone('lower').pose.rotation = 0.8;
  puppet.syncPose();
  puppet.setSkin('rigid');
  assert.isTrue(old.isDestroyed);
  puppet.setAttachment('cloth', 'mesh');
  const current = puppet.getSlotMesh('cloth')!;
  assert.equal(current.alpha, 0.35);
  assert.isFalse(current.visible);
  assert.equal(current.depth, 4);
  assertRendered(puppet, weighted, 'cloth');
  const before = [...current.vertices];
  puppet.setSlotTransform('cloth', { x: 20, rotation: -0.4 });
  assert.notDeepEqual(current.vertices, before);
  puppet.setSlotTransform('cloth', { x: 3, rotation: 0.2 });
  assertRendered(puppet, weighted, 'cloth');
  puppet.setSkin('meshes');
  const second = puppet.getSlotMesh('second')!;
  puppet.destroy();
  puppet.destroy();
  assert.isTrue(current.isDestroyed);
  assert.isTrue(second.isDestroyed);
  assert.equal(removeTexture.mock.calls.length, 0);
});

test('render-only mesh previews deform their own sampled pose rather than the source deformed geometry', () => {
  const { puppet, weighted, scene } = runtime();
  const parent = scene.add.container(0, 0);
  const bones = new Map<string, Bone>();
  for (const definition of puppet.rig.bones) {
    const bone = new Bone(scene, definition);
    bones.set(bone.id, bone);
    (definition.parent ? bones.get(definition.parent)!.container : parent).add(bone.container);
  }
  const preview = new PuppetRenderer(scene, parent, puppet.rig, bones);
  puppet.getBone('lower').pose.rotation = 1;
  puppet.syncPose();
  puppet.copyAppearanceTo(preview, 0xabcdef);
  preview.sync();
  const object = preview.getSlotMesh('cloth')!;
  const bind = meshAttachmentToBindPose(weighted, 'cloth', weighted.vertices[0]!);
  const rendered = localToWorld({ x: object.vertices[0]!, y: object.vertices[1]! }, object.getWorldTransformMatrix());
  assert.closeTo(rendered.x, bind.x, 1e-9);
  assert.closeTo(rendered.y, bind.y, 1e-9);
  preview.destroy();
  assert.isTrue(object.isDestroyed);
  puppet.destroy();
});

test('Canvas fails before Puppet allocation, and weighted singular mounts report an explicit diagnostic', () => {
  const scene = puppetScene();
  Object.assign(scene, { sys: { game: { renderer: { type: 1 } } } });
  const allocate = vi.spyOn(scene.add, 'container');
  assert.throws(() => new Puppet(scene, { rig: { ...rest, attachments: [mesh(blend)] } }), /require a WebGL renderer/);
  assert.equal(allocate.mock.calls.length, 0);
  assert.doesNotThrow(() => new Puppet(scene, { autoUpdate: false, rig: rest }).destroy());
  const { puppet } = runtime();
  puppet.getBone('upper').pose.scaleX = 0;
  assert.throws(() => puppet.syncPose(), /nonsingular posed/);
  puppet.destroy();
});
