import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { EnvironmentPreviewCamera } from '../src/devtools/animation-editor/EnvironmentPreviewCamera.js';
import { EnvironmentPreviewController } from '../src/devtools/animation-editor/EnvironmentPreviewController.js';
import { MotionPreviewController } from '../src/devtools/animation-editor/MotionPreviewController.js';
import { DEFAULT_PREVIEW_CAMERA } from '../src/devtools/animation-editor/previewCamera.js';
import { environmentPreviewImages } from '../src/devtools/shared/environmentPreview.js';
import { contactGroundDistance } from '../src/devtools/shared/footContactGround.js';
import { CHARACTER_PREVIEW_ORIGIN } from '../src/devtools/shared/previewPlacement.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import type { FiredAnimationEvent } from '../src/engine/AnimationPlayer.js';
import { getFootContactWorldPosition } from '../src/engine/footContactMarkers.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

function fixture(playback: AnimationClip['playback'] = { mode: 'smooth' }) {
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'lower', parent: 'root', y: 60 }, { id: 'foot', parent: 'lower', y: 50 }],
    footContactMarkers: [{ id: 'sole', name: 'Sole', boneId: 'foot', localX: 0, localY: 5 }],
  });
  const clips: AnimationClip[] = ['cut', 'jump', 'walk'].map((name) => ({
    name,
    duration: 1000,
    loop: true,
    playback,
    tracks: {
      root: [
        { time: 0, rotation: 0 },
        { time: 1000, rotation: 0.4 },
      ],
    },
    events: [
      { time: 0, name: 'start' },
      { time: 500, name: 'step' },
    ],
  }));
  const state = new AnimationEditorState(rig, clips);
  state.selectAnimation('cut');
  const motion = new MotionPreviewController();
  motion.bind(state);
  const puppet = new Puppet(puppetScene(), { rig, ...CHARACTER_PREVIEW_ORIGIN, autoUpdate: false });
  const ik = puppet.addIK({ name: 'leg', rootBone: 'root', middleBone: 'lower', endBone: 'foot', mix: 0.5 });
  ik.setTargetProvider(() => puppet.container.getWorldTransformMatrix().transformPoint(30, 90));
  const preview = new AnimationEditorPreview(state, puppet, motion);
  const environment = new EnvironmentPreviewController();
  environment.update({ image: '../images/background.png', x: 300, y: 200 });
  const camera = {
    scrollX: 42,
    scrollY: -30,
    zoom: 1.2,
    width: 800,
    height: 600,
    setZoom(zoom: number) {
      this.zoom = zoom;
    },
    centerOn(x: number, y: number) {
      this.scrollX = x - this.width / 2;
      this.scrollY = y - this.height / 2;
    },
  };
  const layer = new EnvironmentPreviewCamera(camera, state, environment, motion);
  return {
    state,
    motion,
    puppet,
    environment,
    camera,
    layer,
    clips,
    rig,
    center: () => ({ x: camera.scrollX + camera.width / 2, y: camera.scrollY + camera.height / 2 }),
    cleanup() {
      layer.dispose();
      preview.dispose();
      motion.dispose();
      environment.dispose();
      puppet.destroy();
    },
  };
}

const point = (time: number, offsetX: number, offsetY = 0) => ({ time, offsetX, offsetY });

