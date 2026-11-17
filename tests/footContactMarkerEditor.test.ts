import { EventEmitter } from 'eventemitter3';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { createNewCharacter } from '../src/devtools/animation-editor/characterDocuments.js';
import { AttachmentController } from '../src/devtools/rig-editor/AttachmentController.js';
import { FootContactMarkersPanel } from '../src/devtools/rig-editor/FootContactMarkersPanel.js';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import type { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { localToWorld } from '../src/engine/affineMath.js';
import { parseRigDefinition } from '../src/engine/externalData.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import type { RigDefinition } from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Vector2: class {
        constructor(
          public x: number,
          public y: number,
        ) {}
      },
    },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));
afterEach(() => vi.unstubAllGlobals());

const skeleton: RigDefinition = {
  root: 'base',
  bones: [
    { id: 'base', x: 12, y: -5, rotation: 0.2, scaleX: 1.2, scaleY: 0.9 },
    { id: 'segment', parent: 'base', x: 60, rotation: -0.4, scaleX: 0.7, scaleY: 1.3 },
    { id: 'tip', parent: 'segment', x: 50, rotation: 0.3, length: 24 },
  ],
};
const marker = { id: 'contact', name: 'Sole', boneId: 'tip', localX: 12, localY: 28 };
const definition = { ...skeleton, footContactMarkers: [marker] };

function fixture(facing: 'left' | 'right' = 'right') {
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  const scene = puppetScene();
  const input = new EventEmitter();
  const events = new EventEmitter();
  const camera = {
    x: 0,
    y: 0,
    width: 760,
    height: 640,
    zoom: 2.5,
    scrollX: -30,
    scrollY: 70,
    originX: 0.5,
    originY: 0.5,
    matrixCombined: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    getWorldPoint(x: number, y: number) {
      return { x: x / this.zoom + this.scrollX, y: y / this.zoom + this.scrollY };
    },
  };
  Object.assign(scene, { input, events, cameras: { main: camera } });
  const destroyed: ReturnType<typeof vi.fn>[] = [];
  const graphics = scene.add.graphics.bind(scene.add);
  scene.add.graphics = () => {
    const object = graphics();
    const destroy = vi.fn(object.destroy.bind(object));
    destroyed.push(destroy);
    return Object.assign(object, {
      setScrollFactor() {
        return this;
      },
      destroy,
    });
  };
  const text = scene.add.text.bind(scene.add);
  scene.add.text = (...args) => {
    const object = text(...args);
    const destroy = vi.fn(object.destroy.bind(object));
    destroyed.push(destroy);
    return Object.assign(object, {
      setScrollFactor() {
        return this;
      },
      setText() {
        return this;
      },
      setColor() {
        return this;
      },
      destroy,
    });
  };
  const rig = new Rig(definition);
  const puppet = new Puppet(scene, { rig, x: 210, y: 170, autoUpdate: false });
  puppet.container.setScale(1.7, 0.8).setRotation(-0.2);
  scene.add.container(50, -20).setScale(1.2, 0.8).setRotation(0.3).add(puppet.container);
  const state = new RigEditorState(rig);
  state.facing = facing;
  const controller = new AttachmentController();
  const editor = new RigEditor(scene, puppet, () => controller.bind(editor), state);
  controller.bind(editor);
  editor.enable();
  const overlay = Reflect.get(editor, 'overlay') as RigEditorOverlay;
  const pointer = (local: { x: number; y: number }, id = 1) => {
    const world = localToWorld(local, puppet.getBone('tip').container.getWorldTransformMatrix());
    return {
      x: (world.x - camera.scrollX) * camera.zoom,
      y: (world.y - camera.scrollY) * camera.zoom,
      id,
      isDown: true,
      middleButtonDown: () => false,
      leftButtonDown: () => true,
    };
  };
  const start = () =>
    input.emit(
      'pointerdown',
      pointer({ x: state.getFootContactMarker('contact').localX, y: state.getFootContactMarker('contact').localY }),
    );
  const move = (x: number, y: number) => input.emit('pointermove', pointer({ x, y }));
  const release = (x: number, y: number) => input.emit('pointerupoutside', pointer({ x, y }));
  const dispose = () => {
    editor.disable();
    controller.dispose();
    puppet.destroy();
  };
  return {
    browser,
    scene,
    puppet,
    state,
    controller,
    editor,
    overlay,
    camera,
    input,
    events,
    pointer,
    start,
    move,
    release,
    destroyed,
    dispose,
  };
}

