import { EventEmitter } from 'eventemitter3';
import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorIKHandles } from '../src/devtools/animation-editor/AnimationEditorIKHandles.js';
import { AnimationEditorPreview } from '../src/devtools/animation-editor/AnimationEditorPreview.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { IKInspectorController } from '../src/devtools/animation-editor/IKInspectorController.js';
import { ikTargetToWorld, pointerToIKTarget } from '../src/devtools/animation-editor/ikTargetCoordinates.js';
import { localToWorld, type Affine, type Point } from '../src/engine/affineMath.js';
import type { AnimationClip } from '../src/engine/AnimationClip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Math: {
      Vector2: class {
        constructor(
          readonly x: number,
          readonly y: number,
        ) {}
      },
    },
  },
}));
afterEach(() => vi.unstubAllGlobals());

function fixture(mix = 1) {
  const rig = new Rig({
    root: 'root',
    bones: [
      { id: 'root' },
      { id: 'upper', parent: 'root' },
      { id: 'lower', parent: 'upper', y: 60 },
      { id: 'hand', parent: 'lower', y: 50 },
      { id: 'thigh', parent: 'root', x: 150 },
      { id: 'shin', parent: 'thigh', y: 60 },
      { id: 'foot', parent: 'shin', y: 50 },
    ],
    ik: [
      { name: 'handIK', rootBone: 'upper', middleBone: 'lower', endBone: 'hand', mix, bendDirection: -1 },
      { name: 'footIK', rootBone: 'thigh', middleBone: 'shin', endBone: 'foot', priority: 2 },
    ],
  });
  const clip: AnimationClip = {
    name: 'reach',
    duration: 1000,
    loop: false,
    tracks: {},
    events: [{ time: 500, name: 'middle' }],
    ikTracks: { handIK: [{ time: 0, x: 60, y: 60, mix }] },
  };
  const original = JSON.stringify(clip);
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'other' }]);
  state.selectAnimation('reach');
  const scene = puppetScene();
  const input = new EventEmitter();
  const camera = {
    zoom: 1.7,
    scrollX: -80,
    scrollY: 35,
    width: 760,
    height: 640,
    setZoom(zoom: number) {
      this.zoom = zoom;
    },
    getWorldPoint(x: number, y: number) {
      return {
        x: (x - this.width / 2) / this.zoom + this.width / 2 + this.scrollX,
        y: (y - this.height / 2) / this.zoom + this.height / 2 + this.scrollY,
      };
    },
  };
  Object.assign(scene, { input, cameras: { main: camera } });
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  const puppet = new Puppet(scene, { rig, autoUpdate: false, x: 100, y: 80 });
  const preview = new AnimationEditorPreview(state, puppet);
  const handles = new AnimationEditorIKHandles(scene, state, puppet);
  const inspector = new IKInspectorController();
  inspector.bind(state);
  const pointer = (world: Point, id = 1, button = 0) =>
    ({
      id,
      button,
      x: (world.x - camera.width / 2 - camera.scrollX) * camera.zoom + camera.width / 2,
      y: (world.y - camera.height / 2 - camera.scrollY) * camera.zoom + camera.height / 2,
    }) as Phaser.Input.Pointer;
  const localPointer = (point: Point, id = 1) =>
    pointer(localToWorld(point, puppet.container.getWorldTransformMatrix()), id);
  const dispose = () => {
    handles.dispose();
    inspector.dispose();
    preview.dispose();
    puppet.destroy();
  };
  return {
    rig,
    clip,
    original,
    state,
    scene,
    input,
    camera,
    puppet,
    preview,
    handles,
    inspector,
    pointer,
    localPointer,
    browser,
    dispose,
  };
}

function close(actual: Point, expected: Point) {
  assert.approximately(actual.x, expected.x, 1e-7);
  assert.approximately(actual.y, expected.y, 1e-7);
}

test.each([1, -1])(
  'coordinate conversions preserve facing %s, camera pan/zoom and nested affine puppet placement',
  (facing) => {
    const matrix: Affine = { a: facing * 2, b: facing * 0.5, c: 0.3, d: 3, tx: 400, ty: -90 };
    const target = { x: -75, y: 42 };
    const world = ikTargetToWorld(target, matrix);
    const camera = { getWorldPoint: (x: number, y: number) => ({ x: x / 2 + 20, y: y / 2 - 30 }) };
    close(pointerToIKTarget({ x: (world.x - 20) * 2, y: (world.y + 30) * 2 }, camera, matrix)!, target);
    assert.isUndefined(pointerToIKTarget(target, camera, { ...matrix, a: 0, b: 0 }));
    assert.isUndefined(pointerToIKTarget({ x: NaN, y: 0 }, camera, matrix));
  },
);

