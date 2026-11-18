import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { canonicalJson } from '../../engine/core.js';
import { getCharacterPreviewSettings } from '../../shared/characterPreviewSettings.js';
import { bindExportShortcut, blocksEditorShortcut } from '../../shared/keyboardShortcuts.js';
import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { EditorContext } from '../../ui/EditorContext.js';
import { FeatureGuide } from '../../ui/FeatureGuide.js';
import { mountView } from '../../ui/mountView.js';
import { observePreview } from '../../ui/observePreview.js';
import { ProjectContextProvider } from '../../ui/projectContext.js';
import { buildCharacterDraft } from '../project/editorDrafts.js';
import { projectCharacterContext } from '../project/projectBridge.js';
import { AttachmentController } from '../rig-editor/AttachmentController.js';
import { RigEditorView } from '../rig-editor/editorMarkup.js';
import { RIG_IDS } from '../rig-editor/elementIds.js';
import '../rig-editor/style.css';
import { createRigWorkspaceController } from '../rig-editor/RigWorkspaceController.js';
import { RigWorkspaceLayoutController } from '../rig-editor/RigWorkspaceLayoutController.js';
import { ArtworkController } from '../shared/artwork/ArtworkController.js';
import { attachLocalAutosave, LocalAutosave } from '../shared/autosave/LocalAutosave.js';
import { LocalDraftControls, localDrafts } from '../shared/autosave/RecoveryPanel.js';
import { DraftRecoveryControls } from '../shared/DraftRecoveryControls.js';
import { optionalElement, requireElement } from '../shared/editorElements.js';
import { createEditorGame, destroyEditorGame } from '../shared/editorGame.js';
import { defaultGroundGuide } from '../shared/groundGuide.js';
import { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import { GuideLauncher } from '../shared/guides/GuideLauncher.js';
import { GuideTargets } from '../shared/guides/GuideTargets.js';
import { PackageController } from '../shared/package/PackageController.js';
import { PackageFingerprints } from '../shared/package/PackageFingerprints.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { bindWorkspaceNavigation, workspaceView } from '../shared/WorkspaceNavigation.js';
import { AnimationDraftRecoveryController } from './AnimationDraftRecoveryController.js';
import { AnimationEditorScene } from './AnimationEditorScene.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import { AnimationLibraryController } from './AnimationLibraryController.js';
import { AnimationPreviewPreferencesBinding } from './AnimationPreviewPreferences.js';
import { AnimationVariationController } from './AnimationVariationController.js';
import { AnimationWorkspaceController } from './AnimationWorkspaceController.js';
import { BoneInspectorController } from './BoneInspectorController.js';
import { browserCharacterDrafts } from './characterDocuments.js';
import { AnimationEditorView } from './editorMarkup.js';
import { ANIMATION_IDS, RIG_TWEAK_SESSION_IDS } from './elementIds.js';
import { EnvironmentPreviewController } from './EnvironmentPreviewController.js';
import { FootContactGroundController } from './FootContactGroundController.js';
import { IKBakeController } from './IKBakeController.js';
import { IKInspectorController } from './IKInspectorController.js';
import { KeyframeRetimingController } from './KeyframeRetimingController.js';
import { MirrorToolsController } from './MirrorToolsController.js';
import { MotionDiagnosticsController } from './MotionDiagnosticsController.js';
import { MotionPreviewController } from './MotionPreviewController.js';
import { NewAnimationController } from './NewAnimationController.js';
import { OnionSkinControlsController } from './OnionSkinControlsController.js';
import { PoseLibraryController } from './PoseLibraryController.js';
import { RigTweakController } from './RigTweakController.js';
import { TimelineController } from './TimelineController.js';
import { workspaceGuideHost } from './workspaceGuideHost.js';
import './style.css';

// Each editor page provides one of the two hosts; the workspace then renders both views inside it.
const host =
  optionalElement(document, ANIMATION_IDS.app, HTMLElement) ?? optionalElement(document, RIG_IDS.app, HTMLElement);
if (!host) throw new Error('Missing character workspace host.');
host.id = 'character-workspace';
const projectContext = projectCharacterContext();
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
    canCreateCharacter: !projectContext,
    getAnimation: () => stateOwner,
    getRig: () => scene?.rigEditor?.state,
    getOnionEnabled: () => scene?.getOnionSkinSettings().enabled ?? false,
    navigate: (editor) => (editor === 'rig' || editor === 'animation') && (workspaceRoutes?.navigate(editor) ?? false),
  }),
);
const ikInspector = new IKInspectorController();
const groundGuide = new GroundGuideWorkspace('animation-preview-world');
const footContacts = new FootContactGroundController();
const environment = new EnvironmentPreviewController(projectContext?.imageAssets);
const motionPreview = new MotionPreviewController();
const packages = new PackageController(undefined, projectContext?.fetcher);
const artwork =
  projectContext?.characterDocuments.artwork ??
  new ArtworkController(
    undefined,
    projectContext ? (key) => projectContext.confirmReplacement('texture', key) : undefined,
  );
