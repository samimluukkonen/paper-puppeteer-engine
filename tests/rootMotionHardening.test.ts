import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { FootContactGroundController } from '../src/devtools/animation-editor/FootContactGroundController.js';
import { FootContactGroundPanel } from '../src/devtools/animation-editor/FootContactGroundPanel.js';
import { diagnoseMotion, previewMotionCleanup } from '../src/devtools/animation-editor/motionDiagnostics.js';
import { GroundGuideWorkspace } from '../src/devtools/shared/GroundGuideWorkspace.js';
import { compileClip, commitIKBake, generateBakedBoneKeys, sampleIKBake } from '../src/engine/core.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const rig = new Rig({
  root: 'pelvis',
  bones: [
    { id: 'pelvis' },
    { id: 'leg', parent: 'pelvis', y: 50 },
    { id: 'foot', parent: 'leg', y: 50 },
    { id: 'sword', parent: 'pelvis' },
  ],
  ik: [{ name: 'legIK', rootBone: 'pelvis', middleBone: 'leg', endBone: 'foot' }],
  footContactMarkers: [{ id: 'sole', name: 'Sole', boneId: 'foot', localX: 2, localY: 5 }],
});
function fixture() {
  const state = new AnimationEditorState(rig, [
    {
      name: 'sword',
      duration: 1000,
      loop: false,
      tracks: {
        pelvis: [
          { time: 0, y: 0 },
          { time: 250, y: -5 },
          { time: 1000, y: 0 },
        ],
        sword: [
          { time: 0, x: 0 },
          { time: 500, x: 5 },
          { time: 1000, x: 10 },
        ],
      },
      ikTracks: {
        legIK: [
          { time: 0, x: 20, y: 80 },
          { time: 1000, x: 40, y: 70 },
        ],
      },
      events: [{ time: 600, name: 'cut' }],
    },
  ]);
  state.selectAnimation('sword');
  state.rootMotion.setRootPosition({ x: 10, y: 20 }, 0);
  state.rootMotion.setRootPosition({ x: 10, y: 20 }, 0.25);
  state.rootMotion.setRootPosition({ x: 90, y: 20 }, 0.6);
  state.rootMotion.setRootPosition({ x: 90, y: 20 }, 1);
  state.editGraphKey(
    { channel: { kind: 'root', id: 'Root Motion', property: 'x' }, time: 0.25 },
    {
      curve: { mode: 'bezier', control1: { x: 0.2, y: 0 }, control2: { x: 0.8, y: 1 } },
    },
  );
  return state;
}

test('pose capture/apply, diagnostics cleanup and IK baking preserve independently authored root curves', () => {
  const state = fixture();
  const root = state.workingAnimation!.rootMotion;
  state.setCurrentTime(0.5);
  const pose = state.saveCurrentPose('Anticipation');
  assert.notProperty(state.poseLibrary.get(pose).pose, 'rootMotion');
  assert.isTrue(state.previews.previewLibraryPose(pose));
  state.previews.cancelPosePreview();
  state.setCurrentTime(0.75);
  assert.isTrue(state.applyLibraryPose(pose));
  assert.deepEqual(state.workingAnimation!.rootMotion, root);
  state.undo();
  state.redo();
  assert.deepEqual(state.workingAnimation!.rootMotion, root);
  state.undo();

  const source = state.workingAnimation!;
  const report = diagnoseMotion(source, rig);
  assert.isTrue(report.notes.some((note) => note.includes('Root Motion') && note.includes('not analyzed')));
  const candidate = report.candidates.find((key) => key.boneId === 'sword' && key.timeMs === 500)!;
  assert.exists(candidate);
  const cleaned = previewMotionCleanup(source, rig, [candidate]).animation;
  assert.deepEqual(cleaned.rootMotion, root);
  assert.deepEqual(cleaned.events, source.events);
  assert.deepEqual(cleaned.ikTracks, source.ikTracks);

  const samples = sampleIKBake(source, rig, ['legIK'], { fps: 20 });
  assert.isTrue(samples.success);
  const plan = generateBakedBoneKeys(samples, rig, { animation: source });
  assert.isTrue(plan.success);
  if (!plan.success) throw new Error('Bake planning failed');
  const baked = commitIKBake(source, plan, rig);
  assert.isTrue(baked.success);
  if (!baked.success) throw new Error('Bake failed');
  assert.deepEqual(baked.animation.rootMotion, root);
  assert.deepEqual(baked.animation.events, source.events);
  assert.deepEqual(compileClip(baked.animation, rig).rootMotion, root);
});

test.each(['right', 'left'] as const)(
  'world foot diagnostics include root travel exactly once for %s facing, after IK',
  (facing) => {
    const state = fixture();
    const puppet = new Puppet(puppetScene(), { rig, x: 300, y: 400, facing, scale: 2, autoUpdate: false });
    const preview = new AnimationEditorPreview(state, puppet);
    const ground = new GroundGuideWorkspace('animation-preview-world', () => ({
      getItem: () => null,
      setItem: () => {},
    }));
    ground.bind('root-hardening');
    ground.update({ enabled: true, y: 600 });
    const contacts = new FootContactGroundController();
    contacts.bind(state, ground);
    contacts.setVisible(true);
    const before = state.exportJson();
    const metadata = ground.getSnapshot();
    try {
      for (const seconds of [0.6, 0.25, 1, 0.5, 0, 0.6]) {
        state.setCurrentTime(seconds);
        contacts.sync(puppet, undefined, seconds * 1000 + 2000);
        const traveled = contacts.contacts[0]!.world;
        const localPose = { ...puppet.getBone('foot').pose };
        const offset = puppet.container.x - 300;
        state.rootMotion.setWorldDisplacementView('none');
        contacts.sync(puppet);
        const stationary = contacts.contacts[0]!.world;
        assert.closeTo(traveled.x - stationary.x, offset, 1e-8);
        assert.closeTo(traveled.y, stationary.y, 1e-8);
        assert.deepEqual(puppet.getBone('foot').pose, localPose);
        if (seconds >= 0.6) assert.closeTo(offset, facing === 'left' ? -160 : 160, 1e-8);
        state.rootMotion.setWorldDisplacementView('authored');
      }
      contacts.sync(puppet);
      const html = renderToStaticMarkup(
        createElement(FootContactGroundPanel, { controller: contacts, workspace: ground }),
      );
      assert.include(html, `World X ${contacts.contacts[0]!.world.x.toFixed(3)}`);
      assert.include(html, 'does not identify a planted foot');
      assert.equal(state.exportJson(), before);
      assert.strictEqual(ground.getSnapshot(), metadata);
    } finally {
      contacts.unbind();
      preview.dispose();
      puppet.destroy();
    }
  },
);