test.each(['handIK', 'footIK'])(
  '%s handle selection, live drag/release and explicit XY commitment use one history action',
  (id) => {
    const f = fixture();
    try {
      const { state, handles, input, puppet, inspector } = f;
      state.setCurrentTime(0.5);
      state.play();
      const working = state.workingAnimation!;
      const source = state.sourceAnimation;
      const handle = handles.getHandles().find((entry) => entry.id === id)!;
      assert.isTrue(handles.pointerDown(f.pointer(handle.world)));
      assert.equal(state.ik.selectedIKConstraintId, id);
      assert.isNull(state.selectedBoneId);
      assert.isTrue(state.ik.isTimelineIKExpanded(id));
      assert.isFalse(state.isPlaying);
      assert.equal(inspector.getSnapshot().constraintId, id);
      const target = id === 'handIK' ? { x: 30, y: 80 } : { x: 175, y: 75 };
      for (let i = 0; i < 15; i++) input.emit('pointermove', f.localPointer(target));
      state.play(); // An active gesture keeps ownership of the stationary playhead.
      state.advancePlayback(2);
      assert.equal(state.currentTime, 0.5);
      close(
        puppet.getBone(id === 'handIK' ? 'hand' : 'foot').getWorldPosition(),
        localToWorld(target, puppet.container.getWorldTransformMatrix()),
      );
      input.emit('pointerupoutside', f.localPointer(target));
      assert.isNull(state.ik.ikTargetDrag);
      close(state.ik.selectedIKTargetValues!, target);
      assert.isFalse(state.dirty);
      assert.equal(state.historyLength, 0);
      assert.strictEqual(state.workingAnimation, working);
      assert.isFalse(inspector.getSnapshot().dragging);
      assert.isTrue(inspector.getSnapshot().fields[0]!.temporary);
      const observations: number[] = [];
      const release = state.subscribe(() => observations.push(state.historyLength));
      assert.isTrue(inspector.commitTarget());
      release();
      assert.deepEqual(observations, [1]);
      assert.equal(state.ik.findIKPropertyKeyframe(id, 'x')!.value, target.x);
      assert.equal(state.ik.findIKPropertyKeyframe(id, 'y')!.value, target.y);
      assert.isUndefined(state.ik.findIKPropertyKeyframe(id, 'mix'));
      assert.deepEqual(state.ik.ikTargetDraft, {});
      assert.strictEqual(state.workingAnimation!.tracks, working.tracks);
      assert.strictEqual(state.workingAnimation!.events, working.events);
      assert.strictEqual(state.sourceAnimation, source);
      assert.equal(JSON.stringify(f.clip), f.original);
      state.undo();
      assert.strictEqual(state.workingAnimation, working);
      assert.isFalse(state.dirty);
      state.redo();
      assert.isTrue(state.dirty);
      close(state.ik.selectedIKTargetValues!, target);
      assert.equal(state.currentTime, 0.5);
      handles.render();
    } finally {
      f.dispose();
    }
  },
);

test('Escape restores a prior numeric/released preview, ignores other pointers and never authors cancelled movement', () => {
  const f = fixture();
  try {
    f.state.ik.selectIKConstraint('handIK');
    f.inspector.edit('x', '45.0');
    const before = f.state.ik.ikTargetDraft;
    const handle = f.handles.getHandles()[0]!;
    f.handles.pointerDown(f.pointer(handle.world));
    f.input.emit('pointermove', f.localPointer({ x: -30, y: 70 }, 2));
    assert.strictEqual(f.state.ik.ikTargetDraft, before);
    f.input.emit('pointermove', f.localPointer({ x: -30, y: 70 }));
    const escape = new Event('keydown', { cancelable: true });
    Object.assign(escape, { key: 'Escape', isComposing: false });
    f.browser.dispatchEvent(escape);
    assert.isTrue(escape.defaultPrevented);
    assert.isNull(f.state.ik.ikTargetDrag);
    assert.deepEqual(f.state.ik.ikTargetDraft, before);
    assert.equal(f.inspector.getSnapshot().fields[0]!.text, '45');
    f.input.emit('pointerup', f.localPointer({ x: -30, y: 70 }));
    assert.isFalse(f.state.dirty);
    assert.equal(f.state.historyLength, 0);
    assert.isFalse(f.state.ik.endIKTargetDrag());
    assert.isFalse(f.state.ik.previewIKTargetDrag({ x: 5, y: 5 }));
    assert.equal(JSON.stringify(f.clip), f.original);
  } finally {
    f.dispose();
  }
});

