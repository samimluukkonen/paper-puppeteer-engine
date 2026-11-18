import { afterEach, assert, test, vi } from 'vitest';
import { AnimationDraftRecoveryController } from '../src/devtools/animation-editor/AnimationDraftRecoveryController.js';
import { AnimationEditorState, type ReadonlyAnimation } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { DraftRecovery } from '../src/devtools/shared/DraftRecovery.js';
import { Rig } from '../src/engine/Rig.js';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  const confirm = vi.fn(() => true);
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage, confirm }));
  vi.stubGlobal('document', new EventTarget());
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const open = (character = 'character', pathname = '/animation-editor/', sourceRig = rig) => {
    const state = new AnimationEditorState(sourceRig, [{ name: 'loaded', duration: 1000, loop: false, tracks: {} }]);
    state.selectAnimation('loaded');
    const status = vi.fn<(message: string) => void>();
    const recovery = new DraftRecovery<ReadonlyAnimation | null>(status);
    const controller = new AnimationDraftRecoveryController(recovery, pathname);
    controller.bind(state, character);
    const dispose = () => {
      controller.dispose();
      recovery.dispose();
    };
    disposers.push(dispose);
    return { state, recovery, dispose, status };
  };
  const create = (state: AnimationEditorState, name: string, x = 42) => {
    assert.isTrue(state.createAnimation({ name, durationSeconds: 2, fps: 17, loop: false }));
    assert.isTrue(state.keyframes.setBonePropertyKeyframe('root', 'x', x, 0));
  };
  return { values, confirm, rig, open, create };
}

test('reload discovers multiple missing clips, retains source/history and transfers only restored backups', () => {
  const { open, create, values, confirm } = fixture();
  const original = open();
  create(original.state, 'new-one', 42);
  create(original.state, 'new-two', 84);
  original.dispose();
  const oldKeys = [...values.keys()];
  assert.lengthOf(oldKeys, 2);
  confirm.mockClear();
  const reloaded = open('character', '/rig-editor/');
  assert.sameMembers([...reloaded.state.animationIds], ['loaded', 'new-one', 'new-two']);
  assert.equal(confirm.mock.calls.length, 2);
  assert.isTrue(reloaded.state.isNewAnimation());
  assert.include(reloaded.status.mock.lastCall![0], 'Draft restored');
  reloaded.state.selectAnimation('new-one', { keepChanges: true });
  assert.equal(reloaded.state.getEvaluatedBonePropertyValue('root', 'x', 0), 42);
  assert.equal(reloaded.state.workingAnimation?.duration, 2000);
  assert.deepEqual(reloaded.state.workingAnimation?.playback, { mode: 'stepped', fps: 17 });
  assert.isTrue(reloaded.state.undo());
  assert.isUndefined(reloaded.state.workingAnimation?.tracks.root);
  assert.isTrue(reloaded.state.isNewAnimation());
  assert.isTrue(reloaded.state.redo());
  reloaded.state.selectAnimation('new-two', { keepChanges: true });
  assert.equal(reloaded.state.getEvaluatedBonePropertyValue('root', 'x', 0), 84);
  reloaded.recovery.flush();
  reloaded.state.selectAnimation('new-one', { keepChanges: true });
  reloaded.recovery.flush();
  assert.lengthOf([...values], 2);
  assert.isFalse(oldKeys.some((key) => values.has(key)));
});

test('declining restoration preserves backups and leaves the source catalog intact', () => {
  const { open, create, values, confirm } = fixture();
  const original = open();
  create(original.state, 'new');
  original.dispose();
  const stored = [...values];
  confirm.mockReturnValue(false);
  const reloaded = open();
  assert.deepEqual(reloaded.state.animationIds, ['loaded']);
  reloaded.dispose();
  assert.deepEqual([...values], stored);
});

test('discovery rejects other characters, routes and changed rigs without deleting drafts', () => {
  const { open, create, values, confirm } = fixture();
  const original = open();
  create(original.state, 'new');
  original.dispose();
  const stored = [...values];
  confirm.mockClear();
  for (const session of [
    open('other'),
    open('character', '/elsewhere/animation-editor/'),
    open('character', '/animation-editor/', new Rig({ root: 'root', bones: [{ id: 'root', x: 10 }] })),
  ]) {
    assert.deepEqual(session.state.animationIds, ['loaded']);
    session.dispose();
  }
  assert.equal(confirm.mock.calls.length, 0);
  assert.deepEqual([...values], stored);
});

test('invalid discovery metadata and snapshots never register a clip or delete its backup', () => {
  const { open, create, values, confirm } = fixture();
  const original = open();
  create(original.state, 'new');
  original.dispose();
  const [key, text] = [...values][0]!;
  const envelope: unknown = JSON.parse(text);
  const draft = envelope as Record<string, unknown>;
  for (const invalid of [
    { ...draft, context: {} },
    { ...draft, source: 'invalid-source' },
    { ...draft, data: { version: 1, name: 'different' } },
  ]) {
    values.set(key, JSON.stringify(invalid));
    const stored = [...values];
    confirm.mockClear();
    const reloaded = open();
    assert.deepEqual(reloaded.state.animationIds, ['loaded']);
    assert.equal(confirm.mock.calls.length, 0);
    reloaded.dispose();
    assert.deepEqual([...values], stored);
  }
});

test('a legacy orphan draft is offered as a new unsaved clip and retained if persistence fails', () => {
  const { open, create, values } = fixture();
  const original = open();
  create(original.state, 'legacy');
  original.dispose();
  const [key, text] = [...values][0]!;
  const parsed: unknown = JSON.parse(text);
  assert.isObject(parsed);
  const legacy = { ...(parsed as Record<string, unknown>) };
  delete legacy.context;
  values.set(key, JSON.stringify(legacy));
  const reloaded = open();
  assert.equal(reloaded.state.selectedAnimationId, 'legacy');
  assert.isTrue(reloaded.state.dirty);
  assert.equal(reloaded.state.getEvaluatedBonePropertyValue('root', 'x', 0), 42);
  window.localStorage.setItem = () => {
    throw new Error('quota');
  };
  reloaded.recovery.flush();
  assert.isTrue(values.has(key));
});

test('recovering a missing clip never replaces a registered clip', () => {
  const { open } = fixture();
  const { state } = open();
  const before = state.workingAnimation;
  assert.isFalse(state.recoverAnimation(before, before));
  assert.strictEqual(state.workingAnimation, before);
});