test('create and independently select arbitrary contacts on existing and new rigs with stable unique IDs', () => {
  const state = new RigEditorState(new Rig(skeleton));
  state.selectBone('tip');
  state.createFootContactMarker({ id: state.suggestFootContactMarkerId(), name: 'First', boneId: 'tip' });
  assert.equal(state.getFootContactMarker('contact').localY, 24);
  state.createFootContactMarker({ id: state.suggestFootContactMarkerId(), name: 'First', boneId: 'base' });
  assert.equal(state.selectedFootContactMarkerId, 'contact-2');
  state.selectFootContactMarker('contact');
  assert.isNull(state.selection);
  assert.isNull(state.selectedIKConstraintId);
  assert.equal(state.selectedFootContactMarkerId, 'contact');
  state.selectBone('base');
  assert.isNull(state.selectedFootContactMarkerId);
  assert.isUndefined(state.source.footContactMarkers);
  state.undo();
  assert.equal(state.workingCopy.footContactMarkers?.length, 1);
  state.undo();
  assert.isUndefined(state.workingCopy.footContactMarkers);
  assert.isFalse(state.dirty);
  state.redo();
  state.redo();
  assert.equal(state.exportRig(false).footContactMarkers?.length, 2);
  const draft = createNewCharacter({ name: 'One point', id: 'one-point' });
  draft.rig.createFootContactMarker({ id: 'point', name: 'Point', boneId: 'root' });
  assert.equal(draft.rig.getFootContactMarker('point').localY, 0);
});

test('rename, reassign bone, numeric edit and delete share rig history and serialize through reload/recovery', () => {
  const state = new RigEditorState(new Rig(definition));
  state.updateFootContactMarker('contact', { name: 'Heel' });
  state.updateFootContactMarker('contact', { boneId: 'segment' });
  state.updateFootContactMarker('contact', { localX: -15, localY: 35 });
  assert.equal(state.historyLength, 3);
  assert.deepEqual(parseRigDefinition(JSON.parse(state.exportJson(false))).footContactMarkers, [
    { ...marker, name: 'Heel', boneId: 'segment', localX: -15, localY: 35 },
  ]);
  const recovered = new RigEditorState(new Rig(definition));
  assert.isTrue(recovered.restoreDraft(state.createRecoveryDraft()));
  assert.deepEqual(recovered.workingCopy.footContactMarkers, state.workingCopy.footContactMarkers);
  state.selectFootContactMarker('contact');
  state.removeFootContactMarker('contact');
  assert.isNull(state.selectedFootContactMarkerId);
  assert.deepEqual(state.workingCopy.footContactMarkers, []);
  state.undo();
  state.undo();
  assert.equal(state.getFootContactMarker('contact').localX, 12);
  state.undo();
  assert.equal(state.getFootContactMarker('contact').boneId, 'tip');
  state.undo();
  assert.isFalse(state.dirty);
  for (let i = 0; i < 4; i++) state.redo();
  assert.deepEqual(state.workingCopy.footContactMarkers, []);
});

test('invalid bones, duplicate IDs, blank names and nonfinite numeric edits are atomic', () => {
  const state = new RigEditorState(new Rig(definition));
  const original = state.workingCopy;
  assert.throws(() => state.createFootContactMarker({ ...marker }));
  assert.throws(() => state.createFootContactMarker({ ...marker, id: 'bad', boneId: 'missing' }));
  assert.throws(() => state.updateFootContactMarker('contact', { boneId: 'missing' }));
  assert.throws(() => state.updateFootContactMarker('contact', { name: '' }));
  assert.throws(() => state.updateFootContactMarker('contact', { localX: Infinity }));
  assert.throws(() => state.updateFootContactMarker('missing', { localX: 3 }));
  assert.strictEqual(state.workingCopy, original);
  assert.equal(state.historyLength, 0);
});

test('live persisted dependencies protect deletion, reset, import, undo and ID reuse', () => {
  const references: string[] = [];
  const state = new RigEditorState(new Rig(skeleton), undefined, { footContactReferences: () => references });
  state.createFootContactMarker(marker);
  references.push('scene "stage" actor "walker" grounding selection');
  assert.throws(() => state.removeFootContactMarker('contact'), /scene "stage"/);
  assert.throws(() => state.undo(), /grounding selection/);
  assert.throws(() => state.resetRig(), /grounding selection/);
  assert.isFalse(state.restoreDraft({ version: 1, ...skeleton }));
  assert.equal(state.historyLength, 1);
  assert.equal(state.getFootContactMarker('contact').id, 'contact');
  references.length = 0;
  state.removeFootContactMarker('contact');
  references.push('scene selection');
  assert.throws(() => state.createFootContactMarker(marker), /reserved/);
});

test.each(['left', 'right'] as const)(
  'canvas dragging in facing %s handles nested bones, scale, root/ancestor transform, zoom and pan',
  (facing) => {
    const f = fixture(facing);
    try {
      f.camera.zoom = 1.7;
      f.camera.scrollX = 80;
      f.camera.scrollY = -25;
      f.start();
      assert.equal(f.state.selectedFootContactMarkerId, 'contact');
      const before = f.state.getFootContactMarker('contact');
      f.input.emit('pointermove', f.pointer({ x: 100, y: 100 }, 2));
      assert.strictEqual(f.state.getFootContactMarker('contact'), before);
      f.move(-15, 37);
      f.move(-25, 43);
      assert.equal(f.state.historyLength, 0);
      assert.closeTo(f.state.getFootContactMarker('contact').localX, -25, 1e-8);
      assert.closeTo(f.state.getFootContactMarker('contact').localY, 43, 1e-8);
      f.release(-25, 43);
      assert.equal(f.state.historyLength, 1);
      f.editor.undo();
      assert.deepEqual(f.state.getFootContactMarker('contact'), marker);
      f.editor.redo();
      assert.closeTo(f.state.getFootContactMarker('contact').localX, -25, 1e-8);
      const world = localToWorld({ x: -25, y: 43 }, f.puppet.getBone('tip').container.getWorldTransformMatrix());
      assert.closeTo(f.overlay.getFootContactMarkers()[0]!.world.x, world.x, 1e-8);
    } finally {
      f.dispose();
    }
  },
);

