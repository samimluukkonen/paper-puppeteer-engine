import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { Puppet } from '../src/engine/Puppet.js';
import { demoAnimations, demoRig } from './helpers/demoCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function artworkOrder(puppet: Puppet): string[] {
  return puppet.rig.slots
    .filter((slot) => puppet.getSlotImage(slot.id))
    .map((slot) => {
      let branch = puppet.getSlotImage(slot.id)!.parentContainer;
      while (branch.parentContainer?.parentContainer !== puppet.container) branch = branch.parentContainer!;
      return { bone: slot.bone, depth: branch.depth };
    })
    .sort((a, b) => a.depth - b.depth)
    .map(({ bone }) => bone);
}

function assertSampleArtwork(puppet: Puppet): void {
  const visible = artworkOrder(puppet);
  assert.deepEqual(
    visible,
    [
      'leftUpperArm',
      'leftForearm',
      'leftHand',
      'leftThigh',
      'leftLowerLeg',
      'leftFoot',
      'pelvis',
      'rightThigh',
      'rightLowerLeg',
      'rightFoot',
      'torso',
      'head',
      'rightUpperArm',
      'rightForearm',
      'rightHand',
    ].filter((id) => visible.includes(id)),
  );
}

test('Rig Editor bind pose and exported reload preserve sample positions and artwork order', () => {
  const scene = puppetScene();
  const puppet = new Puppet(scene, { rig: demoRig, skin: 'default', autoUpdate: false });
  const editor = new RigEditor(scene, puppet, vi.fn());
  editor.refresh();
  for (const bone of demoRig.bones) {
    assert.equal(puppet.getBone(bone.id).pose.x, bone.x ?? 0);
    assert.equal(puppet.getBone(bone.id).pose.rotation, bone.rotation ?? 0);
  }
  assert.isAbove(puppet.getBone('leftUpperArm').pose.x, puppet.getBone('rightUpperArm').pose.x);
  assert.isAbove(puppet.getBone('leftThigh').pose.x, puppet.getBone('rightThigh').pose.x);
  assertSampleArtwork(puppet);

  const rig = parseRigDefinition(JSON.parse(editor.exportJson(false)));
  const reloaded = new Puppet(scene, { rig, skin: 'default', autoUpdate: false });
  assertSampleArtwork(reloaded);
  assert.deepEqual(artworkOrder(reloaded), artworkOrder(puppet));
  reloaded.destroy();
  puppet.destroy();
});

test('Animation Editor idle, walk and sword preserve authored sample limb positions and artwork order', () => {
  const state = new AnimationEditorState(demoRig, demoAnimations);
  const puppet = new Puppet(puppetScene(), { rig: demoRig, skin: 'default', autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  for (const name of ['idle', 'walk', 'sword']) {
    state.selectAnimation(name);
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      state.setCurrentTime(state.duration * fraction);
      for (const id of ['leftUpperArm', 'rightUpperArm', 'leftThigh', 'rightThigh'])
        assert.equal(puppet.getBone(id).pose.x, demoRig.getBone(id).x ?? 0);
      for (const id of ['leftUpperArm', 'rightUpperArm'])
        assert.equal(puppet.getBone(id).pose.rotation, state.getEvaluatedBonePropertyValue(id, 'rotation'));
      assertSampleArtwork(puppet);
    }
  }
  preview.dispose();
  puppet.destroy();
});
