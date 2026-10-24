import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import {
  DEFAULT_MOTION_PREVIEW,
  evaluatePreviewDisplacement,
  type PreviewPositionKey,
} from '../src/devtools/animation-editor/motionPreview.js';
import { MotionPreviewController } from '../src/devtools/animation-editor/MotionPreviewController.js';
import { MotionPreviewLayer } from '../src/devtools/animation-editor/MotionPreviewLayer.js';
import { CHARACTER_PREVIEW_ORIGIN } from '../src/devtools/shared/previewPlacement.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { demoRig, walk } from './helpers/demoCharacter.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const point = (time: number, offsetX = 0, offsetY = 0): PreviewPositionKey => ({ time, offsetX, offsetY });
const settings = (positionKeys: readonly PreviewPositionKey[]) => ({
  ...DEFAULT_MOTION_PREVIEW,
  enabled: true,
  positionKeys,
});

test('disabled and empty trajectories produce no additional movement', () => {
  assert.deepEqual(evaluatePreviewDisplacement(DEFAULT_MOTION_PREVIEW, 500), { x: 0, y: 0 });
  assert.deepEqual(evaluatePreviewDisplacement({ ...settings([point(0, 100)]), enabled: false }, 500), { x: 0, y: 0 });
  assert.deepEqual(evaluatePreviewDisplacement(settings([]), 500), { x: 0, y: 0 });
});

test.each([
  ['forward step', [point(0), point(300), point(550, 45), point(1000, 45)], 425, { x: 22.5, y: 0 }],
  ['backward step', [point(0), point(1000, -60)], 500, { x: -30, y: 0 }],
  ['sideways movement', [point(0), point(1000, 0, 60)], 500, { x: 0, y: 30 }],
  ['jump ascent', [point(0), point(500, 40, -100), point(1000, 80)], 250, { x: 20, y: -50 }],
  ['jump descent', [point(0), point(500, 40, -100), point(1000, 80)], 750, { x: 60, y: -50 }],
  ['stationary interval', [point(0), point(300), point(550, 45), point(1000, 45)], 800, { x: 45, y: 0 }],
  ['return to origin', [point(0), point(300, 80, -20), point(700), point(1000)], 700, { x: 0, y: 0 }],
] as const)('%s uses arbitrary time-position segments', (_name, keys, time, expected) => {
  assert.deepEqual(evaluatePreviewDisplacement(settings(keys), time), expected);
});

test('endpoint holding, one point, stepped boundaries and repeated seeks are deterministic', () => {
  const trajectory = settings([point(100, 10, 20), point(600, -40, 30), point(900, 80, -50)]);
  assert.deepEqual(evaluatePreviewDisplacement(trajectory, -100), { x: 10, y: 20 });
  assert.deepEqual(evaluatePreviewDisplacement(trajectory, 2000), { x: 80, y: -50 });
  assert.deepEqual(evaluatePreviewDisplacement(settings([point(300, 70)]), 0), { x: 70, y: 0 });
  const target = evaluatePreviewDisplacement(trajectory, 700);
  for (const time of [200, 900, 300, 1000]) {
    evaluatePreviewDisplacement(trajectory, time);
    assert.deepEqual(evaluatePreviewDisplacement(trajectory, 700), target);
  }
  const stepped = { ...trajectory, interpolation: 'stepped' as const };
  assert.deepEqual(evaluatePreviewDisplacement(stepped, 599), { x: 10, y: 20 });
  assert.deepEqual(evaluatePreviewDisplacement(stepped, 600), { x: -40, y: 30 });
});

test('invalid numeric values never reach world transforms', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(evaluatePreviewDisplacement(settings([point(0, 1)]), invalid), { x: 0, y: 0 });
    for (const key of [point(invalid), point(0, invalid), point(0, 0, invalid)])
      assert.deepEqual(evaluatePreviewDisplacement(settings([key]), 500), { x: 0, y: 0 });
  }
  for (const keys of [[point(-1)], [point(100), point(0)], [point(0), point(0, 10)]])
    assert.deepEqual(evaluatePreviewDisplacement(settings(keys), 500), { x: 0, y: 0 });
  assert.deepEqual(
    evaluatePreviewDisplacement(settings([point(0, -Number.MAX_VALUE), point(1000, Number.MAX_VALUE)]), 500),
    { x: 0, y: 0 },
  );
});

