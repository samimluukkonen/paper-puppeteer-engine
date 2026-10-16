import { EventEmitter } from 'eventemitter3';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { AttachmentController } from '../src/devtools/rig-editor/AttachmentController.js';
import { RigEditor } from '../src/devtools/rig-editor/RigEditor.js';
import type { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { rigIKChains, rigIKFormError } from '../src/devtools/rig-editor/rigIKForm.js';
import { RigIKCreateForm, RigIKPanel } from '../src/devtools/rig-editor/RigIKPanel.js';
import { localToWorld, worldToLocal } from '../src/engine/affineMath.js';
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

const chain = { name: 'tentacle', rootBone: 'base', middleBone: 'segment', endBone: 'tip' };
const skeleton: RigDefinition = {
  root: 'base',
  bones: [{ id: 'base' }, { id: 'segment', parent: 'base', x: 60 }, { id: 'tip', parent: 'segment', x: 50 }],
};

function fixture(options: { empty?: boolean; noTarget?: boolean; dependencies?: string[]; nested?: boolean } = {}) {
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
    zoom: 1.5,
    scrollX: -20,
    scrollY: 10,
    originX: 0.5,
    originY: 0.5,
    matrixCombined: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    getWorldPoint(x: number, y: number) {
      return { x: x / this.zoom + this.scrollX, y: y / this.zoom + this.scrollY };
    },
  };
  Object.assign(scene, { input, events, cameras: { main: camera } });
  const graphics = scene.add.graphics.bind(scene.add);
  const destroyed: ReturnType<typeof vi.fn>[] = [];
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
  scene.add.text = (...args) =>
    Object.assign(text(...args), {
      setScrollFactor() {
        return this;
      },
      setText() {
        return this;
      },
      setColor() {
        return this;
      },
    });
  const rig = new Rig({
    ...skeleton,
    ...(options.empty ? {} : { ik: [{ ...chain, ...(options.noTarget ? {} : { target: { x: 70, y: 50 } }) }] }),
  });
  let puppet = new Puppet(scene, { rig, x: 210, y: 170, autoUpdate: false });
  puppet.container.setScale(1.7, 1.7).setRotation(0.2);
  if (options.nested) scene.add.container(50, -20).setScale(1.2, 0.8).setRotation(0.3).add(puppet.container);
  const state = new RigEditorState(rig, undefined, { ikReferences: () => options.dependencies ?? [] });
  state.facing = 'left';
  state.visibility.ik = true;
  state.ikPreview = true;
  const controller = new AttachmentController();
  const editor = new RigEditor(
    scene,
    puppet,
    () => controller.bind(editor),
    state,
    [],
    [],
    undefined,
    undefined,
    (next) => {
      puppet = next;
    },
  );
  controller.bind(editor);
  editor.enable();
  const getOverlay = () => Reflect.get(editor, 'overlay') as RigEditorOverlay;
  const screen = (local: { x: number; y: number }) => {
    const world = localToWorld(local, puppet.container.getWorldTransformMatrix());
    return { x: (world.x - camera.scrollX) * camera.zoom, y: (world.y - camera.scrollY) * camera.zoom };
  };
  const pointer = (point: { x: number; y: number }, id = 1) => ({
    ...screen(point),
    id,
    isDown: true,
    middleButtonDown: () => false,
    leftButtonDown: () => true,
  });
  const drag = (point: { x: number; y: number }) => {
    const target = getOverlay().getIKTargets()[0]!.target;
    input.emit('pointerdown', pointer(target));
    input.emit('pointermove', pointer(point));
  };
  const release = (point: { x: number; y: number }) => input.emit('pointerup', pointer(point));
  const dispose = () => {
    editor.disable();
    controller.dispose();
    puppet.destroy();
  };
  return {
    destroyed,
    state,
    editor,
    controller,
    input,
    events,
    camera,
    browser,
    getOverlay,
    screen,
    pointer,
    drag,
    release,
    dispose,
    get puppet() {
      return puppet;
    },
  };
}

function render(controller: AttachmentController) {
  return renderToStaticMarkup(createElement(RigIKPanel, { controller }));
}

test('creation form validates real connected chains, duplicate IDs and finite supported settings', () => {
  assert.deepEqual(rigIKChains(skeleton), [{ rootBone: 'base', middleBone: 'segment', endBone: 'tip' }]);
  assert.equal(rigIKFormError(skeleton, chain), '');
  for (const definition of [
    { ...chain, name: '' },
    { ...chain, middleBone: 'tip' },
    { ...chain, mix: 1.2 },
    { ...chain, target: { x: Infinity, y: 0 } },
  ])
    assert.isNotEmpty(rigIKFormError(skeleton, definition));
  assert.match(rigIKFormError({ ...skeleton, ik: [chain] }, chain), /Duplicate/);
  assert.deepEqual(rigIKChains({ root: 'base', bones: [{ id: 'base' }] }), []);
});

