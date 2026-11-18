import { assert, test, vi } from 'vitest';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { EnvironmentPreviewCamera } from '../src/devtools/animation-editor/EnvironmentPreviewCamera.js';
import { EnvironmentPreviewController } from '../src/devtools/animation-editor/EnvironmentPreviewController.js';
import { MotionPreviewController } from '../src/devtools/animation-editor/MotionPreviewController.js';
import { DEFAULT_PREVIEW_CAMERA } from '../src/devtools/animation-editor/previewCamera.js';
import { previewTrajectoryToRootMotion } from '../src/devtools/animation-editor/previewTrajectoryCopy.js';
import { evaluateWorldDisplacement } from '../src/devtools/animation-editor/worldDisplacement.js';
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

function fixture(playback: AnimationClip['playback'] = { mode: 'smooth' }, rootMotion?: AnimationClip['rootMotion']) {
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
    ...(rootMotion ? { rootMotion } : {}),
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
  const layer = new EnvironmentPreviewCamera(camera, state, environment, motion, () =>
    puppet.container.getWorldTransformMatrix(),
  );
  return {
    state,
    motion,
    preview,
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

const point = (time: number, offsetX = 0, offsetY = 0) => ({ time, offsetX, offsetY });

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
      state.playback.onAnimationEvent(events);
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
        state.playback.restart();
        const beginning = snapshot();
        state.playback.setPlaybackSpeed(1);
        state.playback.play();
        assert.equal(events.mock.calls[0]![0].name, 'start');
        state.playback.advancePlayback(0.2);
        state.playback.pause();
        const paused = snapshot();
        state.playback.advancePlayback(1);
        assert.deepEqual(snapshot(), paused);
        state.playback.setPlaybackSpeed(2);
        state.playback.play();
        state.playback.advancePlayback(0.1);
        assert.approximately(state.currentTime, 0.4, 1e-12);
        state.playback.beginScrub();
        const count = events.mock.calls.length;
        state.setCurrentTime(0.8);
        const scrubbed = snapshot();
        state.playback.advancePlayback(0.3);
        assert.deepEqual(snapshot(), scrubbed);
        state.setCurrentTime(0.1);
        state.playback.endScrub();
        assert.equal(events.mock.calls.length, count);
        state.playback.setPreviewLoop(true);
        state.playback.restart();
        assert.deepEqual(snapshot(), beginning);
        state.playback.advancePlayback(0.625);
        assert.approximately(state.currentTime, 0.25, 1e-12);
        const looped = snapshot();
        state.playback.pause();
        state.setCurrentTime(0.25);
        assert.deepEqual(snapshot(), looped);
        state.playback.restart();
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
    f.state.playback.setPreviewLoop(true);
    f.state.playback.restart();
    f.state.playback.play();
    for (let i = 0; i < 20; i++) {
      f.state.playback.advancePlayback(1);
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

const rootStep = {
  translationKeys: [
    { time: 0, x: 10, y: 20 },
    { time: 1000, x: 90, y: 20 },
  ],
};

test('authored, temporary and no travel are exclusive over static artwork/ground, with transformed root, IK and silent seeking', () => {
  const f = fixture({ mode: 'smooth' }, rootStep);
  try {
    const source = JSON.stringify(f.clips);
    const animation = f.state.workingAnimation;
    const events = vi.fn();
    f.state.playback.onAnimationEvent(events);
    f.environment.update({ enabled: true });
    const background = environmentPreviewImages(f.environment.getSnapshot().settings);
    f.motion.update({ positionKeys: [point(0, 0), point(1000, 400, -60)] });
    for (const mode of ['authored', 'preview', 'none'] as const) {
      f.state.rootMotion.setWorldDisplacementView(mode);
      for (const cameraMode of ['fixed', 'follow'] as const) {
        f.environment.updateCamera({ mode: cameraMode, x: 400, y: 450, zoom: 0.7 });
        for (const facing of [1, -1]) {
          f.puppet.container.setScale(facing * 2, 2);
          f.puppet.container.rotation = Math.PI / 2;
          for (const time of [0, 0.75, 0.25, 1, 0.5, 0.25]) {
            f.state.setCurrentTime(time);
            f.preview.refresh();
            f.layer.render();
            const offset =
              mode === 'authored'
                ? { x: 0, y: facing * 160 * time }
                : mode === 'preview'
                  ? { x: 400 * time, y: -60 * time }
                  : { x: 0, y: 0 };
            assert.approximately(f.puppet.container.x, 380 + offset.x, 1e-8);
            assert.approximately(f.puppet.container.y, 435 + offset.y, 1e-8);
            assert.approximately(f.center().x, 400 + (cameraMode === 'follow' ? offset.x : 0), 1e-8);
            assert.approximately(f.center().y, 450 + (cameraMode === 'follow' ? offset.y : 0), 1e-8);
            assert.equal(f.puppet.getIK('leg').status, 'solved');
            const marker = getFootContactWorldPosition(
              f.rig.footContactMarkers![0]!,
              f.rig,
              new Map(f.rig.bones.map((bone) => [bone.id, f.puppet.getBone(bone.id).pose])),
              f.puppet.container.getWorldTransformMatrix(),
            );
            assert.isFinite(contactGroundDistance(marker!, 435, 1).distance);
            assert.deepEqual(environmentPreviewImages(f.environment.getSnapshot().settings), background);
          }
        }
      }
    }
    assert.equal(events.mock.calls.length, 0);
    assert.strictEqual(f.state.workingAnimation, animation);
    assert.equal(f.state.historyLength, 0);
    assert.equal(JSON.stringify(f.clips), source);
  } finally {
    f.cleanup();
  }
});

test('authored continuous loops retain total travel across full cycles, pause and scrubs, while reset loops and nonlooping clamp', () => {
  const f = fixture({ mode: 'stepped', fps: 10 }, rootStep);
  try {
    f.environment.update({ enabled: true });
    f.environment.updateCamera({ mode: 'follow' });
    f.state.rootMotion.setWorldDisplacementView('authored', 'continuous');
    f.state.playback.play();
    f.state.playback.advancePlayback(2);
    assert.equal(f.puppet.container.x, 460, 'nonlooping clamps to the complete step');
    assert.isFalse(f.state.playback.isPlaying);
    f.state.playback.setPreviewLoop(true);
    f.state.playback.restart();
    f.state.playback.play();
    for (let i = 1; i <= 10; i++) {
      f.state.playback.advancePlayback(1);
      assert.equal(f.puppet.container.x, 380 + 80 * i);
      assert.equal(f.center().x, f.puppet.container.x);
      f.preview.refresh();
      assert.equal(f.puppet.container.x, 380 + 80 * i, 'repeated samples never add travel');
    }
    f.state.playback.pause();
    f.state.playback.advancePlayback(4);
    assert.equal(f.puppet.container.x, 1180);
    f.state.playback.play();
    f.state.playback.advancePlayback(0.375);
    assert.approximately(f.puppet.container.x, 1204, 1e-9);
    f.state.playback.beginScrub();
    f.state.playback.endScrub();
    assert.approximately(f.puppet.container.x, 1204, 1e-9, 'scrub release alone does not reset travel');
    f.state.setCurrentTime(0.375);
    assert.equal(f.puppet.container.x, 404, 'explicit seek restarts in cycle zero even at the same local timestamp');
    f.state.rootMotion.setWorldDisplacementView('authored', 'reset');
    f.state.playback.restart();
    f.state.playback.advancePlayback(2.375);
    assert.approximately(f.puppet.container.x, 404, 1e-9);
    f.state.playback.restart();
    assert.equal(f.puppet.container.x, 380);
  } finally {
    f.cleanup();
  }
});

test('jump rises and lands relative to stationary ground and background in either camera mode', () => {
  const f = fixture(
    { mode: 'smooth' },
    {
      translationKeys: [
        { time: 0, x: 0, y: 0 },
        { time: 500, y: -100 },
        { time: 1000, x: 0, y: 0 },
      ],
    },
  );
  try {
    f.environment.update({ enabled: true });
    const background = environmentPreviewImages(f.environment.getSnapshot().settings);
    for (const mode of ['fixed', 'follow'] as const) {
      f.environment.updateCamera({ mode });
      for (const [time, height] of [
        [0, 0],
        [0.5, -100],
        [1, 0],
        [0.25, -50],
        [0.5, -100],
      ]) {
        f.state.setCurrentTime(time!);
        assert.equal(f.puppet.container.y, 435 + height!);
        assert.equal(f.center().y, 435 + (mode === 'follow' ? height! : 0));
        assert.deepEqual(environmentPreviewImages(f.environment.getSnapshot().settings), background);
      }
    }
  } finally {
    f.cleanup();
  }
});

test.each(['linear', 'stepped'] as const)(
  'trajectory copy previews %s conversion, preserves points, and replaces root keys in one Undo/Redo',
  (interpolation) => {
    const f = fixture({ mode: 'smooth' }, rootStep);
    try {
      f.puppet.container.setScale(-2, 1.5);
      f.puppet.container.rotation = 0.4;
      f.motion.update({
        enabled: true,
        interpolation,
        positionKeys: [point(0), point(400, 32, -40), point(1400, 80, 0)],
      });
      const points = f.motion.getSnapshot().settings.positionKeys;
      const base = f.state.workingAnimation;
      const source = JSON.stringify(f.clips);
      const samples = [0, 0.2, 0.4, 0.7, 1].map((time) => {
        f.state.setCurrentTime(time);
        return { x: f.puppet.container.x, y: f.puppet.container.y };
      });
      assert.isTrue(f.motion.previewCopy());
      assert.isTrue(f.motion.getSnapshot().copying);
      assert.strictEqual(f.state.workingAnimation, base);
      assert.equal(f.state.historyLength, 0);
      for (const [index, time] of [0, 0.2, 0.4, 0.7, 1].entries()) {
        f.state.setCurrentTime(time);
        assert.approximately(f.puppet.container.x, samples[index]!.x, 1e-8);
        assert.approximately(f.puppet.container.y, samples[index]!.y, 1e-8);
      }
      f.motion.cancelCopy();
      assert.equal(f.state.rootMotion.worldDisplacementMode, 'preview');
      assert.strictEqual(f.state.workingAnimation, base);
      assert.isTrue(f.motion.previewCopy());
      assert.isTrue(f.motion.commitCopy());
      assert.equal(f.state.historyLength, 1);
      const copied = f.state.workingAnimation;
      assert.deepEqual(copied!.tracks, base!.tracks);
      assert.deepEqual(copied!.ikTracks, base!.ikTracks);
      assert.equal(f.state.rootMotion.worldDisplacementMode, 'authored');
      assert.strictEqual(f.motion.getSnapshot().settings.positionKeys, points);
      f.state.undo();
      assert.deepEqual(f.state.workingAnimation, base);
      f.state.redo();
      assert.deepEqual(f.state.workingAnimation, copied);
      assert.equal(JSON.stringify(f.clips), source);
    } finally {
      f.cleanup();
    }
  },
);

test('copy rejects nonzero starting offsets, singular or changed placement and stale documents without losing preview points', () => {
  const f = fixture({ mode: 'smooth' }, rootStep);
  try {
    const base = f.state.workingAnimation;
    f.motion.update({ positionKeys: [point(0, 10), point(1000, 90)] });
    assert.isFalse(f.motion.previewCopy());
    assert.match(f.motion.getSnapshot().message, /starting at X 0/);
    f.motion.update({ positionKeys: [point(0), point(1000, 80)] });
    f.puppet.container.setScale(0, 1);
    assert.isFalse(f.motion.previewCopy());
    assert.match(f.motion.getSnapshot().message, /noninvertible/);
    f.puppet.container.setScale(1);
    assert.isTrue(f.motion.previewCopy());
    f.puppet.container.setScale(-1, 1);
    assert.isFalse(f.motion.commitCopy());
    assert.match(f.motion.getSnapshot().message, /changed/);
    assert.strictEqual(f.state.workingAnimation, base);
    assert.isTrue(f.motion.previewCopy());
    f.state.selectAnimation('jump');
    assert.isFalse(f.motion.commitCopy());
    f.state.selectAnimation('cut');
    assert.equal(f.motion.getSnapshot().settings.positionKeys.length, 2);
    assert.equal(f.state.historyLength, 0);
  } finally {
    f.cleanup();
  }
});

test('continuous root and follow camera share the skeletal held phase after fractional frame updates', () => {
  const f = fixture({ mode: 'stepped', fps: 10 }, rootStep);
  try {
    f.puppet.getIK('leg').enabled = false;
    f.preview.refresh(true);
    f.environment.update({ enabled: true });
    f.environment.updateCamera({ mode: 'follow' });
    f.state.rootMotion.setWorldDisplacementView('authored', 'continuous');
    f.state.playback.setPreviewLoop(true);
    f.state.playback.play();
    for (let i = 1; i <= 240; i++) {
      f.state.playback.advancePlayback(1 / 60);
      const local = f.state.currentTimeMilliseconds;
      const cycles = Math.round((f.state.previewElapsedTimeMilliseconds - local) / 1000);
      const phase = f.puppet.getBone('root').pose.rotation / 0.4;
      assert.approximately(f.puppet.container.x, 380 + cycles * 80 + phase * 80, 1e-10);
      assert.equal(f.center().x, f.puppet.container.x);
    }
  } finally {
    f.cleanup();
  }
});

test('entering root editing frames the first cycle once, freezes follow and can transition into copy preview', () => {
  const f = fixture({ mode: 'smooth' }, rootStep);
  try {
    f.environment.update({ enabled: true });
    f.environment.updateCamera({ mode: 'follow' });
    f.state.rootMotion.setWorldDisplacementView('authored', 'continuous');
    f.state.playback.setPreviewLoop(true);
    f.state.playback.play();
    f.state.playback.advancePlayback(4.5);
    assert.equal(f.center().x, 740);
    f.state.rootMotion.setRootMotionView({ editing: true });
    assert.equal(f.center().x, 420, 'the handle remains in the viewport when accumulated cycles are hidden');
    f.state.setCurrentTime(0.75);
    assert.equal(f.center().x, 420, 'authoring does not follow every pose update');
    f.environment.update({ enabled: false });
    assert.deepEqual([f.camera.scrollX, f.camera.scrollY, f.camera.zoom], [42, -30, 1.2]);
    f.motion.update({ positionKeys: [point(0), point(1000, 80)] });
    assert.isTrue(f.state.rootMotion.rootMotionEditing);
    assert.isTrue(f.motion.previewCopy());
    assert.isFalse(f.state.rootMotion.rootMotionEditing);
    assert.isTrue(f.state.previews.trajectoryCopyActive);
    f.motion.cancelCopy();
    assert.equal(f.state.historyLength, 0);
  } finally {
    f.cleanup();
  }
});

test('Phaser-style matrix prototype accessors retain finite root placement and trajectory conversion', () => {
  const f = fixture({ mode: 'smooth' }, rootStep);
  // Phaser TransformMatrix coefficients live on its prototype rather than enumerable own fields.
  class Placement {
    get a() {
      return -2;
    }
    get b() {
      return 0;
    }
    get c() {
      return 0;
    }
    get d() {
      return 2;
    }
    get tx() {
      return 900;
    }
    get ty() {
      return 500;
    }
  }
  try {
    const placement = new Placement();
    f.state.setCurrentTime(0.5);
    assert.deepEqual(evaluateWorldDisplacement(f.state, undefined, placement), { x: -80, y: 0 });
    const copied = previewTrajectoryToRootMotion(
      { ...f.motion.getSnapshot().settings, positionKeys: [point(0), point(1000, 80, -100)] },
      1000,
      placement,
    );
    assert.equal(copied.translationKeys[0]!.x, 0);
    assert.equal(copied.translationKeys[0]!.y, 0);
    assert.deepEqual(copied.translationKeys[1], { time: 1000, x: -40, y: -50 });
  } finally {
    f.cleanup();
  }
});