test.each(['blur', 'selection', 'scrub', 'undo', 'session', 'hidden', 'locked'])(
  '%s cancels an active gesture and releases the pointer',
  (action) => {
    const f = fixture();
    try {
      f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world));
      f.input.emit('pointermove', f.localPointer({ x: 50, y: 70 }));
      if (action === 'blur') f.browser.dispatchEvent(new Event('blur'));
      if (action === 'selection') f.state.selectBone('hand');
      if (action === 'scrub') f.state.setCurrentTime(0.5);
      if (action === 'undo') f.state.undo();
      if (action === 'session') f.state.selectAnimation('other');
      if (action === 'hidden') f.handles.setVisible(false);
      if (action === 'locked') f.handles.setInteractive(false);
      assert.isNull(f.state.ik.ikTargetDrag);
      f.input.emit('pointermove', f.localPointer({ x: 1000, y: 1000 }));
      assert.isFalse(f.state.dirty);
      assert.equal(f.state.historyLength, 0);
      assert.equal(JSON.stringify(f.clip), f.original);
    } finally {
      f.dispose();
    }
  },
);

test.each([0, 0.4, 1])('influence %s remains unchanged and unreachable handles retain the requested target', (mix) => {
  const f = fixture(mix);
  try {
    f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world));
    const requested = { x: 1000, y: -700 };
    f.input.emit('pointermove', f.localPointer(requested));
    f.input.emit('pointerup', f.localPointer(requested));
    const constraint = f.puppet.getIK('handIK');
    assert.equal(constraint.mix, mix);
    assert.equal(constraint.bendDirection, -1);
    const handle = f.handles.getHandles()[0]!;
    close(handle.world, localToWorld(requested, f.puppet.container.getWorldTransformMatrix()));
    assert.isAbove(Math.hypot(handle.world.x - handle.endpoint.x, handle.world.y - handle.endpoint.y), 500);
    assert.equal(constraint.status, mix === 0 ? 'inactive' : 'clamped');
    assert.equal(f.state.ik.selectedIKTargetValues!.mix, mix);
    f.state.ik.commitIKTarget();
    assert.equal(f.state.workingAnimation!.ikTracks!.handIK!.at(-1)!.x, requested.x);
    assert.equal(f.state.ik.findIKPropertyKeyframe('handIK', 'mix')!.value, mix);
  } finally {
    f.dispose();
  }
});

test.each(['left', 'right'] as const)(
  'real pointer gestures survive %s facing, puppet scale, rotation and enclosing containers',
  (facing) => {
    const f = fixture();
    try {
      const parent = f.scene.add.container(270, -40).setRotation(0.3).setScale(1.2, 0.8);
      parent.add(f.puppet.container);
      f.puppet.container.setScale(2, 3).setRotation(-0.2);
      f.puppet.setFacing(facing);
      const handle = f.handles.getHandles()[0]!;
      // Clicking near the edge preserves the initial grab offset without jumping.
      const matrix = f.puppet.container.getWorldTransformMatrix();
      const start = { x: 61, y: 61 };
      f.handles.pointerDown(f.localPointer(start));
      f.input.emit('pointermove', f.localPointer({ x: 31, y: 81 }));
      close(f.state.ik.selectedIKTargetValues!, { x: 30, y: 80 });
      f.input.emit('pointerup', f.localPointer({ x: 31, y: 81 }));
      close(f.handles.getHandles()[0]!.world, localToWorld({ x: 30, y: 80 }, matrix));
      assert.isAbove(
        Math.hypot(
          handle.world.x - f.handles.getHandles()[0]!.world.x,
          handle.world.y - f.handles.getHandles()[0]!.world.y,
        ),
        1,
      );
    } finally {
      f.dispose();
    }
  },
);

