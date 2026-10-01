import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { Joint } from '../src/engine/Joint.js';
import type { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import type { RigDefinition } from '../src/engine/types.js';

vi.mock('phaser', () => ({ default: {} }));

function fixture(definition: RigDefinition) {
  const rig = new Rig(definition);
  const joints = new Map(rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const puppet = {
    rig,
    getBone: (id: string) => joints.get(id)!,
    preparePose: vi.fn(),
    syncPose: vi.fn(),
    setRenderOrder: vi.fn(),
  };
  const editor = new RigEditor({} as Phaser.Scene, puppet as unknown as Puppet, vi.fn());
  const assertReloadMatchesPreview = () => {
    const loaded = parseRigDefinition(JSON.parse(editor.exportJson(false)));
    for (const bone of loaded.bones) {
      const expected = new Joint(bone.id, bone).pose;
      const preview = joints.get(bone.id)!.pose;
      for (const field of ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const)
        assert.closeTo(preview[field], expected[field], 1e-6, `${bone.id}.${field}`);
    }
    assert.deepEqual(puppet.setRenderOrder.mock.lastCall?.[0], loaded.renderOrder);
  };
  return { editor, joints, assertReloadMatchesPreview };
}

test('edited child preview respects parent length and matches export reload through undo and redo', () => {
  const { editor, joints, assertReloadMatchesPreview } = fixture({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'arm', parent: 'root', length: 20 }, { id: 'hand', parent: 'arm', y: 20 }],
  });

  editor.editBone('hand', 'y', 30);
  assert.equal(joints.get('hand')!.pose.y, 20);
  assertReloadMatchesPreview();

  editor.editBone('hand', 'x', 40);
  assert.closeTo(joints.get('hand')!.pose.x, 16, 1e-12);
  assert.closeTo(joints.get('hand')!.pose.y, 12, 1e-12);
  assertReloadMatchesPreview();

  editor.editBone('hand', 'rotation', 0.25);
  editor.editBone('hand', 'scaleX', 1.5);
  editor.editBone('arm', 'length', 35);
  assert.closeTo(Math.hypot(joints.get('hand')!.pose.x, joints.get('hand')!.pose.y), 35, 1e-12);
  assertReloadMatchesPreview();

  editor.undo();
  assert.closeTo(Math.hypot(joints.get('hand')!.pose.x, joints.get('hand')!.pose.y), 20, 1e-12);
  assertReloadMatchesPreview();
  editor.redo();
  assertReloadMatchesPreview();
  editor.resetRig();
  assert.equal(joints.get('hand')!.pose.y, 20);
  assertReloadMatchesPreview();
});

test('preview shares runtime rules for zero offsets, zero length, roots and unconstrained children', () => {
  const { editor, joints, assertReloadMatchesPreview } = fixture({
    root: 'root',
    bones: [
      { id: 'root', length: 20 },
      { id: 'arm', parent: 'root' },
      { id: 'hand', parent: 'arm', y: 5 },
    ],
  });

  editor.editBone('arm', 'y', 0);
  assert.equal(joints.get('arm')!.pose.y, 20);
  editor.editBone('hand', 'y', 30);
  assert.equal(joints.get('hand')!.pose.y, 30);
  editor.editBone('root', 'x', 10);
  assert.equal(joints.get('root')!.pose.x, 10);
  assertReloadMatchesPreview();

  editor.editBone('root', 'length', 0);
  editor.editBone('arm', 'x', 30);
  editor.editBone('arm', 'y', 40);
  assert.equal(joints.get('arm')!.pose.x, 0);
  assert.equal(joints.get('arm')!.pose.y, 0);
  assertReloadMatchesPreview();
});