test('camera settings validate finite coordinates/zoom, reset independently and expire with the session', () => {
  const environment = new EnvironmentPreviewController();
  try {
    environment.updateCamera({ mode: 'follow', x: -1000, y: 800, zoom: 0.1 });
    const valid = environment.getSnapshot().camera;
    environment.updateCamera({ x: NaN, y: Infinity, zoom: NaN });
    assert.deepEqual(environment.getSnapshot().camera, valid);
    environment.updateCamera({ zoom: -2 });
    assert.equal(environment.getSnapshot().camera.zoom, 0.1);
    environment.updateCamera({ zoom: 20 });
    assert.equal(environment.getSnapshot().camera.zoom, 4);
    environment.update({ enabled: true });
    environment.resetCamera();
    assert.strictEqual(environment.getSnapshot().camera, DEFAULT_PREVIEW_CAMERA);
    assert.isTrue(environment.getSnapshot().settings.enabled);
    environment.updateCamera({ x: 600 });
    environment.reset();
    assert.strictEqual(environment.getSnapshot().camera, DEFAULT_PREVIEW_CAMERA);
    const held = environment.getSnapshot();
    environment.dispose();
    environment.updateCamera({ x: 900 });
    assert.deepEqual(environment.getSnapshot(), held);
  } finally {
    environment.dispose();
  }
});

test.each([
  ['cut', [point(0, 0), point(300, 0), point(550, 60), point(1000, 60)]],
  ['jump', [point(0, 0), point(500, 40, -100), point(1000, 80)]],
  ['walk', [point(0, 0), point(1000, 800)]],
] as const)(
  '%s synchronizes play/pause, speed, restart, silent scrubs, loop reset and fixed/follow cameras',
  (id, keys) => {
    const f = fixture();
    try {
      const { state, motion, puppet, environment, layer, camera } = f;
      state.selectAnimation(id);
      const original = state.workingAnimation;
      const input = JSON.stringify(f.clips);
      const events = vi.fn<(event: FiredAnimationEvent) => void>();
      state.onAnimationEvent(events);
      motion.update({ enabled: true, positionKeys: keys });
      environment.update({ enabled: true });
      const background = environmentPreviewImages(environment.getSnapshot().settings);
      const snapshot = () => ({
        center: f.center(),
        zoom: camera.zoom,
        bones: f.rig.bones.map((bone) => ({
          pose: { ...puppet.getBone(bone.id).pose },
          world: puppet.getBone(bone.id).container.getWorldTransformMatrix().transformPoint(0, 0),
        })),
        marker: getFootContactWorldPosition(
          f.rig.footContactMarkers![0]!,
          f.rig,
          new Map(f.rig.bones.map((bone) => [bone.id, puppet.getBone(bone.id).pose])),
          puppet.container.getWorldTransformMatrix(),
        ),
      });
      for (const mode of ['fixed', 'follow'] as const) {
        environment.updateCamera({ mode, zoom: 0.5 });
        for (const facing of ['left', 'right'] as const) {
          puppet.setFacing(facing);
          puppet.container.setScale(facing === 'left' ? -1.5 : 1.5, 1.5);
          const ik = puppet.getIK('leg');
          state.setCurrentTime(0.425);
          const target = snapshot();
          assert.equal(target.zoom, 0.5);
          assert.equal(target.center.x, mode === 'fixed' ? 380 : puppet.container.x);
          assert.equal(target.center.y, mode === 'fixed' ? 435 : puppet.container.y);
          assert.equal(ik.status, 'solved');
          assert.isDefined(target.marker);
          assert.isFinite(contactGroundDistance(target.marker, 435, 1).distance);
          for (const time of [0.9, 0.1, 1, 0, 0.425]) state.setCurrentTime(time);
          layer.render();
          assert.deepEqual(snapshot(), target);
        }
        assert.equal(events.mock.calls.length, 0, 'direct navigation never fires events');
        state.restart();
        const beginning = snapshot();
        state.setPlaybackSpeed(1);
        state.play();
        assert.equal(events.mock.calls[0]![0].name, 'start');
        state.advancePlayback(0.2);
        state.pause();
        const paused = snapshot();
        state.advancePlayback(1);
        assert.deepEqual(snapshot(), paused);
        state.setPlaybackSpeed(2);
        state.play();
        state.advancePlayback(0.1);
        assert.approximately(state.currentTime, 0.4, 1e-12);
        state.beginScrub();
        const count = events.mock.calls.length;
        state.setCurrentTime(0.8);
        const scrubbed = snapshot();
        state.advancePlayback(0.3);
        assert.deepEqual(snapshot(), scrubbed);
        state.setCurrentTime(0.1);
        state.endScrub();
        assert.equal(events.mock.calls.length, count);
        state.setPreviewLoop(true);
        state.restart();
        assert.deepEqual(snapshot(), beginning);
        state.advancePlayback(0.625);
        assert.approximately(state.currentTime, 0.25, 1e-12);
        const looped = snapshot();
        state.pause();
        state.setCurrentTime(0.25);
        assert.deepEqual(snapshot(), looped);
        state.restart();
        assert.deepEqual(snapshot(), beginning);
        events.mockClear();
      }
      assert.deepEqual(environmentPreviewImages(environment.getSnapshot().settings), background);
      assert.strictEqual(state.workingAnimation, original);
      assert.equal(state.historyLength, 0);
      assert.isFalse(state.dirty);
      assert.equal(JSON.stringify(f.clips), input);
    } finally {
      f.cleanup();
    }
  },
);