test('empty panel and form guide artists without demo names; validated creation selects a live target and exports it', () => {
  const current = fixture({ empty: true });
  try {
    assert.include(render(current.controller), 'No IK constraints');
    const form = renderToStaticMarkup(
      createElement(RigIKCreateForm, { controller: current.controller, rig: skeleton, onClose() {} }),
    );
    assert.include(form, 'segment');
    assert.include(form, 'Initialize target at current end effector');
    assert.notInclude(form, 'leftUpperArm');
    current.controller.createIK({ ...chain, target: { x: 45, y: 40 }, mix: 0.7, priority: 2, bendDirection: -1 });
    assert.equal(current.state.historyLength, 1);
    assert.equal(current.state.selectedIKConstraintId, chain.name);
    assert.isTrue(current.state.ikPreview);
    assert.include(render(current.controller), 'Selected: tentacle');
    assert.deepEqual(parseRigDefinition(JSON.parse(current.editor.exportJson(false))).ik, current.state.workingCopy.ik);
    current.controller.createIK(chain);
    assert.match(current.controller.getSnapshot().message, /Duplicate/);
    assert.equal(current.state.historyLength, 1);
  } finally {
    current.dispose();
  }
});

test('selection and preview consume no history; numeric controls, handles and solver follow authoritative defaults', () => {
  const current = fixture();
  try {
    const source = current.state.source.ik;
    current.controller.selectIK(chain.name);
    assert.equal(current.state.historyLength, 0);
    assert.isNull(current.state.selection);
    current.controller.previewIK(false);
    current.controller.previewIK(true);
    assert.equal(current.state.historyLength, 0);
    current.controller.updateIK(chain.name, { target: { x: 40, y: 60 } });
    assert.equal(current.state.historyLength, 1);
    assert.include(render(current.controller), 'value="40"');
    const handle = current.getOverlay().getIKTargets()[0]!;
    assert.deepEqual(handle.target, { x: 40, y: 60 });
    assert.closeTo(
      handle.world.x,
      localToWorld(handle.target, current.puppet.container.getWorldTransformMatrix()).x,
      1e-8,
    );
    assert.closeTo(handle.endpoint.x, handle.world.x, 1e-7);
    assert.closeTo(handle.endpoint.y, handle.world.y, 1e-7);
    assert.strictEqual(current.state.source.ik, source);
  } finally {
    current.dispose();
  }
});

test('camera zoom/pan, translation, scale, rotation and facing convert drag into rig coordinates and one undo entry', () => {
  const current = fixture();
  try {
    const original = current.puppet;
    current.drag({ x: 30, y: 70 });
    assert.strictEqual(current.puppet, original, 'retain runtime and input during the gesture');
    assert.closeTo(current.state.getIKConstraint(chain.name).target!.x, 30, 1e-8);
    assert.closeTo(current.state.getIKConstraint(chain.name).target!.y, 70, 1e-8);
    assert.include(render(current.controller), 'Target X');
    const handle = current.getOverlay().getIKTargets()[0]!;
    assert.closeTo(handle.world.x, handle.endpoint.x, 1e-7);
    current.input.emit('pointermove', current.pointer({ x: 35, y: 65 }, 2));
    assert.closeTo(current.state.getIKConstraint(chain.name).target!.x, 30, 1e-8, 'ignore another pointer');
    current.release({ x: 30, y: 70 });
    assert.equal(current.state.historyLength, 1);
    assert.notStrictEqual(current.puppet, original, 'install runtime defaults once on commit');
    assert.deepEqual(current.state.rig.ik, current.state.workingCopy.ik);
    current.editor.undo();
    assert.deepEqual(current.state.getIKConstraint(chain.name).target, { x: 70, y: 50 });
    current.editor.redo();
    assert.closeTo(current.state.getIKConstraint(chain.name).target!.x, 30, 1e-8);
    assert.equal(current.input.listenerCount('pointerdown'), 1);
  } finally {
    current.dispose();
  }
});

