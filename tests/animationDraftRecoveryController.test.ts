import { assert, test, vi } from 'vitest';
import { AnimationDraftRecoveryController } from '../src/devtools/animation-editor/AnimationDraftRecoveryController.js';
import { AnimationEditorState, type ReadonlyAnimation } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { DraftRecovery, type DraftSession } from '../src/devtools/shared/DraftRecovery.js';
import { draftSource } from '../src/devtools/shared/draftSource.js';
import { GroundGuideWorkspace } from '../src/devtools/shared/GroundGuideWorkspace.js';
import { Rig } from '../src/engine/Rig.js';

function fixture() {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const animations = ['first', 'second'].map((name) => ({
    name,
    duration: 1000,
    loop: false,
    tracks: { root: [{ time: 0, x: 0 }] },
  }));
  const state = new AnimationEditorState(rig, animations);
  state.selectAnimation('first');
  const calls: string[] = [];
  const recovery = {
    recoverDocuments: vi.fn(),
    bind: vi.fn((_session: DraftSession<ReadonlyAnimation | null>, _options: { recover?: boolean } = {}) => {
      calls.push('bind');
    }),
    update: vi.fn(() => {
      calls.push('update');
    }),
    unbind: vi.fn(() => {
      calls.push('unbind');
    }),
  };
  const controller = new AnimationDraftRecoveryController(recovery, '/animation-editor/');
  const session = () => recovery.bind.mock.lastCall![0];
  return { rig, animations, state, calls, recovery, controller, session };
}

test('multiple new clips recover authored data and Undo/Redo independently of persisted ground preferences', () => {
  const stored = new Map<string, string>();
  const storage = {
    get length() {
      return stored.size;
    },
    key: (index: number) => [...stored.keys()][index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
  };
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage, confirm: () => true }));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const recovery = new DraftRecovery<ReadonlyAnimation | null>(() => {});
  const controller = new AnimationDraftRecoveryController(recovery, '/animation-editor/');
  const nextRecovery = new DraftRecovery<ReadonlyAnimation | null>(() => {});
  const nextController = new AnimationDraftRecoveryController(nextRecovery, '/animation-editor/');
  try {
    const state = new AnimationEditorState(rig);
    controller.bind(state, 'character');
    const guide = new GroundGuideWorkspace('animation-preview-world');
    guide.bind('https://example.test/characters/character.json');
    guide.update({ enabled: true, y: -72.5, snapEnabled: true });
    assert.isFalse(state.dirty);
    assert.isFalse([...stored.keys()].some((key) => key.startsWith('paper-puppeteer:draft:')));
    for (const [name, x] of [
      ['new-one', 42],
      ['new-two', 84],
    ] as const) {
      assert.isTrue(state.createAnimation({ name }));
      assert.isTrue(state.setBonePropertyKeyframe('root', 'x', x, 0));
    }
    controller.dispose();
    recovery.dispose();
    for (const [key, text] of stored) {
      if (key.startsWith('paper-puppeteer:draft:')) assert.notInclude(text, 'snapEnabled');
    }
    const reloaded = new AnimationEditorState(rig);
    const reopenedGuide = new GroundGuideWorkspace('animation-preview-world');
    reopenedGuide.bind('https://example.test/characters/character.json');
    nextController.bind(reloaded, 'character');
    const metadata = reopenedGuide.getSnapshot();
    assert.deepEqual(metadata.guide, guide.getSnapshot().guide);
    assert.deepEqual(Object.fromEntries(reloaded.packageAnimations().map((clip) => [clip.name, clip.tracks.root])), {
      'new-one': [{ time: 0, x: 42 }],
      'new-two': [{ time: 0, x: 84 }],
    });
    for (const [name, x] of [
      ['new-one', 42],
      ['new-two', 84],
    ] as const) {
      assert.isTrue(reloaded.selectAnimation(name, { keepChanges: true }));
      assert.equal(reloaded.getEvaluatedBonePropertyValue('root', 'x', 0), x);
      assert.isTrue(reloaded.undo());
      assert.equal(reloaded.getEvaluatedBonePropertyValue('root', 'x', 0), 0);
      assert.isTrue(reloaded.redo());
      assert.equal(reloaded.getEvaluatedBonePropertyValue('root', 'x', 0), x);
    }
    assert.strictEqual(reopenedGuide.getSnapshot(), metadata);
  } finally {
    controller.dispose();
    recovery.dispose();
    nextController.dispose();
    nextRecovery.dispose();
    vi.unstubAllGlobals();
  }
});

