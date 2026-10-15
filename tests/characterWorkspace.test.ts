import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { RigTweakController } from '../src/devtools/animation-editor/RigTweakController.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { bindWorkspaceNavigation, workspaceView } from '../src/devtools/shared/WorkspaceNavigation.js';
import { Rig } from '../src/engine/Rig.js';

const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
const clips = ['walk', 'idle'].map((name) => ({
  name,
  duration: 1000,
  loop: true,
  tracks: { root: [{ time: 0, x: 0 }] },
}));
function workspace() {
  const state = new AnimationEditorState(rig, clips);
  state.selectAnimation('walk');
  return state;
}
afterEach(() => vi.unstubAllGlobals());

test('pending clips retain independent documents, baselines, context and undo/redo through navigation', () => {
  const state = workspace();
  state.setBonePropertyKeyframe('root', 'x', 10);
  state.setCurrentTime(0.6);
  state.selectKeyframes([{ boneId: 'root', property: 'x', time: 0 }]);
  state.setCurrentTime(0.6);
  const walk = state.workingAnimation;
  state.selectAnimation('idle', { keepChanges: true });
  assert.isFalse(state.dirty);
  assert.isTrue(state.hasUnsavedChanges);
  state.setBonePropertyKeyframe('root', 'x', 20);
  const idle = state.workingAnimation;
  assert.deepEqual(
    state.packageAnimations().map((clip) => clip.tracks.root![0]!.x),
    [10, 20],
  );
  state.selectAnimation('walk', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, walk);
  assert.equal(state.currentTime, 0.6);
  assert.equal(state.selectedKeys.length, 1);
  assert.isTrue(state.undo());
  assert.isFalse(state.dirty);
  assert.isTrue(state.hasUnsavedChanges);
  assert.isTrue(state.redo());
  state.markSaved();
  state.selectAnimation('idle', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, idle);
  assert.isTrue(state.undo());
  assert.isFalse(state.hasUnsavedChanges);
  assert.equal(clips[0]!.tracks.root[0]!.x, 0);
});

test('invalid imports and canceled inactive document replacement preserve all authored clips', () => {
  const state = workspace();
  state.setBonePropertyKeyframe('root', 'x', 10);
  state.selectAnimation('idle', { keepChanges: true });
  const before = state.packageAnimations();
  assert.isFalse(state.importJson('{broken'));
  assert.deepEqual(state.packageAnimations(), before);
  const confirmDiscard = vi.fn(() => false);
  assert.isFalse(state.importJson(JSON.stringify({ ...clips[0], version: 1 }), { confirmDiscard }));
  assert.equal(confirmDiscard.mock.calls.length, 1);
  assert.deepEqual(state.packageAnimations(), before);
  assert.equal(state.selectedAnimationId, 'idle');
});

test('importing a different clip retains the pending old document and its history', () => {
  const state = workspace();
  state.setBonePropertyKeyframe('root', 'x', 10);
  const old = state.workingAnimation;
  assert.isTrue(state.importJson(JSON.stringify({ ...clips[1], version: 1 }), { confirmDiscard: () => true }));
  assert.isFalse(state.dirty);
  assert.isTrue(state.hasUnsavedChanges);
  state.selectAnimation('walk', { keepChanges: true });
  assert.strictEqual(state.workingAnimation, old);
  assert.isTrue(state.undo());
  assert.isFalse(state.hasUnsavedChanges);
});

test('mode UI offers cancel for uncommitted previews while committed edits are retained', () => {
  const state = workspace();
  state.setBonePropertyKeyframe('root', 'x', 10);
  state.selectBone('root');
  state.setTemporaryBoneProperty('y', 5);
  const confirm = vi.fn(() => false);
  vi.stubGlobal('window', { confirm });
  const controller = new RigTweakController();
  controller.bind(state, { state: new RigEditorState(rig) } as never);
  const authored = state.workingAnimation;
  assert.isFalse(controller.setMode('rig'));
  assert.equal(state.editorMode, 'animation');
  assert.isTrue(state.hasTemporaryTransform);
  confirm.mockReturnValue(true);
  assert.isTrue(controller.setMode('rig'));
  assert.isFalse(state.hasTemporaryTransform);
  assert.isFalse(state.setBonePropertyKeyframe('root', 'y', 55));
  assert.strictEqual(state.workingAnimation, authored);
  controller.setMode('animation');
  assert.isTrue(state.undo());
  controller.dispose();
});