test.each(['escape', 'blur', 'disable'] as const)(
  '%s cancels the drag, restores the solver and leaves no undo entry',
  (ending) => {
    const current = fixture();
    try {
      const before = current.state.workingCopy;
      current.drag({ x: 20, y: 30 });
      if (ending === 'escape') {
        const event = new Event('keydown', { cancelable: true });
        Object.defineProperty(event, 'key', { value: 'Escape' });
        current.browser.dispatchEvent(event);
        assert.isTrue(event.defaultPrevented);
      } else if (ending === 'blur') current.browser.dispatchEvent(new Event('blur'));
      else current.editor.disable();
      assert.deepEqual(current.state.workingCopy, before);
      assert.isUndefined(current.state.ikTargetDragId);
      assert.equal(current.state.historyLength, 0);
      assert.closeTo(
        current.puppet.getBone('tip').getWorldPosition().x,
        localToWorld({ x: 70, y: 50 }, current.puppet.container.getWorldTransformMatrix()).x,
        1e-7,
      );
      current.release({ x: 20, y: 30 });
      assert.equal(current.state.historyLength, 0);
    } finally {
      current.dispose();
    }
  },
);

test('unreachable and disabled defaults remain editable without clamping authored coordinates', () => {
  const current = fixture();
  try {
    current.drag({ x: 700, y: 600 });
    assert.equal(current.puppet.getIK(chain.name).status, 'clamped');
    const handle = current.getOverlay().getIKTargets()[0]!;
    assert.isAbove(Math.hypot(handle.world.x - handle.endpoint.x, handle.world.y - handle.endpoint.y), 100);
    current.release({ x: 700, y: 600 });
    assert.closeTo(current.state.getIKConstraint(chain.name).target!.x, 700, 1e-7);
    current.controller.updateIK(chain.name, { enabled: false });
    assert.isFalse(current.getOverlay().getIKTargets()[0]!.enabled);
    current.drag({ x: 50, y: 50 });
    current.release({ x: 50, y: 50 });
    assert.closeTo(current.state.getIKConstraint(chain.name).target!.x, 50, 1e-7);
  } finally {
    current.dispose();
  }
});

test('legacy constraints without a static target can author one while editor-pinned preview is active', () => {
  const current = fixture({ noTarget: true });
  try {
    assert.isNull(current.getOverlay().getIKTargets()[0]!.disabledReason);
    current.drag({ x: 30, y: 60 });
    current.release({ x: 30, y: 60 });
    assert.closeTo(current.state.getIKConstraint(chain.name).target!.x, 30, 1e-7);
    current.editor.undo();
    assert.isUndefined(current.state.getIKConstraint(chain.name).target);
  } finally {
    current.dispose();
  }
});

test('live dependencies protect chain edits/deletion but allow safe target edits; host target owners block dragging', () => {
  const dependencies = ['animation "reach" IK track'];
  const current = fixture({ dependencies });
  try {
    current.controller.selectIK(chain.name);
    const markup = render(current.controller);
    assert.include(markup, 'Used by animation &quot;reach&quot; IK track');
    assert.match(markup, /disabled="">Delete Constraint/);
    current.controller.updateIK(chain.name, { endOffset: { x: 1, y: 0 } });
    assert.include(current.controller.getSnapshot().message, 'reach');
    assert.equal(current.state.historyLength, 0);
    current.controller.removeIK(chain.name);
    assert.equal(current.state.historyLength, 0);
    current.controller.updateIK(chain.name, { target: { x: 20, y: 60 } });
    assert.equal(current.state.historyLength, 1);
    const constraint = current.puppet.getIK(chain.name);
    constraint.setTargetProvider(() => ({ x: 0, y: 0 }));
    assert.isNotNull(current.getOverlay().getIKTargets()[0]!.disabledReason);
    current.drag({ x: 50, y: 50 });
    current.release({ x: 50, y: 50 });
    assert.equal(current.state.historyLength, 1);
    assert.equal(constraint.targetOwnership, 'provider');
  } finally {
    current.dispose();
  }
});

test('overlay/input cleanup is idempotent and detached React adapter ignores late scene gestures', () => {
  const current = fixture();
  const overlay = current.getOverlay();
  const data = current.state.workingCopy;
  current.editor.disable();
  current.editor.disable();
  assert.equal(current.input.listenerCount('pointerdown'), 0);
  assert.equal(current.input.listenerCount('pointermove'), 0);
  assert.equal(current.events.listenerCount('update'), 0);
  assert.isTrue(current.destroyed.every((destroy) => destroy.mock.calls.length === 1));
  assert.deepEqual(overlay.getIKTargets(), []);
  assert.doesNotThrow(() => {
    overlay.draw();
    overlay.destroy();
  });
  current.controller.unbind();
  assert.equal(render(current.controller), '');
  current.input.emit('pointerdown', current.pointer({ x: 70, y: 50 }));
  assert.strictEqual(current.state.workingCopy, data);
  current.dispose();
});

