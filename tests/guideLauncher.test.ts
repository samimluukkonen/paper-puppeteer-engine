import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { RigTweakController } from '../src/devtools/animation-editor/RigTweakController.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { GuideLauncher } from '../src/devtools/shared/guides/GuideLauncher.js';
import { GuideRegistry, guideRegistry } from '../src/devtools/shared/guides/registry.js';
import type { GuideContext } from '../src/devtools/shared/guides/types.js';
import { workspaceGuideHost } from '../src/devtools/shared/guides/workspaceGuideHost.js';
import { Rig } from '../src/engine/Rig.js';
import { FeatureGuide, FeatureGuideButton } from '../src/ui/FeatureGuide.js';

afterEach(() => vi.unstubAllGlobals());

function workspace(registry = guideRegistry) {
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const rigState = new RigEditorState(rig);
  const animation = new AnimationEditorState(rig, [
    { name: 'idle', duration: 1000, loop: true, tracks: { root: [{ time: 0, x: 0 }] } },
  ]);
  animation.selectAnimation('idle');
  const mode = new RigTweakController();
  mode.bind(animation, { state: rigState } as never);
  const navigate = vi.fn((editor: 'rig' | 'animation') => mode.setMode(editor));
  const host = workspaceGuideHost({
    initialEditor: 'animation',
    getAnimation: () => animation,
    getRig: () => rigState,
    navigate,
  });
  return { launcher: new GuideLauncher(host, registry), rigState, animation, navigate, host };
}

test('launch navigates before activating the registry first step and preserves unsaved documents/history', () => {
  const { launcher, rigState, animation, navigate } = workspace();
  rigState.editBone('root', 'x', 12);
  animation.setBonePropertyKeyframe('root', 'x', 8);
  const rig = rigState.workingCopy;
  const clip = animation.workingAnimation;
  const rigHistory = rigState.historyLength;
  const animationHistory = animation.historyLength;
  navigate.mockImplementation((editor) => {
    assert.equal(launcher.controller.getSnapshot().status, 'idle');
    animation.setEditorMode(editor);
    return true;
  });
  assert.deepEqual(launcher.launch('rig-joint-editing'), { ok: true });
  assert.equal(animation.editorMode, 'rig');
  assert.equal(launcher.controller.getSnapshot().currentStep?.id, 'hierarchy');
  assert.equal(launcher.controller.getSnapshot().stepIndex, 0);
  assert.strictEqual(rigState.workingCopy, rig);
  assert.strictEqual(animation.workingAnimation, clip);
  assert.equal(rigState.historyLength, rigHistory);
  assert.equal(animation.historyLength, animationHistory);
  assert.isTrue(rigState.dirty);
  assert.isTrue(animation.dirty);
});

test('uncommitted previews block mode changes without even offering to discard them', () => {
  const { launcher, animation, navigate } = workspace();
  const confirm = vi.fn(() => true);
  vi.stubGlobal('window', { confirm });
  animation.selectBone('root');
  animation.setTemporaryBoneProperty('y', 17);
  launcher.refresh();
  assert.include(JSON.stringify(launcher.getAvailability('rig-joint-editing')), 'Commit or revert');
  assert.isFalse(launcher.launch('rig-joint-editing').ok);
  assert.isTrue(animation.hasTemporaryTransform);
  assert.equal(animation.editorMode, 'animation');
  assert.lengthOf(navigate.mock.calls, 0);
  assert.lengthOf(confirm.mock.calls, 0);
  assert.isTrue(launcher.launch('animation-timeline-navigation').ok, 'same-mode launch preserves the preview');
  assert.isTrue(animation.hasTemporaryTransform);
});

test('canceled and unready navigation never activate a guide; context is revalidated after navigation', () => {
  const { host } = workspace();
  const navigate = vi.fn<(_: 'rig' | 'animation') => boolean | 'cancel'>(() => 'cancel');
  const launcher = new GuideLauncher({ ...host, navigate });
  assert.deepEqual(launcher.launch('rig-joint-editing'), { ok: false, reason: 'Editor navigation was canceled.' });
  assert.equal(launcher.controller.getSnapshot().status, 'idle');
  navigate.mockReturnValue(false);
  assert.deepEqual(launcher.launch('rig-joint-editing'), { ok: false, reason: 'Editor is not ready.' });
  let context: GuideContext = { editor: 'rig', capabilities: ['character', 'valid-rig'] };
  const changing = new GuideLauncher({
    getContext: () => context,
    getNavigationAvailability: () => ({ available: true }),
    navigate: () => {
      context = { editor: 'rig', capabilities: [] };
      return true;
    },
  });
  assert.deepEqual(changing.launch('rig-joint-editing'), { ok: false, reason: 'Load or create a character first.' });
  assert.equal(changing.controller.getSnapshot().status, 'idle');
});

