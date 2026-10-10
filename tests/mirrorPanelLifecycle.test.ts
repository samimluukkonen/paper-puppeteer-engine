import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { MirrorToolsController } from '../src/devtools/animation-editor/MirrorToolsController.js';
import { MirrorToolsPanel } from '../src/devtools/animation-editor/MirrorToolsPanel.js';
import { Rig } from '../src/engine/Rig.js';

const effects = vi.hoisted(() => ({ cleanup: [] as Array<() => void> }));
// Exercise the component's effect contract without a DOM renderer; real controls run in local Playwright.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: () => ({ current: null }),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: (effect: () => () => void) => effects.cleanup.push(effect()),
}));

afterEach(() => {
  effects.cleanup = [];
  vi.unstubAllGlobals();
});

function fixture() {
  const rig = new Rig({
    root: 'root',
    bones: [{ id: 'root' }, { id: 'leftArm', parent: 'root' }, { id: 'rightArm', parent: 'root' }],
  });
  const state = new AnimationEditorState(rig, [
    { name: 'wave', duration: 1000, loop: false, tracks: { leftArm: [{ time: 0, rotation: 0.4 }] } },
  ]);
  state.selectAnimation('wave');
  const controller = new MirrorToolsController(vi.fn(), () => ({ getItem: () => null, setItem: () => {} }));
  controller.bind(state, 'fixture');
  return { state, controller };
}

test('panel effect teardown removes the same shortcut listener and hides preview while retaining the editor', () => {
  const add = vi.fn();
  const remove = vi.fn();
  vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });
  const { state, controller } = fixture();
  controller.togglePreview();
  const original = state.workingAnimation;
  MirrorToolsPanel({ controller });
  assert.equal(add.mock.calls.length, 1);
  effects.cleanup[0]!();
  assert.deepEqual(remove.mock.calls[0], add.mock.calls[0]);
  assert.isFalse(controller.getSnapshot().preview);
  assert.isTrue(controller.getSnapshot().ready);
  assert.strictEqual(state.workingAnimation, original);
  assert.equal(state.historyLength, 0);
  assert.isFalse(state.dirty);
  controller.dispose();
});

test('replacing a panel controller clears the old preview and cleanup remains safe after disposal', () => {
  const add = vi.fn();
  const remove = vi.fn();
  vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });
  const old = fixture();
  MirrorToolsPanel({ controller: old.controller });
  old.controller.togglePreview();
  effects.cleanup[0]!();
  const next = fixture();
  MirrorToolsPanel({ controller: next.controller });
  next.controller.togglePreview();
  assert.isFalse(old.controller.getSnapshot().preview);
  assert.isTrue(next.controller.getSnapshot().preview);
  next.controller.dispose();
  effects.cleanup[1]!();
  assert.equal(remove.mock.calls.length, 2);
  assert.isFalse(next.controller.getSnapshot().ready);
  old.controller.dispose();
});
