import { getCharacterPreviewSettings } from '../../shared/characterPreviewSettings.js';
import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { mountView } from '../../ui/mountView.js';
import { DraftRecoveryControls } from '../shared/DraftRecoveryControls.js';
import { createEditorGame } from '../shared/editorGame.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { AnimationDraftRecoveryController } from './AnimationDraftRecoveryController.js';
import { AnimationEditorScene } from './AnimationEditorScene.js';
import type { ReadonlyAnimation } from './AnimationEditorState.js';
import { AnimationWorkspaceController } from './AnimationWorkspaceController.js';
import { BoneInspectorController } from './BoneInspectorController.js';
import { AnimationEditorView } from './editorMarkup.js';
import { IKBakeController } from './IKBakeController.js';
import { IKInspectorController } from './IKInspectorController.js';
import { MirrorToolsController } from './MirrorToolsController.js';
import { OnionSkinControlsController } from './OnionSkinControlsController.js';
import { TimelineController } from './TimelineController.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#animation-editor-app');
if (!app) throw new Error('Missing animation editor host.');
app.classList.add('view-shell', 'workspace-shell', 'animation-workspace');
let scene: AnimationEditorScene | undefined;
const ikInspector = new IKInspectorController();
const mirrorTools = new MirrorToolsController((pose) => scene?.setMirrorPreview(pose));
const ikBake = new IKBakeController(
  (pose) => scene?.setBakePreview(pose),
  () => scene?.getBakeRuntimeConstraints() ?? [],
);
const editorView = <AnimationEditorView mirrorTools={mirrorTools} ikInspector={ikInspector} ikBake={ikBake} />;
const unmount = mountView(app, editorView, (app) => {
  const releaseCharacterSelection = bindCharacterSelection(app);
  const timeline = new TimelineController(app);
  const inspector = new BoneInspectorController(app);
  const releaseNavigationGuard = protectUnsavedChanges(() => timeline.hasUnsavedChanges);
  const recoveryControls = new DraftRecoveryControls<ReadonlyAnimation | null>(
    app.querySelector<HTMLElement>('#animation-draft-status')!,
    app.querySelector<HTMLButtonElement>('#animation-download-retained-drafts')!,
  );
  const recovery = new AnimationDraftRecoveryController(recoveryControls.recovery, window.location.pathname);
  let releaseWorkspaceSelection: (() => void) | undefined;
  const editorScene = new AnimationEditorScene(
    (state, id) => {
      editorScene.fitPreview();
      mirrorTools.bind(state, JSON.stringify([window.location.pathname, id]));
      ikBake.bind(state);
      timeline.bind(state, id);
      inspector.bind(state);
      ikInspector.bind(state);
      releaseWorkspaceSelection?.();
      let selectedIK = state.selectedIKConstraintId;
      let selectedBone = state.selectedBoneId;
      let selectedEvent = state.selectedEvent;
      let selectedKeys = state.selectedKeys;
      releaseWorkspaceSelection = state.subscribe(() => {
        if (
          (state.selectedIKConstraintId && state.selectedIKConstraintId !== selectedIK) ||
          (state.selectedBoneId && state.selectedBoneId !== selectedBone) ||
          (state.selectedEvent && state.selectedEvent !== selectedEvent) ||
          (state.selectedKeys.length && state.selectedKeys !== selectedKeys)
        )
          workspace.revealInspector();
        selectedIK = state.selectedIKConstraintId;
        selectedBone = state.selectedBoneId;
        selectedEvent = state.selectedEvent;
        selectedKeys = state.selectedKeys;
      });
      recovery.bind(state, id);
    },
    (message) => {
      recovery.unbind();
      mirrorTools.unbind();
      ikBake.unbind();
      ikInspector.unbind();
      timeline.showError(message);
    },
    {
      characterUrl: `../characters/${selectedCharacterId()}/character.json`,
      ikChains: getCharacterPreviewSettings(selectedCharacterId()).ikChains,
    },
  );
  scene = editorScene;
  const previewControls = new AbortController();
  app.querySelector<HTMLSelectElement>('#animation-facing')!.addEventListener(
    'change',
    (event) => {
      const facing = (event.target as HTMLSelectElement).value;
      if (facing === 'left' || facing === 'right') editorScene.setFacing(facing);
    },
    { signal: previewControls.signal },
  );
  app.querySelector<HTMLInputElement>('#animation-show-bones')!.addEventListener(
    'change',
    (event) => {
      editorScene.setBonesVisible((event.target as HTMLInputElement).checked);
    },
    { signal: previewControls.signal },
  );
  for (const [id, apply] of [
    ['#animation-ik-handles', (value: boolean) => editorScene.setIKHandlesVisible(value)],
    ['#animation-ik-drag', (value: boolean) => editorScene.setIKHandlesInteractive(value)],
  ] as const) {
    app.querySelector<HTMLInputElement>(id)!.addEventListener(
      'change',
      (event) => {
        apply((event.target as HTMLInputElement).checked);
      },
      { signal: previewControls.signal },
    );
  }
  const onionControls = new OnionSkinControlsController(app, editorScene);
  app.querySelector<HTMLInputElement>('#animation-ik-preview')!.addEventListener(
    'change',
    (event) => {
      editorScene.setIKPreview((event.target as HTMLInputElement).checked);
      ikBake.refreshRuntime();
    },
    { signal: previewControls.signal },
  );
  const game = createEditorGame('animation-stage', editorScene);
  const workspace = new AnimationWorkspaceController(app, () => {
    game.scale.getParentBounds();
    game.scale.refresh();
  });

  return () => {
    recovery.dispose();
    releaseWorkspaceSelection?.();
    mirrorTools.dispose();
    ikBake.dispose();
    workspace.dispose();
    recoveryControls.dispose();
    releaseNavigationGuard();
    timeline.dispose();
    inspector.dispose();
    ikInspector.dispose();
    onionControls.dispose();
    previewControls.abort();
    releaseCharacterSelection();
    game.destroy(true);
    scene = undefined;
  };
});
if (import.meta.hot) import.meta.hot.dispose(unmount);