function fixture(playback: AnimationClip['playback'] = { mode: 'smooth' }) {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'upper', parent: 'root' },
      { id: 'lower', parent: 'upper', y: 60 },
      { id: 'hand', parent: 'lower', y: 50 },
    ],
  });
  const input: AnimationClip = {
    name: 'cut',
    duration: 1050,
    loop: true,
    playback,
    tracks: {
      root: [
        { time: 0, x: 0, y: 0 },
        { time: 1050, x: 30, y: -10 },
      ],
    },
  };
  const state = new AnimationEditorState(rig, [input, { ...input, name: 'jump' }]);
  state.selectAnimation('cut');
  const controller = new MotionPreviewController();
  controller.bind(state);
  const puppet = new Puppet(puppetScene(), { rig, ...CHARACTER_PREVIEW_ORIGIN, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet, controller);
  return {
    state,
    controller,
    puppet,
    preview,
    input,
    cleanup: () => {
      preview.dispose();
      controller.dispose();
      puppet.destroy();
    },
  };
}

test('clip-specific controller validates edits, retains disabled paths and resets without history or source changes', () => {
  const f = fixture();
  try {
    const { state, controller } = f;
    const working = state.workingAnimation;
    const history = state.historyLength;
    controller.addPoint();
    assert.equal(controller.getSnapshot().settings.positionKeys.length, 1);
    assert.isTrue(controller.editPoint(0, point(300, 40, -10)));
    controller.update({ enabled: true });
    state.setCurrentTime(0.7);
    controller.addPoint();
    assert.deepEqual(controller.getSnapshot().settings.positionKeys, [point(300, 40, -10), point(700, 40, -10)]);
    const held = controller.getSnapshot().settings;
    assert.isFalse(controller.editPoint(1, point(300, 5)));
    assert.strictEqual(controller.getSnapshot().settings, held);
    assert.match(controller.getSnapshot().message, /unique/);
    assert.isFalse(controller.update({ positionKeys: [point(NaN)] }));
    controller.update({ enabled: false });
    assert.deepEqual(controller.getSnapshot().settings.positionKeys, held.positionKeys);
    state.selectAnimation('jump');
    assert.strictEqual(controller.getSnapshot().settings, DEFAULT_MOTION_PREVIEW);
    state.selectAnimation('cut');
    assert.deepEqual(controller.getSnapshot().settings.positionKeys, held.positionKeys);
    controller.removePoint(0);
    assert.deepEqual(controller.getSnapshot().settings.positionKeys, [point(700, 40, -10)]);
    controller.reset();
    assert.deepEqual(controller.getSnapshot().settings, DEFAULT_MOTION_PREVIEW);
    assert.strictEqual(state.workingAnimation, working);
    assert.equal(state.historyLength, history);
    assert.isFalse(state.dirty);
    controller.unbind();
    state.selectAnimation('jump');
    assert.isFalse(controller.getSnapshot().ready);
    assert.isFalse(controller.update({ enabled: true }));
  } finally {
    f.cleanup();
  }
});