test.each(['provider', 'empty-provider', 'runtime', 'disabled', 'singular'])(
  '%s ownership disables direct manipulation without overriding constraints',
  (owner) => {
    const f = fixture();
    try {
      const constraint = f.puppet.getIK('handIK');
      const target = { x: 140, y: 155 };
      if (owner === 'provider') constraint.setTargetProvider(() => target);
      if (owner === 'empty-provider') constraint.setTargetProvider(() => undefined);
      if (owner === 'runtime') constraint.setTarget(target);
      if (owner === 'disabled') constraint.enabled = false;
      if (owner === 'singular') f.puppet.container.setScale(0);
      f.puppet.posePipeline.syncPose();
      const handle = f.handles.getHandles()[0]!;
      assert.isTrue(f.handles.pointerDown(f.pointer(handle.world)));
      assert.equal(f.state.ik.selectedIKConstraintId, 'handIK');
      assert.isNull(f.state.selectedBoneId);
      assert.isNull(f.state.ik.ikTargetDrag);
      assert.isNotNull(f.inspector.getSnapshot().disabledReason);
      assert.isFalse(f.state.ik.beginIKTargetDrag('handIK'));
      assert.isFalse(f.inspector.commitTarget());
      if (owner === 'provider' || owner === 'runtime') close(constraint.resolvedTarget!, target);
      if (owner === 'empty-provider') assert.equal(constraint.status, 'inactive');
      assert.isFalse(f.state.dirty);
      // Releasing ownership restores normal animation authoring.
      constraint.target = undefined;
      constraint.enabled = true;
      f.puppet.container.setScale(1);
      f.handles.refreshAvailability();
      assert.isTrue(f.state.ik.beginIKTargetDrag('handIK'));
    } finally {
      f.dispose();
    }
  },
);

test('ghost samples and exported JSON exclude drafts; hide/lock do not author, and disposal removes every listener', () => {
  const f = fixture();
  try {
    const ghost = f.state.sampleGhostPose(0.4);
    const exported = f.state.exportJson();
    f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world));
    f.input.emit('pointermove', f.localPointer({ x: 0, y: 100 }));
    assert.equal(f.state.exportJson(), exported);
    assert.deepEqual(f.state.sampleGhostPose(0.4), ghost);
    f.handles.setVisible(false);
    assert.isFalse(f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world)));
    f.handles.setVisible(true);
    f.handles.setInteractive(false);
    assert.isTrue(f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world)));
    assert.isNull(f.state.ik.ikTargetDrag);
    f.handles.setInteractive(true);
    f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world));
    f.handles.dispose();
    assert.isNull(f.state.ik.ikTargetDrag);
    for (const event of ['pointermove', 'pointerup', 'pointerupoutside', 'wheel'])
      assert.equal(f.input.listenerCount(event), 0);
    const snapshot = f.inspector.getSnapshot();
    f.inspector.unbind();
    f.state.ik.selectIKConstraint('footIK');
    assert.isNull(f.inspector.getSnapshot().constraintId);
    assert.notStrictEqual(snapshot, f.inspector.getSnapshot());
  } finally {
    f.inspector.dispose();
    f.preview.dispose();
    f.puppet.destroy();
  }
});

test.each(['visible', 'hidden'] as const)(
  'middle-button pan with %s targets and wheel zoom do not dirty animation',
  (visibility) => {
    const f = fixture();
    try {
      const start = f.pointer({ x: 0, y: 0 }, 1, 1);
      if (visibility === 'hidden') {
        f.handles.setVisible(false);
        f.handles.setInteractive(false);
      }
      f.handles.pointerDown(start);
      const scroll = f.camera.scrollX;
      f.input.emit('pointermove', { id: start.id, x: start.x + 17, y: start.y });
      assert.approximately(f.camera.scrollX, scroll - 10, 1e-8);
      f.input.emit('pointerupoutside', start);
      const released = f.camera.scrollX;
      f.input.emit('pointermove', { id: start.id, x: start.x + 34, y: start.y });
      assert.equal(f.camera.scrollX, released);
      const zoom = f.camera.zoom;
      f.input.emit('wheel', start, [], 0, -200);
      assert.isAbove(f.camera.zoom, zoom);
      assert.isFalse(f.state.dirty);
      assert.isNull(f.state.ik.ikTargetDrag);
    } finally {
      f.dispose();
    }
  },
);

