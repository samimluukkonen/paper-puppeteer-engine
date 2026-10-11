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
      assert.equal(state.selectedIKConstraintId, id);
      assert.isNull(state.selectedBoneId);
      assert.isTrue(state.isTimelineIKExpanded(id));
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
      assert.isNull(state.ikTargetDrag);
      close(state.selectedIKTargetValues!, target);
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
      assert.equal(state.findIKPropertyKeyframe(id, 'x')!.value, target.x);
      assert.equal(state.findIKPropertyKeyframe(id, 'y')!.value, target.y);
      assert.isUndefined(state.findIKPropertyKeyframe(id, 'mix'));
      assert.deepEqual(state.ikTargetDraft, {});
      assert.strictEqual(state.workingAnimation!.tracks, working.tracks);
      assert.strictEqual(state.workingAnimation!.events, working.events);
      assert.strictEqual(state.sourceAnimation, source);
      assert.equal(JSON.stringify(f.clip), f.original);
      state.undo();
      assert.strictEqual(state.workingAnimation, working);
      assert.isFalse(state.dirty);
      state.redo();
      assert.isTrue(state.dirty);
      close(state.selectedIKTargetValues!, target);
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
    f.state.selectIKConstraint('handIK');
    f.inspector.edit('x', '45.0');
    const before = f.state.ikTargetDraft;
    const handle = f.handles.getHandles()[0]!;
    f.handles.pointerDown(f.pointer(handle.world));
    f.input.emit('pointermove', f.localPointer({ x: -30, y: 70 }, 2));
    assert.strictEqual(f.state.ikTargetDraft, before);
    f.input.emit('pointermove', f.localPointer({ x: -30, y: 70 }));
    const escape = new Event('keydown', { cancelable: true });
    Object.assign(escape, { key: 'Escape', isComposing: false });
    f.browser.dispatchEvent(escape);
    assert.isTrue(escape.defaultPrevented);
    assert.isNull(f.state.ikTargetDrag);
    assert.deepEqual(f.state.ikTargetDraft, before);
    assert.equal(f.inspector.getSnapshot().fields[0]!.text, '45');
    f.input.emit('pointerup', f.localPointer({ x: -30, y: 70 }));
    assert.isFalse(f.state.dirty);
    assert.equal(f.state.historyLength, 0);
    assert.isFalse(f.state.endIKTargetDrag());
    assert.isFalse(f.state.previewIKTargetDrag({ x: 5, y: 5 }));
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
      assert.isNull(f.state.ikTargetDrag);
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
    assert.equal(f.state.selectedIKTargetValues!.mix, mix);
    f.state.commitIKTarget();
    assert.equal(f.state.workingAnimation!.ikTracks!.handIK!.at(-1)!.x, requested.x);
    assert.equal(f.state.findIKPropertyKeyframe('handIK', 'mix')!.value, mix);
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
      close(f.state.selectedIKTargetValues!, { x: 30, y: 80 });
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
      f.puppet.syncPose();
      const handle = f.handles.getHandles()[0]!;
      assert.isTrue(f.handles.pointerDown(f.pointer(handle.world)));
      assert.equal(f.state.selectedIKConstraintId, 'handIK');
      assert.isNull(f.state.selectedBoneId);
      assert.isNull(f.state.ikTargetDrag);
      assert.isNotNull(f.inspector.getSnapshot().disabledReason);
      assert.isFalse(f.state.beginIKTargetDrag('handIK'));
      assert.isFalse(f.inspector.commitTarget());
      if (owner === 'provider' || owner === 'runtime') close(constraint.resolvedTarget!, target);
      if (owner === 'empty-provider') assert.equal(constraint.status, 'inactive');
      assert.isFalse(f.state.dirty);
      // Releasing ownership restores normal animation authoring.
      constraint.target = undefined;
      constraint.enabled = true;
      f.puppet.container.setScale(1);
      f.handles.refreshAvailability();
      assert.isTrue(f.state.beginIKTargetDrag('handIK'));
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
    assert.isNull(f.state.ikTargetDrag);
    f.handles.setInteractive(true);
    f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world));
    f.handles.dispose();
    assert.isNull(f.state.ikTargetDrag);
    for (const event of ['pointermove', 'pointerup', 'pointerupoutside', 'wheel'])
      assert.equal(f.input.listenerCount(event), 0);
    const snapshot = f.inspector.getSnapshot();
    f.inspector.unbind();
    f.state.selectIKConstraint('footIK');
    assert.isNull(f.inspector.getSnapshot().constraintId);
    assert.notStrictEqual(snapshot, f.inspector.getSnapshot());
  } finally {
    f.inspector.dispose();
    f.preview.dispose();
    f.puppet.destroy();
  }
});

test('middle-button pan and wheel zoom reuse editor camera utilities without dirtying animation', () => {
  const f = fixture();
  try {
    const start = f.pointer({ x: 0, y: 0 }, 1, 1);
    f.handles.pointerDown(start);
    const scroll = f.camera.scrollX;
    f.input.emit('pointermove', { id: start.id, x: start.x + 17, y: start.y });
    assert.approximately(f.camera.scrollX, scroll - 10, 1e-8);
    f.input.emit('pointerup', start);
    const zoom = f.camera.zoom;
    f.input.emit('wheel', start, [], 0, -200);
    assert.isAbove(f.camera.zoom, zoom);
    assert.isFalse(f.state.dirty);
  } finally {
    f.dispose();
  }
});

test('provider ownership acquired during dragging cancels the gesture, preserves mix drafts and keeps its target', () => {
  const f = fixture();
  try {
    f.state.selectIKConstraint('handIK');
    f.state.setTemporaryIKProperty('mix', 0.4);
    f.handles.pointerDown(f.pointer(f.handles.getHandles()[0]!.world));
    assert.isFalse(f.state.previewIKTargetDrag({ x: Infinity, y: 0 }));
    f.input.emit('pointermove', f.localPointer({ x: 20, y: 80 }));
    const owned = { x: 120, y: 150 };
    f.puppet.getIK('handIK').setTargetProvider(() => owned);
    f.puppet.syncPose();
    f.handles.refreshAvailability();
    assert.isNull(f.state.ikTargetDrag);
    assert.deepEqual(f.state.ikTargetDraft, { mix: 0.4 });
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
    f.state.commitIKTarget();
    assert.deepEqual(f.state.ikTargetDraft, { mix: 0.4 });
    assert.equal(f.state.workingAnimation!.ikTracks!.handIK![0]!.mix, 1);
    assert.equal(f.state.selectedIKTargetValues!.mix, 0.4);
  } finally {
    f.dispose();
  }
});