test.each(['left', 'right'] as const)(
  'world displacement preserves authored root translation, scale, %s facing and IK',
  (facing) => {
    const f = fixture();
    try {
      const { state, controller, puppet } = f;
      const source = JSON.stringify(f.input);
      const working = state.workingAnimation;
      const history = state.historyLength;
      puppet.container.setScale(1.5);
      puppet.setFacing(facing);
      const ik = puppet.addIK({ name: 'arm', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', mix: 0.5 });
      ik.setTargetProvider(() => puppet.container.getWorldTransformMatrix().transformPoint(60, 70));
      controller.update({ positionKeys: [point(0), point(1050, 100, -80)], enabled: true });
      for (const time of [0.2, 0.9, 0.6, 0.1, 0.6]) {
        state.setCurrentTime(time);
        assert.approximately(puppet.container.x, CHARACTER_PREVIEW_ORIGIN.x + (time / 1.05) * 100, 1e-10);
        assert.approximately(puppet.container.y, CHARACTER_PREVIEW_ORIGIN.y - (time / 1.05) * 80, 1e-10);
        assert.approximately(puppet.getBone('root').pose.x, (time / 1.05) * 30, 1e-10);
        assert.equal(ik.status, 'solved');
      }
      const rootPose = { ...puppet.getBone('root').pose };
      controller.update({ enabled: false });
      assert.equal(puppet.container.x, CHARACTER_PREVIEW_ORIGIN.x);
      assert.equal(puppet.container.y, CHARACTER_PREVIEW_ORIGIN.y);
      assert.deepEqual(puppet.getBone('root').pose, rootPose);
      assert.equal(puppet.container.scaleX, facing === 'left' ? -1.5 : 1.5);
      assert.equal(ik.status, 'solved');
      assert.strictEqual(state.workingAnimation, working);
      assert.equal(state.historyLength, history);
      assert.equal(JSON.stringify(f.input), source);
    } finally {
      f.cleanup();
    }
  },
);

test('displacement shares stepped pose timing, exact endpoints, playback loop, speed, scrub and rig-mode lifecycle', () => {
  const f = fixture({ mode: 'stepped', fps: 10 });
  try {
    const { state, controller, puppet, preview } = f;
    controller.update({ positionKeys: [point(0), point(1050, 105)], enabled: true });
    const check = (offset: number) => {
      assert.approximately(puppet.container.x, CHARACTER_PREVIEW_ORIGIN.x + offset, 1e-10);
      assert.approximately(puppet.getBone('root').pose.x, (offset / 105) * 30, 1e-10);
    };
    state.setCurrentTime(0.375);
    check(30);
    state.setCurrentTime(1.05);
    check(105);
    state.setPreviewLoop(true);
    state.setPlaybackSpeed(2);
    state.restart();
    state.play();
    state.advancePlayback(0.7);
    check(30);
    state.beginScrub();
    state.setCurrentTime(0.675);
    check(60);
    state.advancePlayback(1);
    check(60);
    state.endScrub();
    state.pause();
    state.setEditorMode('rig');
    assert.equal(puppet.container.x, CHARACTER_PREVIEW_ORIGIN.x);
    state.setEditorMode('animation');
    check(60);
    preview.dispose();
    assert.equal(puppet.container.x, CHARACTER_PREVIEW_ORIGIN.x);
    controller.update({ positionKeys: [point(0, 800)] });
    state.setCurrentTime(0.1);
    assert.equal(puppet.container.x, CHARACTER_PREVIEW_ORIGIN.x);
  } finally {
    f.cleanup();
  }
});

test('the bundled walk retains identical local poses and world coordinates on repeated seeks and disable', () => {
  const state = new AnimationEditorState(demoRig, [walk]);
  state.selectAnimation(walk.name);
  const controller = new MotionPreviewController();
  controller.bind(state);
  const puppet = new Puppet(puppetScene(), { rig: demoRig, ...CHARACTER_PREVIEW_ORIGIN, autoUpdate: false });
  const preview = new AnimationEditorPreview(state, puppet, controller);
  const sample = () =>
    demoRig.bones.map((bone) => ({
      pose: { ...puppet.getBone(bone.id).pose },
      world: puppet.getBone(bone.id).container.getWorldTransformMatrix().transformPoint(0, 0),
    }));
  try {
    controller.update({ positionKeys: [point(0), point(300), point(550, 65), point(1000, 65)] });
    for (const facing of ['right', 'left'] as const) {
      puppet.setFacing(facing);
      state.setCurrentTime(0.425);
      const authored = sample();
      controller.update({ enabled: true });
      const displaced = sample();
      for (const time of [0.8, 0.2, 0.9]) {
        state.setCurrentTime(time);
        state.setCurrentTime(0.425);
        assert.deepEqual(sample(), displaced);
      }
      controller.update({ enabled: false });
      assert.deepEqual(sample(), authored);
    }
  } finally {
    preview.dispose();
    controller.dispose();
    puppet.destroy();
  }
});

test('trajectory overlay is independent world graphics and disposes its objects', () => {
  const f = fixture();
  const scene = puppetScene();
  Object.assign(scene, { cameras: { main: { zoom: 2 } } });
  const graphics = scene.add.graphics();
  const clear = vi.spyOn(graphics, 'clear');
  const line = vi.spyOn(graphics, 'lineBetween');
  vi.spyOn(scene.add, 'graphics').mockReturnValue(graphics);
  const layer = new MotionPreviewLayer(scene, f.state, f.controller);
  try {
    layer.render();
    assert.equal(line.mock.calls.length, 0);
    f.controller.update({ enabled: true, positionKeys: [point(0), point(1050, 80, -90)] });
    layer.render();
    assert.deepEqual(line.mock.calls[0], [380, 435, 460, 345]);
    f.controller.update({ showTrajectory: false });
    layer.render();
    assert.equal(line.mock.calls.length, 1);
    assert.equal(clear.mock.calls.length, 3);
    layer.dispose();
    assert.isTrue(graphics.isDestroyed);
  } finally {
    f.cleanup();
  }
});
