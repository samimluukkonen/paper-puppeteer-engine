import { EventEmitter } from 'eventemitter3';
import type Phaser from 'phaser';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorGroundHandle } from '../src/devtools/animation-editor/AnimationEditorGroundHandle.js';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { AnimationGroundPanel } from '../src/devtools/animation-editor/AnimationGroundPanel.js';
import { IKInspectorController } from '../src/devtools/animation-editor/IKInspectorController.js';
import { alignIKTargetToGuide, snapIKTargetToGuide } from '../src/devtools/animation-editor/ikTargetCoordinates.js';
import { RigEditorInputController } from '../src/devtools/rig-editor/RigEditorInputController.js';
import type { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { editorWorldViewport } from '../src/devtools/shared/editorCamera.js';
import { groundGuideGeometry } from '../src/devtools/shared/groundGuide.js';
import { GroundGuideWorkspace } from '../src/devtools/shared/GroundGuideWorkspace.js';
import { GUIDE_TARGETS } from '../src/devtools/shared/guides/anchors.js';
import { getGuideById } from '../src/devtools/shared/guides/registry.js';
import { localToWorld, type Affine } from '../src/engine/affineMath.js';
import type { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { puppetScene } from './helpers/puppetScene.js';

afterEach(() => vi.unstubAllGlobals());

function fixture(zoom = 2) {
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
  const workspace = new GroundGuideWorkspace('animation-preview-world', () => storage);
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'mid', parent: 'root', y: 50 }, { id: 'foot', parent: 'mid', y: 50 }],
    ik: [{ name: 'leg', rootBone: 'root', middleBone: 'mid', endBone: 'foot', endOffset: { x: 4, y: 12 } }],
  });
  const clip = {
    name: 'walk',
    duration: 1000,
    loop: true,
    tracks: {
      root: [
        { time: 0, y: 0 },
        { time: 1000, y: 30 },
      ],
    },
    events: [{ time: 400, name: 'step' }],
  };
  const state = new AnimationEditorState(rig, [clip, { ...clip, name: 'other' }]);
  state.selectAnimation('walk');
  const scene = puppetScene();
  const input = new EventEmitter();
  const camera = {
    x: 20,
    y: 30,
    width: 800,
    height: 700,
    zoom,
    scrollX: -80,
    scrollY: 170,
    originX: 0.5,
    originY: 0.5,
  };
  Object.assign(scene, { input, cameras: { main: camera } });
  workspace.bind('hero');
  workspace.update({ enabled: true, y: 500 });
  const handle = new AnimationEditorGroundHandle(scene, workspace, state);
  const pointer = (x: number, y: number, id = 1, button = 0) => {
    const view = editorWorldViewport(camera)!;
    return {
      x: (x - view.left) * camera.zoom + camera.x,
      y: (y - view.top) * camera.zoom + camera.y,
      id,
      button,
    } as Phaser.Input.Pointer;
  };
  const labelPointer = () => {
    const geometry = groundGuideGeometry(workspace.getSnapshot().guide, camera)!;
    return pointer(geometry.labelX + 5 / camera.zoom, geometry.labelY + 5 / camera.zoom);
  };
  return { browser, storage, workspace, rig, state, scene, input, camera, handle, pointer, labelPointer };
}