test('follow shares held pose timing and exact endpoint, without accumulating travel over repeated loops', () => {
  const f = fixture({ mode: 'stepped', fps: 10 });
  try {
    f.motion.update({ enabled: true, positionKeys: [point(0, 0), point(1000, 100)] });
    f.environment.updateCamera({ mode: 'follow' });
    f.environment.update({ enabled: true });
    f.state.setCurrentTime(0.375);
    assert.deepEqual(f.center(), { x: 410, y: 435 });
    const held = f.puppet.getBone('root').pose.rotation;
    f.state.setCurrentTime(0.3);
    assert.equal(f.puppet.getBone('root').pose.rotation, held);
    f.state.setCurrentTime(1);
    assert.deepEqual(f.center(), { x: 480, y: 435 });
    f.state.setPreviewLoop(true);
    f.state.restart();
    f.state.play();
    for (let i = 0; i < 20; i++) {
      f.state.advancePlayback(1);
      assert.deepEqual(f.center(), { x: 380, y: 435 });
    }
  } finally {
    f.cleanup();
  }
});

test('native pan/zoom, resize, mode switches and disposal preserve ordinary navigation and release subscribers', () => {
  const f = fixture();
  try {
    f.environment.update({ enabled: true });
    f.motion.update({ enabled: true, positionKeys: [point(0, 50, -20)] });
    f.environment.updateCamera({ mode: 'follow' });
    f.camera.scrollX += 25;
    f.camera.scrollY -= 10;
    f.camera.setZoom(0.6);
    f.layer.render();
    assert.deepEqual(f.environment.getSnapshot().camera, { mode: 'follow', x: 405, y: 425, zoom: 0.6 });
    f.camera.width = 1200;
    f.camera.height = 900;
    f.layer.render();
    assert.deepEqual(f.center(), { x: 455, y: 405 });
    for (const mode of ['rig', 'rig-tweak'] as const) {
      f.state.setEditorMode(mode);
      assert.deepEqual([f.camera.scrollX, f.camera.scrollY, f.camera.zoom], [42, -30, 1.2]);
      assert.equal(f.puppet.container.x, 380);
      f.state.setEditorMode('animation');
      assert.deepEqual(f.center(), { x: 455, y: 405 });
    }
    f.environment.update({ enabled: false });
    assert.deepEqual([f.camera.scrollX, f.camera.scrollY, f.camera.zoom], [42, -30, 1.2]);
    f.camera.scrollX = 111;
    f.environment.update({ enabled: true });
    f.layer.dispose();
    assert.deepEqual([f.camera.scrollX, f.camera.scrollY, f.camera.zoom], [111, -30, 1.2]);
    f.environment.updateCamera({ x: 5000 });
    f.state.setCurrentTime(0.9);
    f.layer.render();
    assert.equal(f.camera.scrollX, 111);
  } finally {
    f.cleanup();
  }
});
