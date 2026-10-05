import type Phaser from 'phaser';
import { afterEach, assert, test, vi } from 'vitest';
import { RigEditorInputController } from '../src/devtools/rig-editor/RigEditorInputController.js';
import type { RigEditorOverlay } from '../src/devtools/rig-editor/RigEditorOverlay.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import type { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  const state = new RigEditorState(new Rig({ root: 'root', bones: [{ id: 'root' }] }));
  state.selectBone('root');
  state.editBone('root', 'x', 10);
  const editor = {
    state,
    editBone: vi.fn((id, field, value) => state.editBone(id, field, value)),
    undo: vi.fn(() => state.undo()),
    redo: vi.fn(() => state.redo()),
    refresh: vi.fn(),
    moveCharacter: vi.fn(),
  };
  const controller = new RigEditorInputController(
    { input: { on() {}, off() {} } } as unknown as Phaser.Scene,
    {} as Puppet,
    editor,
    {} as RigEditorOverlay,
    vi.fn(),
    vi.fn(),
  );
  controller.enable();
  const key = (values: Partial<KeyboardEvent>, consumed = false) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), values);
    if (consumed) event.preventDefault();
    browser.dispatchEvent(event);
    return event;
  };
  return { editor, state, key, controller };
}

test.each([
  { key: 'ArrowRight' },
  { key: '.', shiftKey: true },
  { key: 'z', ctrlKey: true },
  { key: 'z', metaKey: true, shiftKey: true },
])('composing and consumed $key shortcuts preserve authored data and history', (shortcut) => {
  const { editor, state, key, controller } = fixture();
  try {
    key({ ...shortcut, isComposing: true });
    key(shortcut, true);
    assert.equal(state.getBone('root').x, 10);
    assert.isUndefined(state.getBone('root').rotation);
    assert.equal(state.historyLength, 1);
    for (const handler of [editor.editBone, editor.undo, editor.redo]) assert.equal(handler.mock.calls.length, 0);
  } finally {
    controller.disable();
  }
});

test('unhandled shortcuts still nudge, undo, and redo the selected bone', () => {
  const { state, key, controller } = fixture();
  try {
    assert.isTrue(key({ key: 'ArrowRight' }).defaultPrevented);
    assert.equal(state.getBone('root').x, 11);
    assert.isTrue(key({ key: 'z', ctrlKey: true }).defaultPrevented);
    assert.equal(state.getBone('root').x, 10);
    assert.isTrue(key({ key: 'z', metaKey: true, shiftKey: true }).defaultPrevented);
    assert.equal(state.getBone('root').x, 11);
  } finally {
    controller.disable();
  }
});
