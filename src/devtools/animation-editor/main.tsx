import { useLayoutEffect, useSyncExternalStore } from 'react';
import { getCharacterPreviewSettings } from '../../shared/characterPreviewSettings.js';
import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { mountView } from '../../ui/mountView.js';
import { observePreview } from '../../ui/observePreview.js';
import { AttachmentController } from '../rig-editor/AttachmentController.js';
import '../rig-editor/style.css';
import { RigEditorView } from '../rig-editor/editorMarkup.js';
import { createRigWorkspaceController } from '../rig-editor/RigWorkspaceController.js';
import { ArtworkController } from '../shared/artwork/ArtworkController.js';
import { DraftRecoveryControls } from '../shared/DraftRecoveryControls.js';
import { createEditorGame } from '../shared/editorGame.js';
import { PackageController } from '../shared/package/PackageController.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { bindWorkspaceNavigation, workspaceView } from '../shared/WorkspaceNavigation.js';
import { AnimationDraftRecoveryController } from './AnimationDraftRecoveryController.js';
import { AnimationEditorScene } from './AnimationEditorScene.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import { AnimationWorkspaceController } from './AnimationWorkspaceController.js';
import { BoneInspectorController } from './BoneInspectorController.js';
import { AnimationEditorView } from './editorMarkup.js';
import { IKBakeController } from './IKBakeController.js';
import { IKInspectorController } from './IKInspectorController.js';
import { KeyframeRetimingController } from './KeyframeRetimingController.js';
import { MirrorToolsController } from './MirrorToolsController.js';
import { NewAnimationController } from './NewAnimationController.js';
import { OnionSkinControlsController } from './OnionSkinControlsController.js';
import { RigTweakController } from './RigTweakController.js';
import { TimelineController } from './TimelineController.js';
import './style.css';