const attachments = new AttachmentController(artwork);
const rigTweak = new RigTweakController(attachments, { projectHosted: !!projectContext });
const newAnimation = new NewAnimationController();
const variations = new AnimationVariationController();
const animationLibrary = new AnimationLibraryController();
let releaseLibrarySelection: (() => void) | undefined;
let releaseAnimationCreation: (() => void) | undefined;
const retiming = new KeyframeRetimingController();
const motionDiagnostics = new MotionDiagnosticsController();
const mirrorTools = new MirrorToolsController((pose) => scene?.setMirrorPreview(pose));
const poseLibrary = new PoseLibraryController();
const ikBake = new IKBakeController(
  (pose) => scene?.setBakePreview(pose),
  () => scene?.getBakeRuntimeConstraints() ?? [],
);
let showAutosave: ((autosave: LocalAutosave | undefined) => void) | undefined;
const noProjectSubscription = () => () => {};
function CharacterWorkspace() {
  const [autosave, setAutosave] = useState<LocalAutosave>();
  useLayoutEffect(() => {
    showAutosave = setAutosave;
    return () => {
      showAutosave = undefined;
    };
  }, []);
  const snapshot = useSyncExternalStore(rigTweak.subscribe, rigTweak.getSnapshot);
  const projectName = useSyncExternalStore(
    projectContext?.subscribe ?? noProjectSubscription,
    () => projectContext?.projectName,
  );
  const packageState = useSyncExternalStore(packages.subscribe, packages.getSnapshot);
  const rigCommandMessage = useSyncExternalStore(attachments.subscribe, () => attachments.getSnapshot().message);
  // Subscribe to facts only: playback ticks must not rerender the workspace shell.
  useSyncExternalStore(
    (listener) => stateOwner?.subscribe(listener) ?? (() => {}),
    () => JSON.stringify([stateOwner?.selectedAnimationId, stateOwner?.dirty, stateOwner?.hasPendingAnimationEdits]),
  );
  const rigView = snapshot.ready ? snapshot.mode === 'rig' : initialRigView;
  const draftControls = !projectContext ? <LocalDraftControls {...(autosave ? { autosave } : {})} /> : undefined;
  useLayoutEffect(() => movePreview?.(), [rigView]);
  return (
    <FeatureGuide launcher={guides} targets={guideTargets}>
      {snapshot.ready && (
        <EditorContext
          {...(projectName ? { project: projectName } : {})}
          editor={rigView ? 'Rig' : snapshot.mode === 'rig-tweak' ? 'Animation / Rig Tweak' : 'Animation'}
          document={`Character: ${projectContext?.assetName ?? scene?.characterId ?? selectedCharacterId()} · Rig: ${scene?.rigFilename ?? 'none'} · Animation: ${stateOwner?.selectedAnimationId ?? 'none'}`}
          modified={[
            ...(snapshot.rigDirty ? ['Rig'] : []),
            ...(stateOwner?.dirty ? ['Animation'] : []),
            ...(stateOwner?.hasPendingAnimationEdits ? ['Uncommitted preview'] : []),
          ]}
        >
          <span>
            Character package:{' '}
            {packageState.unsavedCharacter || packageState.modified.length
              ? `Export needed${packageState.modified.length ? ` (${packageState.modified.join(', ')})` : ''}`
              : 'Matches loaded / exported checkpoint'}
          </span>
        </EditorContext>
      )}
      {rigCommandMessage && (
        <p className="workspace-caption" aria-live="polite" aria-label="Rig command feedback">
          {rigCommandMessage}
        </p>
      )}
      {snapshot.ready &&
        !scene?.rigEditor?.state.workingCopy.bones.some((bone) => bone.sprite) &&
        !scene?.rigEditor?.state.workingCopy.attachments?.length && (
          <p className="workspace-caption">
            No artwork assigned. Use Artwork to import PNG files, then assign artwork to a bone or slot.
          </p>
        )}
      {initialDraft && (
        <p className="workspace-caption" role="status" aria-label="Character draft">
          {initialDraft.identity.name} · {initialDraft.identity.id} ·{' '}
          {packageState.unsavedCharacter || !packageState.ready ? 'New / Unsaved' : 'Package downloaded'}. Start by
          selecting the root bone or importing artwork. Download a character ZIP to keep the complete character.
        </p>
      )}
      <div id={RIG_IDS.app} className="view-shell workspace-shell rig-workspace" hidden={!rigView} inert={!rigView}>
        <RigEditorView
          header={rigView}
          afterHeader={rigView ? draftControls : undefined}
          {...(rigView ? { packages, artwork, attachments, groundGuide } : {})}
        />
      </div>
      <div
        id={ANIMATION_IDS.app}
        className="view-shell workspace-shell animation-workspace"
        hidden={rigView}
        inert={rigView}
      >
        <AnimationEditorView
          mirrorTools={mirrorTools}
          poseLibrary={poseLibrary}
          newAnimation={newAnimation}
          variations={variations}
          animationLibrary={animationLibrary}
          ikInspector={ikInspector}
          groundGuide={groundGuide}
          footContacts={footContacts}
          environment={environment}
          motionPreview={motionPreview}
          projectEnvironment={!!projectContext}
          loadProjectImages={projectContext?.loadProjectImages}
          alignGroundTarget={() => {
            scene?.alignSelectedIKTargetToGround();
          }}
          ikBake={ikBake}
          retiming={retiming}
          motionDiagnostics={motionDiagnostics}
          rigTweak={rigTweak}
          header={!rigView}
          afterHeader={!rigView ? draftControls : undefined}
          {...(!rigView ? { packages, artwork, attachments } : {})}
        />
      </div>
    </FeatureGuide>
  );
}
const unmount = mountView(
  host,
  <ProjectContextProvider value={projectContext}>
    <CharacterWorkspace />
  </ProjectContextProvider>,
  (root) => {
    let autosave: LocalAutosave | undefined;
    let previewPreferences: AnimationPreviewPreferencesBinding | undefined;
    const app = requireElement(root, ANIMATION_IDS.app, HTMLElement);
    const rigApp = requireElement(root, RIG_IDS.app, HTMLElement);
    const releaseRigExport = bindExportShortcut(rigApp, () =>
      requireElement(rigApp, RIG_IDS.toolsOpen, HTMLButtonElement).click(),
    );
    const releaseAnimationExport = bindExportShortcut(app, () => {
      if (stateOwner?.editorMode === 'rig-tweak') {
        app.dispatchEvent(new Event('workspace:reveal-inspector'));
        requireElement(app, RIG_TWEAK_SESSION_IDS.downloadJson, HTMLButtonElement).focus();
      } else requireElement(app, ANIMATION_IDS.toolsOpen, HTMLButtonElement).click();
    });
    const deleteRigSelection = (event: KeyboardEvent): void => {
      if (
        blocksEditorShortcut(event) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.key !== 'Delete' && event.key !== 'Backspace') ||
        stateOwner?.editorMode === 'animation'
      )
        return;
      const editor = scene?.rigEditor;
      if (
        !editor ||
        editor.previewName ||
        editor.state.selectedIKConstraintId ||
        editor.state.selectedFootContactMarkerId
      )
        return;
      const selection = editor.state.selection;
      if (!selection) return;
      event.preventDefault();
      if (event.repeat) return;
      if (selection.type === 'bone') attachments.removeBone();
      else attachments.removeSlot();
    };
    window.addEventListener('keydown', deleteRigSelection);
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
    const timeline = new TimelineController(app, guideTargets);
    const inspector = new BoneInspectorController(app);
    const releaseNavigationGuard = protectUnsavedChanges(
      () =>
        (!!initialDraft && (!packages.getSnapshot().ready || packages.hasUnsavedCharacter)) ||
        timeline.hasUnsavedChanges ||
        packages.getSnapshot().modified.includes('Poses') ||
        !!stateOwner?.hasPendingAnimationEdits ||
        rigTweak.hasUnsavedChanges ||
        artwork.hasPendingChanges,
      { hostGuarded: !!projectContext },
    );
    const recoveryControls = new DraftRecoveryControls<ReadonlyAnimation | null>(
      requireElement(app, ANIMATION_IDS.draftStatus, HTMLElement),
      requireElement(app, ANIMATION_IDS.downloadRetainedDrafts, HTMLButtonElement),
      requireElement(app, ANIMATION_IDS.clearRetainedDrafts, HTMLButtonElement),
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
    let detachAutosave: (() => void) | undefined;
    const editorScene = new AnimationEditorScene(
      (state, id) => {
        stateOwner = state;
        state.setReplacementGuard(
          projectContext ? (name) => projectContext.confirmReplacement('animation', name) : undefined,
        );
        if (!projectContext) editorScene.rigEditor!.state.skinReferences = undefined;
        detachAutosave?.();
        detachAutosave = undefined;
        releaseProject?.();
        releaseProject = projectContext?.bindCharacter(
          () =>
            editorScene.hasPendingArtworkProposal ||
            artwork.getSnapshot().importing ||
            !!editorScene.rigEditor?.state.validationPending ||
            state.hasPendingAnimationEdits,
          (view) => {
            workspaceRoutes?.navigate(view);
          },
        );
        previewPreferences?.dispose();
        if (projectContext) {
          groundGuide.bind(`project:${projectContext.projectId}:character:${id}`);
          groundGuide.restore(defaultGroundGuide('animation-preview-world'));
        }
        previewPreferences = new AnimationPreviewPreferencesBinding(
          environment,
          motionPreview,
          groundGuide,
          projectContext?.animationPreviewPreferences,
          (preferences) => {
            projectContext?.saveAnimationPreviewPreferences(preferences);
            autosave?.update();
          },
        );
        guides.refresh();
        newAnimation.bind(state);
        variations.bind(state);
        animationLibrary.bind(state, id);
        releaseLibrarySelection?.();
        releaseLibrarySelection = projectContext?.bindAnimationSelection((name, copy) => {
          if (copy) animationLibrary.copy(name);
          else animationLibrary.select(name);
        });
        releaseAnimationCreation?.();
        releaseAnimationCreation = projectContext?.bindAnimationCreation((clip) => state.createDerivedAnimation(clip));
        rigTweak.bind(state, editorScene.rigEditor!);
        rigWorkspace.render(editorScene.rigEditor!);
        editorScene.fitPreview();
        mirrorTools.bind(state, JSON.stringify([window.location.pathname, id]));
        poseLibrary.bind(state);
        ikBake.bind(state);
        retiming.bind(state);
        motionDiagnostics.bind(state);
        timeline.bind(state, id);
        inspector.bind(state);
        ikInspector.bind(state);
        releaseWorkspaceSelection?.();
        let selectedIK = state.ik.selectedIKConstraintId;
        let selectedBone = state.selectedBoneId;
        let selectedEvent = state.selectedEvent;
        let selectedRoot = state.rootMotion.rootMotionSelected;
        let selectedRootKey = state.rootMotion.selectedRootKey;
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
            (state.ik.selectedIKConstraintId && state.ik.selectedIKConstraintId !== selectedIK) ||
            (state.selectedBoneId && state.selectedBoneId !== selectedBone) ||
            (state.selectedEvent && state.selectedEvent !== selectedEvent) ||
            (state.selectedKeys.length && state.selectedKeys !== selectedKeys) ||
            (state.rootMotion.rootMotionSelected &&
              (!selectedRoot || state.rootMotion.selectedRootKey !== selectedRootKey))
          )
            workspace.revealInspector();
          if (!app.hidden && state.editorMode !== 'rig-tweak') {
            const id =
              state.rootMotion.rootMotionSelected &&
              (!selectedRoot || state.rootMotion.selectedRootKey !== selectedRootKey)
                ? 'animation-inspector-root'
                : state.selectedEvent && state.selectedEvent !== selectedEvent
                  ? 'animation-inspector-selection'
                  : state.ik.selectedIKConstraintId && state.ik.selectedIKConstraintId !== selectedIK
                    ? 'animation-inspector-ik'
                    : state.selectedBoneId &&
                        state.selectedBoneId !== selectedBone &&
                        !requireElement(app, ANIMATION_IDS.bones, HTMLElement).matches(':focus-within')
                      ? 'animation-inspector-selection'
                      : undefined;
            if (id)
              app
                .querySelector(`[data-editor-tab-panel="${id}"]`)
                ?.dispatchEvent(new CustomEvent('workspace:reveal-tab', { bubbles: true, detail: id }));
          }
          selectedIK = state.ik.selectedIKConstraintId;
          selectedBone = state.selectedBoneId;
          selectedEvent = state.selectedEvent;
          selectedRoot = state.rootMotion.rootMotionSelected;
          selectedRootKey = state.rootMotion.selectedRootKey;
          selectedKeys = state.selectedKeys;
        });
        if (!projectContext) recovery.bind(state, id);
        else
          requireElement(app, ANIMATION_IDS.draftStatus, HTMLElement).textContent =
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
              revision: canonicalJson({
                character: fingerprints.compute(snapshot),
                preview: previewPreferences?.preferences,
                images: environment.images.getSnapshot(),
              }),
              dirty: packages.hasUnsavedChanges || !!previewPreferences?.dirty,
              build: (signal) =>
                buildCharacterDraft(
                  editorScene.packageSnapshot(),
                  projectId,
                  signal,
                  previewPreferences
                    ? { preferences: previewPreferences.preferences, images: environment.images }
                    : undefined,
                ),
            };
          });
          detachAutosave = attachLocalAutosave(autosave);
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
        previewPreferences?.dispose();
        previewPreferences = undefined;
        projectContext?.characterLoadFailed();
        stateOwner = undefined;
        guides.refresh();
        newAnimation.unbind();
        variations.unbind();
        releaseLibrarySelection?.();
        releaseLibrarySelection = undefined;
        releaseAnimationCreation?.();
        releaseAnimationCreation = undefined;
        animationLibrary.unbind();
        rigWorkspace.showError(message);
        packages.unbind();
        releaseAnimationPackage?.();
        releaseAnimationPackage = undefined;
        rigTweak.unbind();
        releaseWorkspaceSelection?.();
        releaseWorkspaceSelection = undefined;
        recovery.unbind();
        mirrorTools.unbind();
        poseLibrary.unbind();
        ikBake.unbind();
        retiming.unbind();
        motionDiagnostics.unbind();
        ikInspector.unbind();
        inspector.unbind();
        timeline.showError(message);
      },
      {
        characterUrl: `../characters/${encodeURIComponent(selectedCharacterId())}/character.json`,
        ...(projectContext
          ? { definition: projectContext.definition }
          : initialDraft
            ? { definition: initialDraft.definition }
            : {}),
        ...(projectContext ? { documents: projectContext.characterDocuments } : {}),
        ikChains: getCharacterPreviewSettings(selectedCharacterId()).ikChains,
        groundGuide,
        environment,
        motionPreview,
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
    requireElement(app, ANIMATION_IDS.facing, HTMLSelectElement).addEventListener(
      'change',
      (event) => {
        const facing = (event.target as HTMLSelectElement).value;
        if (facing === 'left' || facing === 'right') editorScene.setFacing(facing);
      },
      { signal: previewControls.signal },
    );
    requireElement(app, ANIMATION_IDS.showBones, HTMLInputElement).addEventListener(
      'change',
      (event) => {
        editorScene.setBonesVisible((event.target as HTMLInputElement).checked);
      },
      { signal: previewControls.signal },
    );
    for (const [id, apply] of [
      [ANIMATION_IDS.ikHandles, (value: boolean) => editorScene.setIKHandlesVisible(value)],
      [ANIMATION_IDS.ikDrag, (value: boolean) => editorScene.setIKHandlesInteractive(value)],
    ] as const) {
      requireElement(app, id, HTMLInputElement).addEventListener(
        'change',
        (event) => {
          apply((event.target as HTMLInputElement).checked);
        },
        { signal: previewControls.signal },
      );
    }
    const onionControls = new OnionSkinControlsController(app, editorScene, guides.refresh);
    requireElement(app, ANIMATION_IDS.ikPreview, HTMLInputElement).addEventListener(
      'change',
      (event) => {
        editorScene.setIKPreview((event.target as HTMLInputElement).checked);
        ikBake.refreshRuntime();
      },
      { signal: previewControls.signal },
    );
    const game = createEditorGame(initialRigView ? RIG_IDS.stage : ANIMATION_IDS.stage, editorScene, {
      width: 630,
      height: 891,
    });
    let rendererActive = true;
    // Phaser may finish booting after its host was already suspended.
    game.events.once('ready', () =>
      queueMicrotask(() => {
        if (!rendererActive && game.isRunning) game.loop.stop();
      }),
    );
    const releaseRenderer = projectContext?.bindRenderer({
      activate: () => {
        rendererActive = true;
        if (game.isRunning && !game.loop.running) game.loop.start(game.loop.callback);
        game.scale.refresh();
      },
      suspend: () => {
        rendererActive = false;
        stateOwner?.playback.pause();
        packages.closePreview();
        game.loop.stop();
      },
      dispose: () => unmount(),
    });
    movePreview = () => {
      const rigView = stateOwner ? stateOwner.editorMode === 'rig' : initialRigView;
      const target = rigView
        ? requireElement(rigApp, RIG_IDS.stage, HTMLElement)
        : requireElement(app, ANIMATION_IDS.stage, HTMLElement);
      if (game.canvas && game.canvas.parentElement !== target) target.append(game.canvas);
      game.scale.parent = target;
      if (editorScene.rigEditor)
        requireElement(app, ANIMATION_IDS.facing, HTMLSelectElement).value = editorScene.rigEditor.state.facing;
      game.scale.getParentBounds();
      game.scale.refresh();
      requireElement(app, ANIMATION_IDS.characterStatus, HTMLElement).textContent =
        `Character: ${editorScene.characterId}`;
      document.title = `${rigView ? 'Rig Editor' : 'Animation Editor'} · Paper Puppeteer Engine`;
      const shell = target.closest<HTMLElement>('.workspace-shell');
      if (focusViewOnMove && shell && !shell.hidden) {
        shell.querySelector<HTMLHeadingElement>('h1')?.focus();
        focusViewOnMove = false;
      }
    };
    const releaseRigResize = observePreview(requireElement(rigApp, RIG_IDS.stage, HTMLElement), game);
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
      releaseRenderer?.();
      previewPreferences?.dispose();
      detachAutosave?.();
      detachAutosave = undefined;
      workspaceRoutes?.dispose();
      releaseRigExport();
      releaseAnimationExport();
      window.removeEventListener('keydown', deleteRigSelection);
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
      poseLibrary.dispose();
      ikBake.dispose();
      retiming.dispose();
      motionDiagnostics.dispose();
      newAnimation.dispose();
      variations.dispose();
      releaseLibrarySelection?.();
      releaseAnimationCreation?.();
      animationLibrary.dispose();
      workspace.dispose();
      recoveryControls.dispose();
      releaseNavigationGuard();
      timeline.dispose();
      inspector.dispose();
      ikInspector.dispose();
      onionControls.dispose();
      previewControls.abort();
      releaseCharacterSelection();
      editorScene.disposePreview();
      projectContext?.characterDocuments.releaseRenderer();
      game.scene.stop(editorScene);
      destroyEditorGame(game);
      environment.dispose();
      motionPreview.dispose();
      attachments.dispose();
      if (!projectContext) artwork.dispose();
      scene = undefined;
    };
  },
);
if (import.meta.hot) import.meta.hot.dispose(unmount);