test('provider ownership acquired during dragging cancels the gesture, preserves mix drafts and keeps its target', () => {
  const f = fixture();
  try {
    f.state.ik.selectIKConstraint('handIK');
    f.state.ik.setTemporaryIKProperty('mix', 0.4);
    f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world));
    assert.isFalse(f.state.ik.previewIKTargetDrag({ x: Infinity, y: 0 }));
    f.input.emit('pointermove', f.localPointer({ x: 20, y: 80 }));
    const owned = { x: 120, y: 150 };
    f.puppet.getIK('handIK').setTargetProvider(() => owned);
    f.puppet.posePipeline.syncPose();
    f.handles.refreshAvailability();
    assert.isNull(f.state.ik.ikTargetDrag);
    assert.deepEqual(f.state.ik.ikTargetDraft, { mix: 0.4 });
    f.input.emit('pointerup', f.localPointer({ x: 50, y: 70 }));
    close(f.puppet.getIK('handIK').resolvedTarget!, owned);
    assert.equal(f.puppet.getIK('handIK').targetOwnership, 'provider');
    assert.equal(f.state.historyLength, 0);
    assert.isFalse(f.state.dirty);
    f.puppet.getIK('handIK').setTargetProvider(undefined);
    f.handles.refreshAvailability();
    f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world));
    f.input.emit('pointermove', f.localPointer({ x: 30, y: 70 }));
    f.input.emit('pointerup', f.localPointer({ x: 30, y: 70 }));
    f.state.ik.commitIKTarget();
    assert.deepEqual(f.state.ik.ikTargetDraft, { mix: 0.4 });
    assert.equal(f.state.workingAnimation!.ikTracks!.handIK![0]!.mix, 1);
    assert.equal(f.state.ik.selectedIKTargetValues!.mix, 0.4);
  } finally {
    f.dispose();
  }
});

test.each(['unsupported-scale', 'singular-transform'] as const)(
  '%s chain diagnostics disable dragging and recover after valid transforms return',
  (status) => {
    const f = fixture();
    try {
      f.state.ik.selectIKConstraint('handIK');
      const root = f.puppet.getBone('upper');
      root.pose.scaleX = status === 'unsupported-scale' ? 2 : 0;
      f.puppet.posePipeline.syncPose();
      f.handles.refreshAvailability();
      assert.equal(f.puppet.getIK('handIK').status, status);
      assert.include(
        f.inspector.getSnapshot().disabledReason!,
        status === 'unsupported-scale' ? 'uniform' : 'singular',
      );
      assert.isFalse(f.state.ik.beginIKTargetDrag('handIK'));
      assert.equal(f.state.historyLength, 0);
      root.pose.scaleX = 1;
      f.puppet.posePipeline.syncPose();
      f.handles.refreshAvailability();
      assert.isNull(f.inspector.getSnapshot().disabledReason);
      assert.isTrue(f.state.ik.beginIKTargetDrag('handIK'));
      f.state.ik.cancelIKTargetDrag();
    } finally {
      f.dispose();
    }
  },
);

test('handle teardown is idempotent and late input/render calls never touch destroyed graphics', () => {
  const f = fixture();
  const graphics = Reflect.get(f.handles, 'graphics') as Phaser.GameObjects.Graphics;
  const destroy = vi.spyOn(graphics, 'destroy');
  const clear = vi.spyOn(graphics, 'clear');
  try {
    f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world));
    f.handles.dispose();
    f.handles.dispose();
    f.handles.render();
    f.handles.setVisible(true);
    f.handles.setInteractive(true);
    assert.deepEqual(f.handles.getHandles(), []);
    assert.isFalse(f.handles.pointerDown(f.localPointer({ x: 20, y: 60 })));
    f.input.emit('pointermove', f.localPointer({ x: 20, y: 60 }));
    assert.isNull(f.state.ik.ikTargetDrag);
    assert.equal(destroy.mock.calls.length, 1);
    assert.equal(clear.mock.calls.length, 0);
    assert.equal(f.state.historyLength, 0);
  } finally {
    f.dispose();
  }
});

test('opt-in ground snapping changes only an explicit IK drag draft until Set Target Key', () => {
  const f = fixture();
  f.handles.dispose();
  const guide = { enabled: true, snapEnabled: true, y: 210 };
  const handles = new AnimationEditorIKHandles(f.scene, f.state, f.puppet, {
    guide: () => guide,
    dragging: () => false,
  });
  try {
    f.state.ik.selectIKConstraint('handIK');
    const original = f.state.workingAnimation;
    const start = handles.getHandles().find((entry) => entry.id === 'handIK')!.world;
    assert.isTrue(handles.pointerDown(f.pointer(start)));
    f.input.emit('pointermove', f.pointer({ x: start.x + 10, y: guide.y + 2 }));
    const world = localToWorld(f.state.ik.selectedIKTargetValues!, f.puppet.container.getWorldTransformMatrix());
    assert.closeTo(world.y, guide.y, 1e-8);
    assert.strictEqual(f.state.workingAnimation, original);
    f.input.emit('pointerup', f.pointer({ x: start.x + 10, y: guide.y + 2 }));
    assert.strictEqual(f.state.workingAnimation, original);
    assert.isTrue(f.state.ik.commitIKTarget());
    assert.equal(f.state.historyLength, 1);
    f.state.undo();
    assert.strictEqual(f.state.workingAnimation, original);
  } finally {
    handles.dispose();
    f.dispose();
  }
});