test.each([0.5, 1, 2, 4])(
  'ground label drag at zoom %s updates live Y, commits once and never changes animation data',
  (zoom) => {
    const f = fixture(zoom);
    try {
      const before = f.state.packageAnimations();
      const rig = JSON.stringify(f.rig);
      f.state.play();
      const start = f.labelPointer();
      const writes = f.storage.setItem.mock.calls.length;
      assert.isTrue(f.handle.pointerDown(start));
      f.input.emit('pointermove', { x: start.x, y: start.y + 40 * zoom, id: 99 });
      assert.equal(f.workspace.getSnapshot().guide.y, 500);
      f.input.emit('pointermove', { x: start.x, y: start.y + 40 * zoom, id: start.id });
      assert.equal(f.workspace.getSnapshot().guide.y, 540);
      assert.isTrue(f.state.isPlaying);
      f.state.advancePlayback(0.6);
      f.state.advancePlayback(0.7);
      f.state.pause();
      f.state.beginScrub();
      f.state.setCurrentTime(0.8);
      f.state.setCurrentTime(0.2);
      f.state.endScrub();
      f.camera.scrollY += 10;
      f.input.emit('pointerupoutside', { x: start.x, y: start.y + 40 * zoom, id: start.id });
      assert.equal(f.workspace.getSnapshot().guide.y, 550);
      assert.equal(f.storage.setItem.mock.calls.length, writes + 1);
      assert.isFalse(f.workspace.getSnapshot().dragging);
      f.workspace.undo();
      assert.equal(f.workspace.getSnapshot().guide.y, 500);
      f.workspace.redo();
      assert.equal(f.workspace.getSnapshot().guide.y, 550);
      assert.deepEqual(f.state.packageAnimations(), before);
      assert.equal(JSON.stringify(f.rig), rig);
      assert.isFalse(f.state.dirty);
      assert.equal(f.state.historyLength, 0);
      f.state.selectAnimation('other');
      assert.equal(f.workspace.getSnapshot().guide.y, 550);
    } finally {
      f.handle.dispose();
    }
  },
);

test('rig mode ground tags own the pointer without moving markers, artwork or character placement', () => {
  const f = fixture();
  f.state.setEditorMode('rig');
  const rig = new RigEditorState(
    new Rig({
      root: 'root',
      bones: [{ id: 'root' }],
      footContactMarkers: [{ id: 'sole', name: 'Sole', boneId: 'root', localX: 12, localY: 28 }],
    }),
  );
  rig.selectFootContactMarker('sole');
  const original = rig.workingCopy;
  const animation = f.state.packageAnimations();
  const editor = {
    state: rig,
    editBone: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    refresh: vi.fn(),
    moveCharacter: vi.fn(),
    previewArtwork: vi.fn(),
    finishArtworkGesture: vi.fn(),
  };
  const input = new RigEditorInputController(
    f.scene,
    {} as Puppet,
    editor,
    {} as RigEditorOverlay,
    vi.fn(),
    vi.fn(),
    (pointer) => f.handle.pointerDown(pointer),
  );
  input.enable();
  try {
    const start = f.labelPointer();
    f.input.emit('pointerdown', start);
    assert.isTrue(f.handle.dragging);
    f.input.emit('pointermove', { x: start.x, y: start.y + 40, id: start.id });
    assert.equal(f.workspace.getSnapshot().guide.y, 520);
    f.input.emit('pointerupoutside', { x: start.x, y: start.y + 40, id: start.id });
    assert.isFalse(f.handle.dragging);
    assert.strictEqual(rig.workingCopy, original);
    assert.equal(rig.historyLength, 0);
    assert.isFalse(rig.dirty);
    assert.equal(editor.moveCharacter.mock.calls.length, 0);
    assert.equal(editor.previewArtwork.mock.calls.length, 0);
    assert.deepEqual(f.state.packageAnimations(), animation);
    assert.equal(f.state.historyLength, 0);
    assert.isFalse(f.state.dirty);
    f.workspace.undo();
    assert.equal(f.workspace.getSnapshot().guide.y, 500);
    f.input.emit('pointerdown', f.labelPointer());
    f.input.emit('pointermove', { x: start.x, y: start.y + 60, id: start.id });
    const escape = new Event('keydown', { cancelable: true });
    Object.assign(escape, { key: 'Escape' });
    f.browser.dispatchEvent(escape);
    assert.equal(f.workspace.getSnapshot().guide.y, 500);
    assert.strictEqual(rig.workingCopy, original);
  } finally {
    input.disable();
    f.handle.dispose();
  }
});