test('availability handles failed loads, missing clips, invalid rigs, unknown references, and active sessions', () => {
  const { launcher, animation, rigState, navigate } = workspace();
  assert.deepEqual(launcher.launch('missing'), { ok: false, reason: 'Guide not found: missing' });
  assert.lengthOf(navigate.mock.calls, 0);
  const validation = vi
    .spyOn(rigState, 'validationIssues')
    .mockReturnValue([{ severity: 'error', message: 'Invalid rig draft.' }]);
  assert.isFalse(launcher.launch('rig-joint-editing').ok);
  validation.mockRestore();
  assert.isTrue(launcher.launch('rig-joint-editing').ok);
  const active = launcher.controller.getSnapshot();
  assert.isFalse(launcher.launch('animation-timeline-navigation').ok);
  assert.strictEqual(launcher.controller.getSnapshot(), active);
  launcher.controller.exit();
  assert.isTrue(launcher.launch('animation-timeline-navigation').ok);
  assert.equal(animation.editorMode, 'animation');
  const noCharacter = new GuideLauncher(
    workspaceGuideHost({
      initialEditor: 'rig',
      getAnimation: () => undefined,
      getRig: () => undefined,
      navigate,
    }),
  );
  assert.deepEqual(noCharacter.getAvailability('rig-joint-editing'), {
    available: false,
    reason: 'Load or create a character first.',
  });
  const noClip = new AnimationEditorState(rigState.rig, []);
  const empty = new GuideLauncher(
    workspaceGuideHost({
      initialEditor: 'animation',
      getAnimation: () => noClip,
      getRig: () => rigState,
      navigate,
    }),
  );
  assert.deepEqual(empty.getAvailability('animation-timeline-navigation'), {
    available: false,
    reason: 'Create or select an animation first.',
  });
});

test('registry supplies modal rows, optional IK/tool reasons, and creation guides without resource prerequisites', () => {
  const base = guideRegistry.getGuideById('rig-joint-editing')!;
  const registry = new GuideRegistry([
    { ...base, id: 'create', title: 'Creating a character', prerequisites: [] },
    {
      ...base,
      id: 'ik',
      title: 'Specific IK tool',
      prerequisites: [{ capability: 'ik-constraints', reason: 'Add IK first.' }],
    },
    {
      ...base,
      id: 'tool',
      title: 'Optional tool',
      prerequisites: [{ capability: 'tool:optional', reason: 'Enable optional tool.' }],
    },
    {
      ...base,
      id: 'first-step',
      title: 'Step prerequisite',
      prerequisites: [],
      steps: [
        { ...base.steps[0]!, prerequisites: [{ capability: 'animation', reason: 'Select an animation first.' }] },
      ],
    },
  ]);
  const launcher = new GuideLauncher(
    {
      getContext: () => ({ editor: 'rig', capabilities: [] }),
      getNavigationAvailability: () => ({ available: true }),
      navigate: () => true,
    },
    registry,
  );
  const markup = renderToStaticMarkup(
    createElement(FeatureGuide, { launcher, children: createElement(FeatureGuideButton) }),
  );
  for (const guide of registry.getAllGuides()) assert.include(markup, guide.title);
  assert.include(markup, 'No character is loaded');
  assert.include(markup, 'Unavailable: Add IK first.');
  assert.include(markup, 'Unavailable: Enable optional tool.');
  assert.include(markup, 'Unavailable: Select an animation first.');
  assert.isTrue(launcher.getAvailability('create').available);
  assert.isTrue(launcher.launch('create').ok);
  const unloaded = new GuideLauncher(
    workspaceGuideHost({
      initialEditor: 'rig',
      getAnimation: () => undefined,
      getRig: () => undefined,
      navigate: () => true,
    }),
    registry,
  );
  assert.isTrue(unloaded.getAvailability('create').available, 'creation guides can teach missing prerequisites');
  assert.isTrue(unloaded.launch('create').ok);
  const empty = workspace(new GuideRegistry([])).launcher;
  assert.include(
    renderToStaticMarkup(createElement(FeatureGuide, { launcher: empty, children: null })),
    'No guides are available for this editor yet.',
  );
});