test.each(['left', 'right'] as const)(
  'background placement moves the entire %s-facing character through playback without camera, key or history edits',
  (facing) => {
    const f = fixture();
    try {
      f.puppet.container.setScale(2);
      f.puppet.setFacing(facing);
      f.state.rootMotion.setRootPosition({ x: 0, y: 0 }, 0);
      f.state.rootMotion.setRootPosition({ x: 80, y: 0 }, 1);
      f.state.setCurrentTime(0.5);
      f.state.selectBone('upper');
      f.handles.setVisible(false);
      f.handles.setInteractive(false);
      const original = f.state.exportJson();
      const history = f.state.historyLength;
      const selection = f.state.selectedBoneId;
      const before = { x: f.puppet.container.x, y: f.puppet.container.y };
      const camera = { x: f.camera.scrollX, y: f.camera.scrollY, zoom: f.camera.zoom };
      const start = f.pointer({ x: 0, y: 0 });
      f.handles.startCharacterDrag(start);
      f.input.emit('pointermove', { id: start.id, x: start.x + 2, y: start.y + 2 });
      close(f.puppet.container, before);
      f.handles.pointerDown(f.pointer({ x: 0, y: 0 }, 2));
      f.input.emit('pointermove', { id: 2, x: start.x + 100, y: start.y });
      close(f.puppet.container, before);
      f.input.emit('pointermove', { id: start.id, x: start.x + 34, y: start.y + 17 });
      close(f.puppet.container, { x: before.x + 20, y: before.y + 10 });
      f.input.emit('pointermove', { id: start.id, x: start.x, y: start.y });
      close(f.puppet.container, before);
      f.input.emit('pointermove', { id: start.id, x: start.x + 34, y: start.y + 17 });
      f.input.emit('pointerupoutside', start);
      f.input.emit('pointermove', { id: start.id, x: start.x + 100, y: start.y });
      f.preview.refresh(true);
      close(f.puppet.container, { x: before.x + 20, y: before.y + 10 });
      f.state.setCurrentTime(1);
      close(f.puppet.container, { x: before.x + 20 + (facing === 'left' ? -80 : 80), y: before.y + 10 });
      assert.deepEqual({ x: f.camera.scrollX, y: f.camera.scrollY, zoom: f.camera.zoom }, camera);
      assert.equal(f.state.selectedBoneId, selection);
      assert.equal(f.state.exportJson(), original);
      assert.equal(f.state.historyLength, history);
      assert.equal(JSON.stringify(f.clip), f.original);
      assert.isTrue(f.state.selectAnimation('other', { keepChanges: true }));
      close(f.puppet.container, { x: 120, y: 90 });
      assert.isTrue(f.state.selectAnimation('reach', { keepChanges: true }));
      close(f.puppet.container, { x: before.x + 20 + (facing === 'left' ? -80 : 80), y: before.y + 10 });
    } finally {
      f.dispose();
    }
  },
);

test.each(['blur', 'escape', 'clip switch', 'rig mode', 'dispose'] as const)(
  'background placement stops on %s',
  (ending) => {
    const f = fixture();
    try {
      const start = f.pointer({ x: 0, y: 0 });
      f.handles.startCharacterDrag(start);
      f.input.emit('pointermove', { id: start.id, x: start.x + 34, y: start.y });
      const offset = f.state.previewPlacementOffset;
      if (ending === 'blur') f.browser.dispatchEvent(new Event('blur'));
      else if (ending === 'escape') f.browser.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
      else if (ending === 'clip switch') f.state.selectAnimation('other');
      else if (ending === 'rig mode') f.state.setEditorMode('rig');
      else f.handles.dispose();
      f.input.emit('pointermove', { id: start.id, x: start.x + 68, y: start.y });
      assert.strictEqual(f.state.previewPlacementOffset, offset);
      assert.isFalse(f.handles.gestureActive);
      assert.isFalse(f.state.dirty);
      assert.equal(f.state.historyLength, 0);
    } finally {
      f.dispose();
    }
  },
);