test('only the dedicated handle captures ground drags, with Escape, mode/session cancellation and complete cleanup', () => {
  const f = fixture();
  const add = vi.spyOn(f.browser, 'addEventListener');
  const remove = vi.spyOn(f.browser, 'removeEventListener');
  // A second instance demonstrates that all listeners it owns are independently removable.
  const extra = new AnimationEditorGroundHandle(f.scene, f.workspace, f.state);
  extra.dispose();
  assert.equal(add.mock.calls.length, remove.mock.calls.length);
  try {
    assert.isFalse(f.handle.pointerDown(f.pointer(500, 500)));
    assert.isFalse(
      f.handle.pointerDown({ x: f.labelPointer().x, y: f.labelPointer().y, id: 1, button: 1 } as Phaser.Input.Pointer),
    );
    const writes = f.storage.setItem.mock.calls.length;
    const start = f.labelPointer();
    f.handle.pointerDown(start);
    f.input.emit('pointermove', { x: start.x, y: start.y + 80, id: start.id });
    const escape = new Event('keydown', { cancelable: true });
    Object.assign(escape, { key: 'Escape' });
    f.browser.dispatchEvent(escape);
    assert.isTrue(escape.defaultPrevented);
    assert.equal(f.workspace.getSnapshot().guide.y, 500);
    assert.equal(f.storage.setItem.mock.calls.length, writes);
    f.input.emit('pointerup', { x: start.x, y: start.y + 90, id: start.id });
    assert.equal(f.workspace.getSnapshot().guide.y, 500);
    for (const cancel of [
      () => f.state.selectAnimation('other'),
      () => f.state.setEditorMode('rig-tweak'),
      () => f.browser.dispatchEvent(new Event('blur')),
      () => f.workspace.bind('other'),
    ]) {
      f.state.setEditorMode('animation');
      f.handle.pointerDown(f.labelPointer());
      f.input.emit('pointermove', { x: f.labelPointer().x, y: start.y + 90, id: 1 });
      cancel();
      assert.isFalse(f.handle.dragging);
      assert.isFalse(f.workspace.getSnapshot().dragging);
    }
  } finally {
    f.handle.dispose();
    f.handle.dispose();
  }
  assert.equal(f.input.listenerCount('pointermove'), 0);
  assert.equal(f.input.listenerCount('pointerup'), 0);
  assert.equal(f.input.listenerCount('pointerupoutside'), 0);
  assert.isFalse(f.handle.pointerDown(f.pointer(0, 0)));
});

test('ground history is bounded and per character; cancellation/no-op release do not write or clear redo', () => {
  const f = fixture();
  try {
    f.workspace.update({ y: 510 });
    f.workspace.undo();
    const writes = f.storage.setItem.mock.calls.length;
    f.workspace.beginDrag();
    f.workspace.previewDrag(600);
    f.workspace.cancelDrag();
    f.workspace.beginDrag();
    f.workspace.endDrag();
    assert.equal(f.storage.setItem.mock.calls.length, writes);
    assert.isTrue(f.workspace.getSnapshot().canRedo);
    f.workspace.bind('other');
    assert.isFalse(f.workspace.getSnapshot().canUndo);
    f.workspace.bind('hero');
    f.workspace.redo();
    assert.equal(f.workspace.getSnapshot().guide.y, 510);
    for (let i = 0; i < 110; i++) f.workspace.update({ y: i });
    for (let i = 0; i < 100; i++) f.workspace.undo();
    assert.isFalse(f.workspace.getSnapshot().canUndo);
    assert.equal(f.workspace.getSnapshot().guide.y, 9);
  } finally {
    f.handle.dispose();
  }
});