test('clicking a marker adds no history and hidden unselected handles leave other gizmos available', () => {
  const f = fixture();
  try {
    const point = f.pointer({ x: marker.localX, y: marker.localY });
    f.start();
    f.release(marker.localX, marker.localY);
    assert.equal(f.state.selectedFootContactMarkerId, marker.id);
    assert.equal(f.state.historyLength, 0);
    f.state.visibility.footContacts = false;
    f.state.selectBone('tip');
    assert.isUndefined(f.overlay.pickFootContactMarker(point.x, point.y));
    f.state.visibility.footContacts = true;
    assert.equal(f.overlay.pickFootContactMarker(point.x, point.y)?.id, marker.id);
  } finally {
    f.dispose();
  }
});

test.each(['Escape', 'blur', 'disable', 'singular'] as const)(
  '%s cancels a marker drag without history or animation mutation',
  (interrupt) => {
    const f = fixture();
    try {
      f.start();
      f.move(70, 90);
      if (interrupt === 'Escape') {
        const event = new Event('keydown', { cancelable: true });
        Object.defineProperty(event, 'key', { value: 'Escape' });
        f.browser.dispatchEvent(event);
      } else if (interrupt === 'disable') f.editor.disable();
      else if (interrupt === 'singular') {
        f.puppet.getBone('tip').container.setScale(0);
        f.input.emit('pointermove', { ...f.pointer({ x: 0, y: 0 }), x: 100 });
      } else f.browser.dispatchEvent(new Event('blur'));
      f.release(70, 90);
      assert.deepEqual(f.state.getFootContactMarker('contact'), marker);
      assert.equal(f.state.historyLength, 0);
      assert.isFalse(f.state.dirty);
    } finally {
      f.dispose();
    }
  },
);

test('marker handles follow rotated live poses; panel updates and teardown release subscriptions and Phaser objects', () => {
  const f = fixture();
  try {
    const render = () => renderToStaticMarkup(createElement(FootContactMarkersPanel, { controller: f.controller }));
    assert.notInclude(render(), '<details open');
    const listener = vi.fn();
    const unsubscribe = f.controller.subscribe(listener);
    f.controller.selectFootContactMarker('contact');
    f.controller.updateFootContactMarker('contact', { localX: 19 });
    assert.include(render(), 'value="19"');
    assert.include(render(), 'aria-pressed="true"');
    assert.include(render(), 'ID: contact');
    assert.isAbove(listener.mock.calls.length, 0);
    unsubscribe();
    listener.mockClear();
    f.controller.refresh();
    assert.equal(listener.mock.calls.length, 0);
    const before = f.overlay.getFootContactMarkers()[0]!.world;
    f.editor.editBone('tip', 'rotation', 1.2);
    assert.notDeepEqual(f.overlay.getFootContactMarkers()[0]!.world, before);
    f.editor.disable();
    f.editor.disable();
    for (const destroy of f.destroyed) assert.equal(destroy.mock.calls.length, 1);
    assert.equal(f.input.eventNames().length, 0);
    assert.equal(f.events.listenerCount('update'), 0);
    assert.deepEqual(f.overlay.getFootContactMarkers(), []);
    const snapshot = f.state.workingCopy;
    f.input.emit('pointerdown', f.pointer({ x: 19, y: 28 }));
    assert.strictEqual(f.state.workingCopy, snapshot);
    f.controller.dispose();
    f.controller.refresh();
    assert.equal(listener.mock.calls.length, 0);
  } finally {
    f.dispose();
  }
});

test('all marker commands leave animation bytes, dirty state and animation history untouched', () => {
  const workspace = createNewCharacter({ name: 'Animated point', id: 'animated-point' });
  workspace.animation.createAnimation({ name: 'idle', durationSeconds: 1 });
  workspace.animation.markSaved();
  const before = JSON.stringify(workspace.animation.packageAnimations());
  const dirty = workspace.animation.hasUnsavedChanges;
  assert.isFalse(dirty);
  const history = workspace.animation.historyLength;
  const rig = workspace.rig;
  rig.createFootContactMarker({ ...marker, boneId: 'root' });
  rig.updateFootContactMarker('contact', { localX: 37, name: 'Heel' });
  workspace.animation.updatePreviewRig(new Rig(rig.workingCopy));
  rig.removeFootContactMarker('contact');
  rig.undo();
  rig.redo();
  assert.equal(JSON.stringify(workspace.animation.packageAnimations()), before);
  assert.equal(workspace.animation.hasUnsavedChanges, dirty);
  assert.equal(workspace.animation.historyLength, history);
});
