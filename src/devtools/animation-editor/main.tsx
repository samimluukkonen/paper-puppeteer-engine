import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { canonicalJson } from '../../engine/authoredSerialization.js';
import { getCharacterPreviewSettings } from '../../shared/characterPreviewSettings.js';
import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { FeatureGuide } from '../../ui/FeatureGuide.js';
import { mountView } from '../../ui/mountView.js';
import { observePreview } from '../../ui/observePreview.js';
import { projectEditorContext } from '../project/projectBridge.js';
import { AttachmentController } from '../rig-editor/AttachmentController.js';
import { RigEditorView } from '../rig-editor/editorMarkup.js';
import { createRigWorkspaceController } from '../rig-editor/RigWorkspaceController.js';
import '../rig-editor/style.css';
import { RigWorkspaceLayoutController } from '../rig-editor/RigWorkspaceLayoutController.js';
import { ArtworkController } from '../shared/artwork/ArtworkController.js';
import { buildCharacterDraft } from '../shared/autosave/editorDrafts.js';
import { LocalAutosave } from '../shared/autosave/LocalAutosave.js';
import { LocalDraftControls, localDrafts } from '../shared/autosave/RecoveryPanel.js';
import { DraftRecoveryControls } from '../shared/DraftRecoveryControls.js';
import { createEditorGame } from '../shared/editorGame.js';
import { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import { GuideLauncher } from '../shared/guides/GuideLauncher.js';
import { GuideTargets } from '../shared/guides/GuideTargets.js';
import { workspaceGuideHost } from '../shared/guides/workspaceGuideHost.js';
import { browserCharacterDrafts } from '../shared/newCharacter.js';
import { PackageController } from '../shared/package/PackageController.js';
import { PackageFingerprints } from '../shared/package/PackageFingerprints.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { bindWorkspaceNavigation, workspaceView } from '../shared/WorkspaceNavigation.js';
import { AnimationDraftRecoveryController } from './AnimationDraftRecoveryController.js';
import { AnimationEditorScene } from './AnimationEditorScene.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import { AnimationWorkspaceController } from './AnimationWorkspaceController.js';
import { BoneInspectorController } from './BoneInspectorController.js';
import { AnimationEditorView } from './editorMarkup.js';
import { FootContactGroundController } from './FootContactGroundController.js';
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
const projectContext = projectEditorContext();
const initialDraft = (() => {
  if (projectContext) return undefined;
  try {
    return browserCharacterDrafts().get(selectedCharacterId());
  } catch {
    return undefined;
  } // Loading fails visibly; the creation dialog stays available.
})();
const initialRigView = workspaceView(new URL(window.location.href)) === 'rig';
const guideTargets = new GuideTargets(host);
let movePreview: (() => void) | undefined;
let scene: AnimationEditorScene | undefined;
let stateOwner: AnimationEditorState | undefined;
let workspaceRoutes: ReturnType<typeof bindWorkspaceNavigation> | undefined;
const guides = new GuideLauncher(
  workspaceGuideHost({
    initialEditor: initialRigView ? 'rig' : 'animation',
    getAnimation: () => stateOwner,
    getRig: () => scene?.rigEditor?.state,
    getOnionEnabled: () => scene?.getOnionSkinSettings().enabled ?? false,
    navigate: (editor) => editor !== 'scene' && (workspaceRoutes?.navigate(editor) ?? false),
  }),
);
const ikInspector = new IKInspectorController();
const groundGuide = new GroundGuideWorkspace('animation-preview-world');
const footContacts = new FootContactGroundController();
const packages = new PackageController(undefined, projectContext?.fetcher);
const artwork = new ArtworkController(
  undefined,
  projectContext ? (key) => projectContext.confirmReplacement('texture', key) : undefined,
);
const attachments = new AttachmentController(artwork);
const rigTweak = new RigTweakController(attachments);
const newAnimation = new NewAnimationController();
const retiming = new KeyframeRetimingController();
const mirrorTools = new MirrorToolsController((pose) => scene?.setMirrorPreview(pose));
const ikBake = new IKBakeController(
  (pose) => scene?.setBakePreview(pose),
  () => scene?.getBakeRuntimeConstraints() ?? [],
);
let showAutosave: ((autosave: LocalAutosave | undefined) => void) | undefined;
function CharacterWorkspace() {
  const [autosave, setAutosave] = useState<LocalAutosave>();
  useLayoutEffect(() => {
    showAutosave = setAutosave;
    return () => {
      showAutosave = undefined;
    };
  }, []);
  const snapshot = useSyncExternalStore(rigTweak.subscribe, rigTweak.getSnapshot);
  const packageState = useSyncExternalStore(packages.subscribe, packages.getSnapshot);
  const rigView = snapshot.ready ? snapshot.mode === 'rig' : initialRigView;
  useLayoutEffect(() => movePreview?.(), [rigView]);
  return (
    <FeatureGuide launcher={guides} targets={guideTargets}>
      {!projectContext && <LocalDraftControls {...(autosave ? { autosave } : {})} />}
      {initialDraft && (
        <p className="workspace-caption" role="status" aria-label="Character draft">
          {initialDraft.identity.name} · {initialDraft.identity.id} ·{' '}
          {packageState.unsavedCharacter || !packageState.ready ? 'New / Unsaved' : 'Package downloaded'}. Start by
          selecting the root bone or importing artwork. Download a character ZIP to keep the complete character.
        </p>
      )}
      <div id="editor-app" className="view-shell workspace-shell rig-workspace" hidden={!rigView} inert={!rigView}>
        <RigEditorView header={rigView} {...(rigView ? { packages, artwork, attachments, groundGuide } : {})} />
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
          groundGuide={groundGuide}
          footContacts={footContacts}
          alignGroundTarget={() => {
            scene?.alignSelectedIKTargetToGround();
          }}
          ikBake={ikBake}
          retiming={retiming}
          rigTweak={rigTweak}
          header={!rigView}
          {...(!rigView ? { packages, artwork, attachments } : {})}
        />
      </div>
    </FeatureGuide>
  );
}
const unmount = mountView(host, <CharacterWorkspace />, (root) => {
  let autosave: LocalAutosave | undefined;
  const app = root.querySelector<HTMLElement>('#animation-editor-app')!;
  const rigApp = root.querySelector<HTMLElement>('#editor-app')!;
  let focusViewOnMove = false;
  const rigWorkspace = createRigWorkspaceController(
    rigApp,
    () => editorScene,
    () => {
      // Inspector edits suppress scene notifications to preserve focused input text.
      // Still notify the shared rig recovery owner used by both editor views.
      rigTweak.refresh();
      packages.refresh();
      projectContext?.changed();
      autosave?.update();
      guides.refresh();
    },
  );
  const releaseCharacterSelection = bindCharacterSelection(app);
  const timeline = new TimelineController(app);
  const inspector = new BoneInspectorController(app);
  const releaseNavigationGuard = protectUnsavedChanges(
    () =>
      (!!initialDraft && (!packages.getSnapshot().ready || packages.hasUnsavedCharacter)) ||
      timeline.hasUnsavedChanges ||
      !!stateOwner?.hasPendingAnimationEdits ||
      rigTweak.hasUnsavedChanges ||
      artwork.hasPendingChanges,
  );
  const recoveryControls = new DraftRecoveryControls<ReadonlyAnimation | null>(
    app.querySelector<HTMLElement>('#animation-draft-status')!,
    app.querySelector<HTMLButtonElement>('#animation-download-retained-drafts')!,
    app.querySelector<HTMLButtonElement>('#animation-clear-retained-drafts')!,
  );
  const recovery = new AnimationDraftRecoveryController(recoveryControls.recovery, window.location.pathname);
  const releaseArtworkPackage = artwork.subscribe(() => {
    packages.refresh();
    projectContext?.changed();
    autosave?.update();
  });
  let releaseAnimationPackage: (() => void) | undefined;
  let releaseWorkspaceSelection: (() => void) | undefined;
  let releaseProject: (() => void) | undefined;
  let pollAutosave: ReturnType<typeof setInterval> | undefined;
  const flushLocal = (): void => {
    void autosave?.flush();
  };
  const leaveLocal = (): void => autosave?.suspend();
  const resumeLocal = (): void => autosave?.start();
  const hiddenLocal = (): void => {
    if (document.visibilityState === 'hidden') flushLocal();
  };
  window.addEventListener('pagehide', leaveLocal);
  window.addEventListener('pageshow', resumeLocal);
  document.addEventListener('visibilitychange', hiddenLocal);
  const editorScene = new AnimationEditorScene(
    (state, id) => {
      stateOwner = state;
      state.setReplacementGuard(
        projectContext ? (name) => projectContext.confirmReplacement('animation', name) : undefined,
      );
      editorScene.rigEditor!.state.skinReferences = projectContext
        ? (name) => projectContext.assetReferences('skin', name)
        : undefined;
      autosave?.dispose();
      clearInterval(pollAutosave);
      releaseProject?.();
      releaseProject = projectContext?.bindCharacter(
        () => editorScene.packageSnapshot(),
        () =>
          editorScene.hasPendingArtworkProposal ||
          artwork.getSnapshot().importing ||
          !!editorScene.rigEditor?.state.validationPending ||
          state.hasPendingAnimationEdits,
        (view) => {
          workspaceRoutes?.navigate(view);
        },
      );
      guides.refresh();
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
        guides.refresh();
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
      if (!projectContext) recovery.bind(state, id);
      else
        app.querySelector<HTMLElement>('#animation-draft-status')!.textContent =
          'Project session: export a project ZIP to keep your work.';
      packages.bind(() => {
        const snapshot = editorScene.packageSnapshot();
        return projectContext?.sourceDefinition
          ? { ...snapshot, definition: projectContext.sourceDefinition }
          : snapshot;
      }, !!initialDraft);
      if (!projectContext) {
        const fingerprints = new PackageFingerprints();
        const key = `character:${new URL('../', location.href).pathname}:${id}`;
        const projectId = crypto.randomUUID();
        autosave = new LocalAutosave(key, localDrafts, () => {
          if (
            editorScene.hasPendingArtworkProposal ||
            artwork.getSnapshot().importing ||
            editorScene.rigEditor?.state.validationPending ||
            state.hasPendingAnimationEdits
          )
            return undefined;
          const snapshot = editorScene.packageSnapshot();
          return {
            name: snapshot.rig.name ?? id,
            revision: canonicalJson(fingerprints.compute(snapshot)),
            dirty: packages.hasUnsavedChanges,
            build: () => buildCharacterDraft(editorScene.packageSnapshot(), projectId),
          };
        });
        autosave.start();
        pollAutosave = setInterval(() => autosave?.update(), 500);
        showAutosave?.(autosave);
      }
      releaseAnimationPackage?.();
      releaseAnimationPackage = state.subscribe(() => {
        packages.refresh();
        projectContext?.changed();
        autosave?.update();
      });
      if (initialRigView) state.setEditorMode('rig');
      guides.refresh();
      movePreview?.();
    },
    (message) => {
      stateOwner = undefined;
      guides.refresh();
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
      characterUrl: `../characters/${encodeURIComponent(selectedCharacterId())}/character.json`,
      ...(projectContext?.definition
        ? { definition: projectContext.definition }
        : initialDraft
          ? { definition: initialDraft.definition }
          : {}),
      ikChains: getCharacterPreviewSettings(selectedCharacterId()).ikChains,
      groundGuide,
      footContacts,
    },
    artwork,
    () => {
      rigTweak.refresh();
      if (editorScene.rigEditor) rigWorkspace.render(editorScene.rigEditor);
      packages.refresh();
      projectContext?.changed();
      autosave?.update();
      guides.refresh();
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
  const onionControls = new OnionSkinControlsController(app, editorScene, guides.refresh);
  app.querySelector<HTMLInputElement>('#animation-ik-preview')!.addEventListener(
    'change',
    (event) => {
      editorScene.setIKPreview((event.target as HTMLInputElement).checked);
      ikBake.refreshRuntime();
    },
    { signal: previewControls.signal },
  );
  const game = createEditorGame(initialRigView ? 'editor-stage' : 'animation-stage', editorScene, {
    width: 630,
    height: 891,
  });
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
  const rigLayout = new RigWorkspaceLayoutController(rigApp);
  workspaceRoutes = bindWorkspaceNavigation(root, (view) => {
    if (!stateOwner) return view === (initialRigView ? 'rig' : 'animation');
    if (!rigTweak.setMode(view === 'rig' ? 'rig' : 'animation')) return 'cancel';
    for (const dialog of root.querySelectorAll<HTMLDialogElement>('dialog[open]:not(.feature-guide-dialog)'))
      dialog.close();
    packages.closePreview();
    focusViewOnMove = true;
    movePreview?.();
    return true;
  });
  const workspace = new AnimationWorkspaceController(app, () => {
    game.scale.getParentBounds();
    game.scale.refresh();
  });

  return () => {
    autosave?.dispose();
    clearInterval(pollAutosave);
    window.removeEventListener('pagehide', leaveLocal);
    window.removeEventListener('pageshow', resumeLocal);
    document.removeEventListener('visibilitychange', hiddenLocal);
    workspaceRoutes?.dispose();
    releaseProject?.();
    workspaceRoutes = undefined;
    releaseRigResize();
    rigLayout.dispose();
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