test.each([1, -1])('IK target alignment and optional eight-pixel snapping respect full affine facing %s', (facing) => {
  const matrix: Affine = { a: facing * 1.8, b: facing * 0.4, c: 0.6, d: 2, tx: 300, ty: 435 };
  const target = { x: 20, y: 40 };
  const world = localToWorld(target, matrix);
  const aligned = alignIKTargetToGuide(target, matrix, 560)!;
  const result = localToWorld(aligned, matrix);
  assert.approximately(result.x, world.x, 1e-8);
  assert.approximately(result.y, 560, 1e-8);
  const guide = { enabled: true, snapEnabled: true, y: world.y + 3 };
  assert.approximately(localToWorld(snapIKTargetToGuide(target, matrix, guide, 2), matrix).y, guide.y, 1e-8);
  assert.strictEqual(snapIKTargetToGuide(target, matrix, guide, 4), target);
  assert.strictEqual(snapIKTargetToGuide(target, matrix, { ...guide, snapEnabled: false }, 1), target);
  assert.strictEqual(snapIKTargetToGuide(target, matrix, { ...guide, enabled: false }, 1), target);
  assert.isUndefined(alignIKTargetToGuide(target, { ...matrix, a: 0, b: 0 }, 500));
  assert.isUndefined(alignIKTargetToGuide(target, matrix, NaN));
});

test('alignment commits through existing XY key authoring with one undo and preserves bones, events, duration and mix', () => {
  const f = fixture();
  try {
    const state = f.state;
    state.ik.selectIKConstraint('leg');
    state.setCurrentTime(0.3);
    const original = state.workingAnimation!;
    const values = state.ik.selectedIKTargetValues!;
    assert.isTrue(state.ik.commitIKTarget({ x: values.x, y: 75 }));
    const committed = state.workingAnimation!;
    assert.equal(state.historyLength, 1);
    assert.strictEqual(committed.tracks, original.tracks);
    assert.strictEqual(committed.events, original.events);
    assert.equal(committed.duration, original.duration);
    assert.equal(state.ik.selectedIKTargetValues!.mix, values.mix);
    assert.equal(state.ik.findIKPropertyKeyframe('leg', 'y')!.value, 75);
    state.undo();
    assert.strictEqual(state.workingAnimation, original);
    assert.isTrue(state.canRedo);
    f.workspace.update({ y: 530, snapEnabled: true });
    f.workspace.undo();
    assert.isTrue(state.canRedo);
    state.redo();
    assert.strictEqual(state.workingAnimation, committed);
    state.ik.setIKManipulationDisabledReason('leg', 'External owner');
    assert.isFalse(state.ik.commitIKTarget({ x: 0, y: 100 }));
    assert.strictEqual(state.workingAnimation, committed);
  } finally {
    f.handle.dispose();
  }
});

test('collapsed controls explain missing sole data, allow empty clips and keep alignment disabled without a target', () => {
  const f = fixture();
  const inspector = new IKInspectorController();
  inspector.bind(f.state);
  try {
    const markup = renderToStaticMarkup(
      createElement(AnimationGroundPanel, { workspace: f.workspace, ikInspector: inspector, alignTarget: vi.fn() }),
    );
    assert.notInclude(markup, 'open=""');
    assert.include(markup, 'No sole-contact marker');
    assert.include(markup, 'disabled="">Align IK target Y to guide');
    for (const step of getGuideById('animation-ground-reference')!.steps) {
      if (step.targetId !== GUIDE_TARGETS.animationCanvas) assert.include(markup, `data-guide-id="${step.targetId}"`);
    }
    assert.notInclude(markup, 'data-guide-id="scene-ground-');
    f.state.selectAnimation(null);
    assert.isTrue(f.handle.pointerDown(f.labelPointer()));
    f.handle.dispose();
    assert.isFalse(f.workspace.getSnapshot().dragging);
    assert.equal(f.workspace.getSnapshot().guide.y, 500);
  } finally {
    inspector.dispose();
    f.handle.dispose();
  }
});
