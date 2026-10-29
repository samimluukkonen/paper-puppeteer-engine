import { assert, test } from 'vitest';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { boneBindMatrix, createBoneBindResolver, validateMeshBindPose } from '../src/engine/meshBindPose.js';
import type { RigDefinition } from '../src/engine/types.js';

test('bind validation avoids rebuilding the complete bone index for every joint', () => {
  const count = 512;
  const rig: RigDefinition = {
    root: 'root',
    bones: [
      { id: 'root' },
      ...Array.from({ length: count - 1 }, (_, index) => ({
        id: `bone-${index}`,
        parent: 'root',
        x: index,
      })),
    ],
    slots: [{ id: 'art', bone: 'root' }],
  };
  const mesh = createRectangleMeshAttachment({ id: 'mesh', texture: 'paper' }, { width: 20, height: 10 }, rig);
  let reads = 0;
  for (const bone of mesh.bindPose.bones) {
    const id = bone.id;
    Object.defineProperty(bone, 'id', {
      enumerable: true,
      get: () => {
        ++reads;
        return id;
      },
    });
  }
  assert.deepEqual(validateMeshBindPose(mesh, rig), []);
  // Allow sorting and validation overhead, while rejecting a full index rebuild per bone.
  assert.isBelow(reads, count * 64);
});

test('bind resolution supports unordered ancestors and detects missing or cyclic parents', () => {
  const mesh = createRectangleMeshAttachment(
    { id: 'mesh', texture: 'paper' },
    { width: 20, height: 10 },
    {
      root: 'root',
      bones: [
        { id: 'root', x: 2 },
        { id: 'child', parent: 'root', x: 3 },
      ],
    },
  );
  const bind = structuredClone(mesh.bindPose);
  bind.bones = [...bind.bones].reverse();
  const resolve = createBoneBindResolver(bind);
  assert.equal(resolve('child').tx, 5);
  assert.equal(resolve('root').tx, 2);
  assert.throws(() => resolve('missing'), /Missing mesh bind bone/);
  const child = bind.bones.find((bone) => bone.id === 'child')!;
  child.parent = 'child';
  assert.throws(() => createBoneBindResolver(bind)('child'), /cycle/);
  child.parent = 'missing';
  assert.throws(() => createBoneBindResolver(bind)('child'), /Missing mesh bind bone/);
});

test('one-off coordinate queries never retain stale matrices for mutable bind inputs', () => {
  const mesh = createRectangleMeshAttachment(
    { id: 'mesh', texture: 'paper' },
    { width: 20, height: 10 },
    {
      root: 'root',
      bones: [
        { id: 'root', x: 2 },
        { id: 'child', parent: 'root', x: 3 },
      ],
    },
  );
  assert.equal(boneBindMatrix(mesh.bindPose, 'child').tx, 5);
  mesh.bindPose.bones.find((bone) => bone.id === 'root')!.x = 12;
  assert.equal(boneBindMatrix(mesh.bindPose, 'child').tx, 15);
});
