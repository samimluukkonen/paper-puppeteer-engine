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
    editBone: vi.fn((...args: Parameters<RigEditorState['editBone']>) => state.editBone(...args)),
    undo: vi.fn(() => state.undo()),
    redo: vi.fn(() => state.redo()),
    refresh: vi.fn(),
    moveCharacter: vi.fn(),
    previewArtwork: vi.fn(),
    finishArtworkGesture: vi.fn(),
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
    const event = new Event('keydown', { cancelable: true });
    for (const [name, value] of Object.entries(values)) Object.defineProperty(event, name, { value });
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

test('Ctrl/Cmd+Y redoes and idle Escape clears rig selection without creating an edit', () => {
  const { state, key, controller } = fixture();
  try {
    key({ key: 'z', ctrlKey: true });
    key({ key: 'y', ctrlKey: true });
    assert.equal(state.getBone('root').x, 10);
    const history = state.historyLength;
    key({ key: 'Escape' });
    assert.isNull(state.selection);
    assert.isNull(state.selectedIKConstraintId);
    assert.isNull(state.selectedFootContactMarkerId);
    assert.equal(state.historyLength, history);
  } finally {
    controller.disable();
  }
});

test.each([{ ctrlKey: true }, { metaKey: true }])(
  'held Undo/Redo shortcuts ignore repeat with $ctrlKey/$metaKey',
  (modifier) => {
    const { editor, state, key, controller } = fixture();
    try {
      state.editBone('root', 'x', 20);
      assert.isTrue(key({ key: 'z', ...modifier }).defaultPrevented);
      assert.equal(state.getBone('root').x, 10);
      assert.isTrue(key({ key: 'z', ...modifier, repeat: true }).defaultPrevented);
      assert.equal(state.getBone('root').x, 10);
      assert.equal(editor.undo.mock.calls.length, 1);

      assert.isTrue(key({ key: 'z', ...modifier, shiftKey: true }).defaultPrevented);
      assert.equal(state.getBone('root').x, 20);
      assert.isTrue(key({ key: 'z', ...modifier, shiftKey: true, repeat: true }).defaultPrevented);
      assert.equal(state.getBone('root').x, 20);
      assert.equal(editor.redo.mock.calls.length, 1);
    } finally {
      controller.disable();
    }
  },
);

test('held arrow shortcuts keep nudging on repeat', () => {
  const { state, key, controller } = fixture();
  try {
    key({ key: 'ArrowRight' });
    key({ key: 'ArrowRight', repeat: true });
    assert.equal(state.getBone('root').x, 12);
  } finally {
    controller.disable();
  }
});

test('dialog shortcuts preserve rig edits and history without consuming native keys', () => {
  const { editor, state, key, controller } = fixture();
  const target = { tagName: 'BUTTON', closest: (selector: string) => (selector === 'dialog' ? {} : null) };
  try {
    for (const shortcut of [
      { key: 'ArrowRight' },
      { key: '.' },
      { key: 'z', ctrlKey: true },
      { key: 'z', metaKey: true, shiftKey: true },
    ])
      assert.isFalse(key({ ...shortcut, target: target as unknown as EventTarget }).defaultPrevented);
    assert.equal(state.getBone('root').x, 10);
    assert.isUndefined(state.getBone('root').rotation);
    assert.equal(state.historyLength, 1);
    for (const handler of [editor.editBone, editor.undo, editor.redo]) assert.equal(handler.mock.calls.length, 0);
    key({ key: 'ArrowRight' });
    assert.equal(state.getBone('root').x, 11);
  } finally {
    controller.disable();
  }
});
