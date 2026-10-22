import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import type { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { bindSceneShortcuts } from '../src/devtools/scene-editor/SceneKeyboardController.js';
import { storageError } from '../src/devtools/shared/autosave/LocalDraftStore.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import { bindExportShortcut } from '../src/shared/keyboardShortcuts.js';
import { EditorContext } from '../src/ui/EditorContext.js';

afterEach(() => vi.unstubAllGlobals());

function browser() {
  const window = new EventTarget();
  const confirm = vi.fn(() => false);
  vi.stubGlobal('window', Object.assign(window, { confirm }));
  const key = (
    values: Partial<KeyboardEvent>,
    options: { field?: boolean; dialog?: boolean; modal?: boolean; editable?: boolean; consumed?: boolean } = {},
  ) => {
    const target = {
      tagName: options.field ? 'INPUT' : 'BODY',
      closest: (selector: string) =>
        (options.dialog && selector === 'dialog') || (options.editable && selector.startsWith('[contenteditable]'))
          ? {}
          : null,
      ownerDocument: { querySelector: () => (options.modal ? {} : null) },
    };
    const event = new Event('keydown', { cancelable: true });
    for (const [name, value] of Object.entries({ target, ...values })) Object.defineProperty(event, name, { value });
    if (options.consumed) event.preventDefault();
    window.dispatchEvent(event);
    return event;
  };
  return { key, confirm };
}

function scene() {
  const document = new SceneEditorDocument();
  document.importJson(
    JSON.stringify({
      ...createEmptyScene({ id: 'workflow' }),
      actors: [{ id: 'hero', character: { manifest: 'hero.json' }, position: { x: 0, y: 0 } }],
      actions: [{ id: 'hold', type: 'wait', actorId: 'hero', time: 0, duration: 1000 }],
    }),
  );
  document.selectAction('hold');
  const playback = { ready: true, status: 'playing', play: vi.fn(), pause: vi.fn(), restart: vi.fn(), seek: vi.fn() };
  const release = bindSceneShortcuts(document, playback as unknown as SceneEditorPlayback);
  return { document, playback, release };
}

test('scene Delete, Undo, both Redo conventions and staged deselection use one document owner', () => {
  const { key, confirm } = browser();
  const { document, release } = scene();
  try {
    key({ key: 'Delete', ctrlKey: true });
    assert.lengthOf(document.workingScene!.actions, 1);
    key({ key: 'Delete' });
    assert.lengthOf(document.workingScene!.actions, 0);
    key({ key: 'z', metaKey: true });
    assert.lengthOf(document.workingScene!.actions, 1);
    key({ key: 'y', ctrlKey: true });
    assert.lengthOf(document.workingScene!.actions, 0);
    key({ key: 'z', ctrlKey: true });
    document.selectAction('hold');
    key({ key: 'Escape' });
    assert.isNull(document.selectedActionId);
    assert.equal(document.selectedActorId, 'hero');
    key({ key: 'Delete' });
    assert.equal(confirm.mock.calls.length, 1);
    assert.lengthOf(document.workingScene!.actors, 1);
    key({ key: 'Escape' });
    assert.isNull(document.selectedActorId);
    document.selectAction('hold');
    key({ key: 'Delete' });
    key({ key: 'z', ctrlKey: true });
    key({ key: 'Z', ctrlKey: true, shiftKey: true });
    assert.lengthOf(document.workingScene!.actions, 0);
  } finally {
    release();
  }
});

test.each([{ field: true }, { dialog: true }, { modal: true }, { editable: true }, { consumed: true }])(
  'scene shortcuts preserve input, modal, guide and consumed-event focus: %j',
  (options) => {
    const { key } = browser();
    const { document, playback, release } = scene();
    try {
      for (const values of [{ key: 'Delete' }, { key: 'Escape' }, { key: 'z', ctrlKey: true }, { code: 'Space' }])
        key(values, options);
      assert.lengthOf(document.workingScene!.actions, 1);
      assert.equal(document.selectedActionId, 'hold');
      assert.equal(playback.pause.mock.calls.length, 0);
      assert.isFalse(document.dirty);
    } finally {
      release();
    }
  },
);

test('Escape cancels a scene clip gesture before deselecting; history and playback wait for commit', () => {
  const { key } = browser();
  const { document, playback, release } = scene();
  try {
    const source = document.workingScene;
    document.beginActionDrag('hold');
    document.changeActionDrag({ ...document.workingScene!.actions[0]!, time: 2000 });
    key({ key: 'z', ctrlKey: true });
    key({ code: 'Space' });
    assert.isTrue(document.hasActiveGesture);
    assert.equal(playback.pause.mock.calls.length, 0);
    key({ key: 'Escape' });
    assert.isFalse(document.hasActiveGesture);
    assert.deepEqual(document.workingScene, source);
    assert.equal(document.selectedActionId, 'hold');
    key({ code: 'Space', repeat: true });
    assert.equal(playback.pause.mock.calls.length, 0);
    key({ code: 'Space' });
    assert.equal(playback.pause.mock.calls.length, 1);
    key({ key: 'Home' });
    key({ key: 'End' });
    assert.equal(playback.restart.mock.calls.length, 1);
    assert.deepEqual(playback.seek.mock.calls[0], [document.workingScene!.duration]);
    release();
    key({ code: 'Space' });
    assert.equal(playback.pause.mock.calls.length, 1);
  } finally {
    release();
  }
});

test('save/export shortcut respects native fields, modals, guides, hidden views, repeats and disposal', () => {
  const { key } = browser();
  let hidden = false;
  const host = { closest: () => (hidden ? {} : null) } as unknown as HTMLElement;
  const exportDocument = vi.fn();
  const release = bindExportShortcut(host, exportDocument);
  for (const options of [{ field: true }, { dialog: true }, { modal: true }, { editable: true }])
    assert.isFalse(key({ key: 's', ctrlKey: true }, options).defaultPrevented);
  key({ key: 's', ctrlKey: true, isComposing: true });
  key({ key: 's', ctrlKey: true, shiftKey: true });
  assert.isTrue(key({ key: 's', metaKey: true }).defaultPrevented);
  key({ key: 's', ctrlKey: true, repeat: true });
  hidden = true;
  assert.isFalse(key({ key: 's', ctrlKey: true }).defaultPrevented);
  release();
  hidden = false;
  key({ key: 's', ctrlKey: true });
  assert.equal(exportDocument.mock.calls.length, 1);
});

test('context distinguishes modified domains from a loaded/exported checkpoint and never invents local save state', () => {
  const modified = renderToStaticMarkup(
    createElement(EditorContext, {
      project: 'Forest Story',
      editor: 'Animation',
      document: 'Character: Hero · Animation: walk',
      modified: ['Rig', 'Animation'],
    }),
  );
  assert.include(modified, 'Forest Story');
  assert.include(modified, 'Hero');
  assert.include(modified, 'Unsaved changes: Rig, Animation');
  assert.notInclude(modified, 'Local draft saved');
  const clean = renderToStaticMarkup(
    createElement(EditorContext, {
      editor: 'Scene',
      document: 'Scene: Opening',
      modified: [],
    }),
  );
  assert.include(clean, 'Standalone workspace');
  assert.include(clean, 'Matches loaded / exported checkpoint');
  assert.notInclude(clean, 'Saved');
  assert.include(storageError(new Error('Invalid ZIP'), 'Recovery'), 'Recovery failed: Invalid ZIP');
});