const host = document.querySelector<HTMLElement>('#animation-editor-app, #editor-app');
if (!host) throw new Error('Missing character workspace host.');
host.id = 'character-workspace';
const initialRigView = workspaceView(new URL(window.location.href)) === 'rig';
let movePreview: (() => void) | undefined;
let scene: AnimationEditorScene | undefined;
const ikInspector = new IKInspectorController();
const packages = new PackageController();
const artwork = new ArtworkController();
const attachments = new AttachmentController(artwork);
const rigTweak = new RigTweakController(attachments);
const newAnimation = new NewAnimationController();
const retiming = new KeyframeRetimingController();
const mirrorTools = new MirrorToolsController((pose) => scene?.setMirrorPreview(pose));
const ikBake = new IKBakeController(
  (pose) => scene?.setBakePreview(pose),
  () => scene?.getBakeRuntimeConstraints() ?? [],
);
function CharacterWorkspace() {
  const snapshot = useSyncExternalStore(rigTweak.subscribe, rigTweak.getSnapshot);
  const rigView = snapshot.ready ? snapshot.mode === 'rig' : initialRigView;
  useLayoutEffect(() => movePreview?.(), [rigView]);
  return (
    <>
      <div id="editor-app" className="view-shell workspace-shell rig-workspace" hidden={!rigView} inert={!rigView}>
        <RigEditorView header={rigView} {...(rigView ? { packages, artwork, attachments } : {})} />
      </div>
      <div
        id="animation-editor-app"
        className="view-shell workspace-shell animation-workspace"
        hidden={rigView}
        inert={rigView}
      >
        <AnimationEditorView
          mirrorTools={mirrorTools}
          newAnimation={newAnimation}
          ikInspector={ikInspector}
          ikBake={ikBake}
          retiming={retiming}
          rigTweak={rigTweak}
          header={!rigView}
          {...(!rigView ? { packages, artwork, attachments } : {})}
        />
      </div>
    </>
  );
}
const unmount = mountView(host, <CharacterWorkspace />, (root) => {
  const app = root.querySelector<HTMLElement>('#animation-editor-app')!;
  const rigApp = root.querySelector<HTMLElement>('#editor-app')!;
  let stateOwner: AnimationEditorState | undefined;
  let focusViewOnMove = false;
  const rigWorkspace = createRigWorkspaceController(
    rigApp,
    () => editorScene,
    () => packages.refresh(),
  );
  const releaseCharacterSelection = bindCharacterSelection(app);
  const timeline = new TimelineController(app);
  const inspector = new BoneInspectorController(app);
  const releaseNavigationGuard = protectUnsavedChanges(
    () =>
      timeline.hasUnsavedChanges ||
      !!stateOwner?.hasPendingAnimationEdits ||
      rigTweak.hasUnsavedChanges ||
      artwork.hasPendingChanges,
  );
  const recoveryControls = new DraftRecoveryControls<ReadonlyAnimation | null>(
    app.querySelector<HTMLElement>('#animation-draft-status')!,
    app.querySelector<HTMLButtonElement>('#animation-download-retained-drafts')!,
  );
  const recovery = new AnimationDraftRecoveryController(recoveryControls.recovery, window.location.pathname);
  const releaseArtworkPackage = artwork.subscribe(packages.refresh);
  let releaseAnimationPackage: (() => void) | undefined;
  let releaseWorkspaceSelection: (() => void) | undefined;
  const editorScene = new AnimationEditorScene(
    (state, id) => {
      stateOwner = state;
      newAnimation.bind(state);
      rigTweak.bind(state, editorScene.rigEditor!);
      rigWorkspace.render(editorScene.rigEditor!);
      editorScene.fitPreview();
      mirrorTools.bind(state, JSON.stringify([window.location.pathname, id]));
      ikBake.bind(state);
      retiming.bind(state);
      timeline.bind(state, id);
      inspector.bind(state);
      ikInspector.bind(state);
      releaseWorkspaceSelection?.();
      let selectedIK = state.selectedIKConstraintId;
      let selectedBone = state.selectedBoneId;
      let selectedEvent = state.selectedEvent;
      let selectedKeys = state.selectedKeys;
      let authoringMode = state.editorMode;
      releaseWorkspaceSelection = state.subscribe(() => {
        if (state.editorMode !== authoringMode) {
          authoringMode = state.editorMode;
          mirrorTools.hidePreview();
          ikBake.hidePreview();
          for (const panel of app.querySelectorAll<HTMLDetailsElement>('[data-tool-panel]')) panel.open = false;
        }
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
      packages.bind(() => editorScene.packageSnapshot());
      releaseAnimationPackage?.();
      releaseAnimationPackage = state.subscribe(packages.refresh);
      if (initialRigView) state.setEditorMode('rig');
      movePreview?.();
    },
    (message) => {
      stateOwner = undefined;
      newAnimation.unbind();
      rigWorkspace.showError(message);
      packages.unbind();
      releaseAnimationPackage?.();
      releaseAnimationPackage = undefined;
      rigTweak.unbind();
      releaseWorkspaceSelection?.();
      releaseWorkspaceSelection = undefined;
      recovery.unbind();
      mirrorTools.unbind();
      ikBake.unbind();
      retiming.unbind();
      ikInspector.unbind();
      inspector.unbind();
      timeline.showError(message);
    },
    {
      characterUrl: `../characters/${selectedCharacterId()}/character.json`,
      ikChains: getCharacterPreviewSettings(selectedCharacterId()).ikChains,
    },
    artwork,
    () => {
      rigTweak.refresh();
      if (editorScene.rigEditor) rigWorkspace.render(editorScene.rigEditor);
      packages.refresh();
    },
  );
  rigTweak.initialize(app, () => editorScene);
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
  const game = createEditorGame(initialRigView ? 'editor-stage' : 'animation-stage', editorScene);
  movePreview = () => {
    const rigView = stateOwner ? stateOwner.editorMode === 'rig' : initialRigView;
    const target = root.querySelector<HTMLElement>(rigView ? '#editor-stage' : '#animation-stage')!;
    if (game.canvas && game.canvas.parentElement !== target) target.append(game.canvas);
    game.scale.parent = target;
    const facingControl = app.querySelector<HTMLSelectElement>('#animation-facing');
    if (facingControl && editorScene.rigEditor) facingControl.value = editorScene.rigEditor.state.facing;
    game.scale.getParentBounds();
    game.scale.refresh();
    const characterStatus = app.querySelector<HTMLElement>('#character-status');
    if (characterStatus) characterStatus.textContent = `Character: ${editorScene.characterId}`;
    document.title = `${rigView ? 'Rig Editor' : 'Animation Editor'} · Paper Puppeteer Engine`;
    const shell = target.closest<HTMLElement>('.workspace-shell');
    if (focusViewOnMove && shell && !shell.hidden) {
      shell.querySelector<HTMLHeadingElement>('h1')?.focus();
      focusViewOnMove = false;
    }
  };
  const releaseRigResize = observePreview(rigApp.querySelector<HTMLElement>('#editor-stage')!, game);
  const releaseRoutes = bindWorkspaceNavigation(root, (view) => {
    if (!stateOwner) return false;
    for (const dialog of root.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
    packages.closePreview();
    if (!rigTweak.setMode(view === 'rig' ? 'rig' : 'animation')) return 'cancel';
    focusViewOnMove = true;
    movePreview?.();
    return true;
  });
  const workspace = new AnimationWorkspaceController(app, () => {
    game.scale.getParentBounds();
    game.scale.refresh();
  });

  return () => {
    releaseRoutes();
    releaseRigResize();
    rigWorkspace.dispose();
    stateOwner = undefined;
    movePreview = undefined;
    releaseArtworkPackage();
    releaseAnimationPackage?.();
    packages.dispose();
    recovery.dispose();
    rigTweak.dispose();
    releaseWorkspaceSelection?.();
    mirrorTools.dispose();
    ikBake.dispose();
    retiming.dispose();
    newAnimation.dispose();
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
    attachments.dispose();
    artwork.dispose();
    scene = undefined;
  };
});
if (import.meta.hot) import.meta.hot.dispose(unmount);