test('singular puppet transforms cannot author screen coordinates into targets', () => {
  const current = fixture();
  try {
    current.puppet.container.setScale(0, 0);
    assert.include(current.getOverlay().getIKTargets()[0]!.disabledReason!, 'singular');
    assert.isUndefined(worldToLocal({ x: 1, y: 2 }, current.puppet.container.getWorldTransformMatrix()));
    assert.equal(current.state.historyLength, 0);
  } finally {
    current.dispose();
  }
});

test('nested affine placement survives a target drag and preview reconstruction', () => {
  const current = fixture({ nested: true });
  try {
    const parent = current.puppet.container.parentContainer;
    current.drag({ x: 25, y: 45 });
    current.release({ x: 25, y: 45 });
    assert.strictEqual(current.puppet.container.parentContainer, parent);
    assert.closeTo(current.state.getIKConstraint(chain.name).target!.x, 25, 1e-7);
    const handle = current.getOverlay().getIKTargets()[0]!;
    assert.closeTo(handle.world.x, handle.endpoint.x, 1e-7);
    assert.closeTo(handle.world.y, handle.endpoint.y, 1e-7);
  } finally {
    current.dispose();
  }
});

test.each(['runtime', 'provider'] as const)(
  'a new %s owner interrupts the gesture without replacing its target',
  (owner) => {
    const current = fixture();
    try {
      current.drag({ x: 20, y: 30 });
      const constraint = current.puppet.getIK(chain.name);
      if (owner === 'provider') constraint.setTargetProvider(() => ({ x: 13, y: 14 }));
      else constraint.setTarget(13, 14);
      current.input.emit('pointermove', current.pointer({ x: 25, y: 35 }));
      assert.isUndefined(current.state.ikTargetDragId);
      assert.equal(current.state.historyLength, 0);
      assert.deepEqual(current.state.getIKConstraint(chain.name).target, { x: 70, y: 50 });
      assert.equal(constraint.targetOwnership, owner);
      if (owner === 'runtime') assert.deepEqual(constraint.target, { x: 13, y: 14 });
    } finally {
      current.dispose();
    }
  },
);

test('selecting a handle or dragging back to its original point consumes no history', () => {
  const current = fixture();
  try {
    current.input.emit('pointerdown', current.pointer({ x: 70, y: 50 }));
    current.release({ x: 70, y: 50 });
    assert.equal(current.state.historyLength, 0);
    current.state.gridSnap = 1;
    current.drag({ x: 20, y: 30 });
    current.input.emit('pointermove', current.pointer({ x: 70, y: 50 }));
    current.release({ x: 70, y: 50 });
    assert.equal(current.state.historyLength, 0);
  } finally {
    current.dispose();
  }
});

test('the selected target wins overlapping hits even when an unselected target is closer', () => {
  const current = fixture();
  try {
    current.editor.createIKConstraint({ ...chain, name: 'nearby', target: { x: 71, y: 50 } });
    current.controller.selectIK(chain.name);
    const position = current.screen({ x: 71, y: 50 });
    assert.equal(current.getOverlay().pickIKTarget(position.x, position.y)!.id, chain.name);
    current.input.emit('pointerdown', current.pointer({ x: 71, y: 50 }));
    current.input.emit('pointermove', current.pointer({ x: 81, y: 60 }));
    current.release({ x: 81, y: 60 });
    assert.equal(current.state.selectedIKConstraintId, chain.name);
    assert.deepEqual(current.state.getIKConstraint('nearby').target, { x: 71, y: 50 });
  } finally {
    current.dispose();
  }
});

test('cancelling a legacy default-target gesture retains editable editor-owned preview targets', () => {
  const current = fixture({ noTarget: true });
  try {
    current.drag({ x: 30, y: 60 });
    current.browser.dispatchEvent(new Event('blur'));
    assert.isUndefined(current.state.getIKConstraint(chain.name).target);
    assert.isNull(current.getOverlay().getIKTargets()[0]!.disabledReason);
    current.drag({ x: 35, y: 65 });
    current.release({ x: 35, y: 65 });
    assert.equal(current.state.historyLength, 1);
    assert.closeTo(current.state.getIKConstraint(chain.name).target!.x, 35, 1e-7);
  } finally {
    current.dispose();
  }
});
