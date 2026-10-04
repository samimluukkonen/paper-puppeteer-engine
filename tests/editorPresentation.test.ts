import { assert, test, vi } from 'vitest';
import {
  demoArmRotations,
  demoAuthoringLayout,
  demoHipPositions,
  demoRenderOrder,
  demoShoulderPositions,
} from '../src/demo/demoPresentation.js';
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
      let branch = puppet.getSlotImage(slot.id)!.parentContainer!;
      while (branch.parentContainer?.parentContainer !== puppet.container) branch = branch.parentContainer!;
      return { bone: slot.bone, depth: branch.depth };
    })
    .sort((a, b) => a.depth - b.depth)
    .map(({ bone }) => bone);
}

function assertDemoArtwork(puppet: Puppet, animation: string, facing: 'left' | 'right'): void {
  const visible = artworkOrder(puppet);
  assert.deepEqual(
    visible,
    demoRenderOrder(puppet.rig, animation, facing).filter((id) => visible.includes(id)),
  );
}

test('Rig Editor bind pose and exported reload share the demo right-facing positions and artwork order', () => {
  const scene = puppetScene();
  const puppet = new Puppet(scene, { rig: demoRig, skin: 'default', autoUpdate: false });
  const editor = new RigEditor(scene, puppet, vi.fn());
  editor.refresh();
  const layout = demoAuthoringLayout(demoRig, 'right');
  for (const [id, x] of Object.entries(layout.positions)) assert.equal(puppet.getBone(id).pose.x, x);
  for (const [id, rotation] of Object.entries(layout.rotations))
    assert.equal(puppet.getBone(id).pose.rotation, rotation);
  assert.isAbove(puppet.getBone('leftUpperArm').pose.x, puppet.getBone('rightUpperArm').pose.x);
  assert.isAbove(puppet.getBone('leftThigh').pose.x, puppet.getBone('rightThigh').pose.x);
  assertDemoArtwork(puppet, 'idle', 'right');

  const rig = parseRigDefinition(JSON.parse(editor.exportJson(false)));
  const reloaded = new Puppet(scene, { rig, skin: 'default', autoUpdate: false });
  assertDemoArtwork(reloaded, 'idle', 'right');
  assert.deepEqual(artworkOrder(reloaded), artworkOrder(puppet));
  reloaded.destroy();
  puppet.destroy();
});

test('Animation Editor idle, walk and sword need no demo correction for right-facing limbs', () => {
  const state = new AnimationEditorState(demoRig, demoAnimations);
  const puppet = new Puppet(puppetScene(), { rig: demoRig, skin: 'default', autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet);
  for (const name of ['idle', 'walk', 'sword']) {
    state.selectAnimation(name);
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      state.setCurrentTime(state.duration * fraction);
      const positions = {
        ...demoShoulderPositions(demoRig, name, 'right'),
        ...demoHipPositions(demoRig, 'right'),
      };
      for (const [id, x] of Object.entries(positions)) assert.equal(puppet.getBone(id).pose.x, x);
      const rotations = {
        leftUpperArm: puppet.getBone('leftUpperArm').pose.rotation,
        rightUpperArm: puppet.getBone('rightUpperArm').pose.rotation,
      };
      assert.deepEqual(demoArmRotations(name, 'right', rotations), rotations);
      assertDemoArtwork(puppet, name, 'right');
    }
  }
  preview.dispose();
  puppet.destroy();
});

test('demo facing switches move the authored rear-arm slots to the front and restore their depths', () => {
  const puppet = new Puppet(puppetScene(), { rig: demoRig, skin: 'default', autoUpdate: false });
  for (const facing of ['left', 'right', 'left', 'right'] as const) {
    const layout = demoAuthoringLayout(demoRig, facing);
    puppet.setRenderOrder(layout.order, layout.slotDepths).setFacing(facing);
    assertDemoArtwork(puppet, 'idle', facing);
  }
  puppet.destroy();
});