test('binds source identity and updates edits/playback without replacing recovery sessions', () => {
  const { state, recovery, controller, session, rig } = fixture();
  controller.bind(state, 'character');
  const bound = session();
  assert.equal(bound.key, JSON.stringify(['/animation-editor/', 'character', 'first']));
  assert.equal(bound.source, draftSource({ rig, animation: state.sourceAnimation }));
  assert.deepEqual(recovery.bind.mock.lastCall![1], { recover: true });
  assert.isTrue(bound.validate(state.workingAnimation));
  assert.isFalse(bound.validate({ ...state.workingAnimation, name: 'other' }));
  assert.isFalse(bound.dirty());
  state.setCurrentTime(0.25);
  state.setBonePropertyKeyframe('root', 'x', 42, 0);
  assert.equal(recovery.bind.mock.calls.length, 1);
  assert.isTrue(bound.dirty());
  assert.strictEqual(bound.snapshot(), state.workingAnimation);
  assert.strictEqual(bound.data(bound.snapshot()), state.workingAnimation);
  assert.isAbove(recovery.update.mock.calls.length, 1);
  controller.dispose();
});

test.each(['field', 'graph'] as const)(
  'unload preserves the last committed snapshot while a %s preview is pending, before debounce',
  (preview) => {
    vi.useFakeTimers();
    const stored = new Map<string, string>();
    const browser = Object.assign(new EventTarget(), {
      localStorage: {
        get length() {
          return stored.size;
        },
        key: (index: number) => [...stored.keys()][index] ?? null,
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => {
          stored.set(key, value);
        },
        removeItem: (key: string) => {
          stored.delete(key);
        },
      },
      confirm: () => true,
    });
    vi.stubGlobal('window', browser);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
    const animations = [
      {
        name: 'clip',
        duration: 1000,
        loop: false,
        tracks: {
          root: [
            { time: 0, x: 0 },
            { time: 1000, x: 10 },
          ],
        },
      },
    ];
    const recovery = new DraftRecovery<ReadonlyAnimation | null>(() => {});
    const controller = new AnimationDraftRecoveryController(recovery, '/animation-editor/');
    const nextRecovery = new DraftRecovery<ReadonlyAnimation | null>(() => {});
    const next = new AnimationDraftRecoveryController(nextRecovery, '/animation-editor/');
    try {
      const state = new AnimationEditorState(rig, animations);
      state.selectAnimation('clip');
      controller.bind(state, 'hero');
      state.setAuthoredPlaybackMode('stepped');
      state.setAuthoredFPS(17);
      const committed = state.workingAnimation;
      if (preview === 'field') {
        state.selectBone('root');
        state.setTemporaryBoneProperty('x', 123);
      } else {
        state.beginGraphEdit({ channel: { kind: 'bone', id: 'root', property: 'x' }, time: 0 });
        state.previewGraphEdit({ value: 123 });
      }
      assert.isTrue(state.hasPendingAnimationEdits);
      assert.isEmpty(stored);
      browser.dispatchEvent(new Event('beforeunload'));
      assert.equal(stored.size, 1);
      const saved = JSON.parse([...stored.values()][0]!) as { data: unknown };
      assert.deepEqual(saved.data, committed);
      assert.strictEqual(state.workingAnimation, committed);
      controller.dispose();
      recovery.dispose();
      const reloaded = new AnimationEditorState(rig, animations);
      reloaded.selectAnimation('clip');
      next.bind(reloaded, 'hero');
      assert.deepEqual(reloaded.workingAnimation, committed);
      assert.isFalse(reloaded.hasPendingAnimationEdits);
      assert.isTrue(reloaded.undo());
      assert.deepEqual(reloaded.workingAnimation, reloaded.sourceAnimation);
      assert.isTrue(reloaded.redo());
      assert.deepEqual(reloaded.workingAnimation, committed);
    } finally {
      controller.dispose();
      recovery.dispose();
      next.dispose();
      nextRecovery.dispose();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  },
);

test('synchronous restoration cannot recursively rebind and remains one undoable edit', () => {
  const { state, recovery, controller } = fixture();
  recovery.bind.mockImplementationOnce((session) => {
    assert.isTrue(session.restore({ ...state.sourceAnimation, tracks: { root: [{ time: 0, x: 44 }] } }));
  });
  controller.bind(state, 'character');
  assert.equal(recovery.bind.mock.calls.length, 1);
  assert.isTrue(state.dirty);
  assert.equal(state.historyLength, 1);
  assert.equal(state.getEvaluatedBonePropertyValue('root', 'x', 0), 44);
  assert.isTrue(state.undo());
  assert.isFalse(state.dirty);
  controller.dispose();
});

test('rig tweaks and restored rig drafts retain animation recovery identity and authored edits', () => {
  const { state, rig, animations, recovery, controller, session } = fixture();
  controller.bind(state, 'character');
  const original = session();
  const tweaked = new Rig({ root: 'root', bones: [{ id: 'root', x: 20 }] });
  state.updatePreviewRig(tweaked);
  state.setBonePropertyKeyframe('root', 'x', 42, 0);
  const snapshot = original.snapshot();
  assert.equal(recovery.bind.mock.calls.length, 1);
  controller.unbind();

  // The rig draft restores before animation recovery binds on page reload.
  const reloaded = new AnimationEditorState(rig, animations);
  reloaded.selectAnimation('first');
  reloaded.updatePreviewRig(tweaked);
  controller.bind(reloaded, 'character');
  assert.equal(session().source, original.source);
  assert.isTrue(session().validate(snapshot));
  assert.isTrue(session().restore(snapshot));
  assert.isTrue(reloaded.dirty);
  assert.equal(reloaded.getEvaluatedBonePropertyValue('root', 'x', 0), 42);
  assert.strictEqual(reloaded.rig, tweaked);
  reloaded.undo();
  assert.isFalse(reloaded.dirty);
  assert.strictEqual(reloaded.rig, tweaked);
  controller.dispose();
});

test('source rig changes invalidate recovery while validation uses the current preview rig', () => {
  const { state, animations, controller, session } = fixture();
  controller.bind(state, 'character');
  const original = session();
  const changed = new Rig({ root: 'root', bones: [{ id: 'root', x: 20 }] });
  const reloaded = new AnimationEditorState(changed, animations);
  reloaded.selectAnimation('first');
  controller.bind(reloaded, 'character');
  assert.notEqual(session().source, original.source);
  // Source identity stays fixed, but compatibility must reflect the current rig.
  reloaded.updatePreviewRig(new Rig({ root: 'different', bones: [{ id: 'different' }] }));
  assert.isFalse(session().validate(state.workingAnimation));
  controller.dispose();
});

test('animation navigation binds separate keys and deselection releases the current draft', () => {
  const { state, recovery, controller, session } = fixture();
  controller.bind(state, 'character');
  state.selectAnimation('second');
  assert.equal(session().key, JSON.stringify(['/animation-editor/', 'character', 'second']));
  assert.deepEqual(recovery.bind.mock.lastCall![1], { recover: true });
  state.selectAnimation(null);
  assert.equal(recovery.unbind.mock.calls.length, 2);
  state.selectAnimation('first');
  assert.equal(session().key, JSON.stringify(['/animation-editor/', 'character', 'first']));
  assert.equal(recovery.bind.mock.calls.length, 3);
  assert.deepEqual(recovery.bind.mock.lastCall![1], { recover: false });
  controller.dispose();
});

test('returning to an in-memory dirty clip never offers to overwrite it with a browser draft', () => {
  const { state, recovery, controller } = fixture();
  controller.bind(state, 'character');
  state.setBonePropertyKeyframe('root', 'x', 42, 0);
  const authored = state.workingAnimation;
  state.selectAnimation('second', { keepChanges: true });
  state.selectAnimation('first', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, authored);
  assert.deepEqual(recovery.bind.mock.lastCall![1], { recover: false });
  controller.dispose();
});

test('same-name imports clear the prior draft before binding and skip restoration for the new baseline', () => {
  const { state, recovery, controller, calls, session } = fixture();
  controller.bind(state, 'character');
  state.setBonePropertyKeyframe('root', 'x', 42, 0);
  calls.length = 0;
  assert.isTrue(state.importJson(JSON.stringify({ ...state.sourceAnimation, duration: 2000 })));
  assert.deepEqual(calls, ['update', 'bind', 'update']);
  assert.deepEqual(recovery.bind.mock.lastCall![1], { recover: false });
  assert.isFalse(session().dirty());
  assert.equal(session().source, draftSource({ rig: state.rig, animation: state.sourceAnimation }));
  state.setBonePropertyKeyframe('root', 'x', 99, 0);
  const bindings = recovery.bind.mock.calls.length;
  assert.isTrue(state.revertAnimation({ discardChanges: true }));
  assert.equal(recovery.bind.mock.calls.length, bindings);
  assert.isFalse(session().dirty());
  controller.dispose();
});

test('different-name imports skip restoration while later navigation permits recovery', () => {
  const { state, recovery, controller, session } = fixture();
  controller.bind(state, 'character');
  assert.isTrue(state.importJson(JSON.stringify({ ...state.sourceAnimation, name: 'imported' })));
  assert.equal(session().key, JSON.stringify(['/animation-editor/', 'character', 'imported']));
  assert.deepEqual(recovery.bind.mock.lastCall![1], { recover: false });
  state.selectAnimation('second');
  assert.deepEqual(recovery.bind.mock.lastCall![1], { recover: true });
  controller.dispose();
});

test('character rebinding, unbinding and disposal release old state subscriptions', () => {
  const { state, rig, animations, recovery, controller, session } = fixture();
  controller.bind(state, 'character');
  const next = new AnimationEditorState(rig, animations);
  next.selectAnimation('first');
  controller.bind(next, 'other-character');
  assert.equal(session().key, JSON.stringify(['/animation-editor/', 'other-character', 'first']));
  const updates = recovery.update.mock.calls.length;
  state.setCurrentTime(0.5);
  assert.equal(recovery.update.mock.calls.length, updates);
  next.setCurrentTime(0.25);
  assert.equal(recovery.update.mock.calls.length, updates + 1);
  controller.unbind();
  next.setCurrentTime(0.5);
  assert.equal(recovery.update.mock.calls.length, updates + 1);
  controller.bind(next, 'other-character');
  controller.dispose();
  const disposedUpdates = recovery.update.mock.calls.length;
  next.setCurrentTime(0.75);
  assert.equal(recovery.update.mock.calls.length, disposedUpdates);
});