test('embedded skin authoring and joint authoring have separate dirty domains and shared history', () => {
  const state = new RigEditorState(rig);
  state.createSkin('alternate');
  assert.isTrue(state.dirty);
  assert.isTrue(state.skinsDirty);
  assert.isFalse(state.rigDirty);
  state.editBone('root', 'x', 2);
  assert.isTrue(state.rigDirty);
  state.undo();
  assert.isFalse(state.rigDirty);
  assert.isTrue(state.skinsDirty);
  state.undo();
  assert.isFalse(state.dirty);
});

test('rig imports cannot remove the default skin and leave the current character unrenderable', () => {
  const source = new Rig({ root: 'root', bones: [{ id: 'root' }] }, [{ version: 1, name: 'basic', slots: {} }]);
  const state = new RigEditorState(source, undefined, { defaultSkin: 'basic' });
  state.editBone('root', 'x', 7);
  const before = state.workingCopy;
  const file = { ...state.exportRig(false), skins: [] };
  assert.isFalse(state.canRestoreDraft(file));
  assert.isFalse(state.restoreDraft(file));
  assert.strictEqual(state.workingCopy, before);
});

test('missing artwork or private texture references reject an imported catalog without replacing working data', () => {
  const state = new RigEditorState(rig, undefined, {
    artworkIssue: (texture) => (texture === 'loaded' ? undefined : 'Missing image asset.'),
  });
  state.editBone('root', 'x', 7);
  const before = state.workingCopy;
  for (const texture of ['missing', '__paper_artwork_private']) {
    const file = { ...state.exportRig(false), attachments: [{ id: 'new', texture }] };
    assert.isFalse(state.canRestoreDraft(file));
    assert.isFalse(state.restoreDraft(file));
    assert.strictEqual(state.workingCopy, before);
  }
});

test('editor route detection supports deployment bases and excludes unrelated navigation', () => {
  assert.equal(workspaceView(new URL('https://example.test/base/rig-editor/')), 'rig');
  assert.equal(workspaceView(new URL('https://example.test/base/animation-editor?character=test')), 'animation');
  assert.isNull(workspaceView(new URL('https://example.test/base/')));
});

test('local editor navigation retains the owner, respects cancel/modifiers, and releases handlers', () => {
  const location = { href: 'https://example.test/base/animation-editor/?character=test' };
  const browser = new EventTarget();
  const pushState = vi.fn((_data: unknown, _title: string, url: string) => {
    location.href = url;
  });
  Object.assign(browser, { location, history: { pushState } });
  class Link extends EventTarget {
    href = 'https://example.test/base/rig-editor/?character=test';
    target = '';
    closest() {
      return this;
    }
    hasAttribute() {
      return false;
    }
  }
  vi.stubGlobal('window', browser);
  vi.stubGlobal('Element', Link);
  const host = new Link();
  const navigate = vi.fn<(_: 'rig' | 'animation') => boolean | 'cancel'>(() => true);
  const release = bindWorkspaceNavigation(host as unknown as HTMLElement, navigate);
  const click = (ctrlKey = false) => {
    const event = new Event('click', { cancelable: true });
    Object.assign(event, { button: 0, ctrlKey });
    host.dispatchEvent(event);
    return event;
  };
  assert.isFalse(click(true).defaultPrevented);
  assert.equal(navigate.mock.calls.length, 0);
  navigate.mockReturnValue('cancel');
  assert.isTrue(click().defaultPrevented);
  assert.equal(pushState.mock.calls.length, 0);
  navigate.mockReturnValue(true);
  assert.isTrue(click().defaultPrevented);
  assert.equal(pushState.mock.calls.length, 1);
  assert.equal(navigate.mock.calls.at(-1)![0], 'rig');
  location.href = 'https://example.test/base/animation-editor/?character=test';
  browser.dispatchEvent(new Event('popstate'));
  assert.equal(navigate.mock.calls.at(-1)![0], 'animation');
  release();
  const count = navigate.mock.calls.length;
  click();
  browser.dispatchEvent(new Event('popstate'));
  assert.equal(navigate.mock.calls.length, count);
});
