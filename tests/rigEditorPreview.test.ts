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
    setRenderOrder: vi.fn<Puppet['setRenderOrder']>(),
    setSlotTransform: vi.fn(),
    getSlotImage: vi.fn(),
    getSlotMesh: vi.fn(),
    getAttachment: vi.fn(),
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
  return { editor, joints, puppet, assertReloadMatchesPreview };
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

test('presentation changes skip pose work and transform edits preserve cached draw order', () => {
  const { editor, joints, puppet } = fixture({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'arm', parent: 'root' }],
  });
  editor.refresh();
  editor.state.selectBone('arm');
  editor.state.visibility.boneNames = true;
  editor.state.artworkOpacity = 0.5;
  editor.state.gridSnap = 5;
  editor.refresh();
  assert.equal(puppet.preparePose.mock.calls.length, 1);
  assert.equal(puppet.syncPose.mock.calls.length, 1);
  assert.equal(puppet.setRenderOrder.mock.calls.length, 1);

  editor.editBone('arm', 'x', 12);
  assert.equal(joints.get('arm')!.pose.x, 12);
  assert.equal(puppet.syncPose.mock.calls.length, 2);
  assert.equal(puppet.setRenderOrder.mock.calls.length, 1);
  editor.editBone('arm', 'depth', -1);
  assert.deepEqual(puppet.setRenderOrder.mock.lastCall?.[0], ['arm', 'root']);
  assert.equal(puppet.setRenderOrder.mock.calls.length, 2);
  editor.undo();
  assert.deepEqual(puppet.setRenderOrder.mock.lastCall?.[0], ['root', 'arm']);
  editor.redo();
  assert.deepEqual(puppet.setRenderOrder.mock.lastCall?.[0], ['arm', 'root']);
  editor.resetRig();
  assert.deepEqual(puppet.setRenderOrder.mock.lastCall?.[0], ['root', 'arm']);
});

test('slot depth changes update placement while slot transforms retain cached depths', () => {
  const { editor, puppet } = fixture({
    root: 'root',
    bones: [{ id: 'root' }],
    slots: [{ id: 'visual', bone: 'root' }],
  });
  editor.refresh();
  editor.editSlot('visual', 'x', 12);
  assert.equal(puppet.setRenderOrder.mock.calls.length, 1);
  editor.editSlot('visual', 'depth', 25);
  assert.equal(puppet.setRenderOrder.mock.lastCall?.[1]?.get('visual'), 25);
  editor.editSlot('visual', 'depth', undefined);
  assert.isUndefined(puppet.setRenderOrder.mock.lastCall?.[1]?.get('visual'));
  editor.undo();
  assert.equal(puppet.setRenderOrder.mock.lastCall?.[1]?.get('visual'), 25);
  editor.redo();
  assert.isUndefined(puppet.setRenderOrder.mock.lastCall?.[1]?.get('visual'));
});
