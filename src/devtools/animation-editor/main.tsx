import { inspectAnimationDefinition } from '../../engine/externalData.js';
import { getCharacterPreviewSettings } from '../../shared/characterPreviewSettings.js';
import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { mountView } from '../../ui/mountView.js';
import { DraftRecovery } from '../shared/DraftRecovery.js';
import { draftSource } from '../shared/draftSource.js';
import { createEditorGame } from '../shared/editorGame.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { AnimationEditorScene } from './AnimationEditorScene.js';
import type { ReadonlyAnimation } from './AnimationEditorState.js';
import { AnimationWorkspaceController } from './AnimationWorkspaceController.js';
import { BoneInspectorController } from './BoneInspectorController.js';
import { AnimationEditorView } from './editorMarkup.js';
import { MirrorToolsController } from './MirrorToolsController.js';
import { OnionSkinControlsController } from './OnionSkinControlsController.js';
import { TimelineController } from './TimelineController.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#animation-editor-app');
if (!app) throw new Error('Missing animation editor host.');
app.classList.add('view-shell', 'workspace-shell', 'animation-workspace');
let scene: AnimationEditorScene | undefined;
const mirrorTools = new MirrorToolsController((pose) => scene?.setMirrorPreview(pose));
const unmount = mountView(app, <AnimationEditorView mirrorTools={mirrorTools} />, (app) => {
  const releaseCharacterSelection = bindCharacterSelection(app);
  const timeline = new TimelineController(app);
  const inspector = new BoneInspectorController(app);
  const releaseNavigationGuard = protectUnsavedChanges(() => timeline.hasUnsavedChanges);
  const recoveryStatus = app.querySelector<HTMLElement>('#animation-draft-status')!;
  const recovery = new DraftRecovery<ReadonlyAnimation | null>((message) => {
    recoveryStatus.textContent = message;
  });
  let releaseRecovery: (() => void) | undefined;
  let releaseWorkspaceSelection: (() => void) | undefined;
  const editorScene = new AnimationEditorScene(
    (state, id) => {
      editorScene.fitPreview();
      mirrorTools.bind(state, JSON.stringify([window.location.pathname, id]));
      releaseRecovery?.();
      timeline.bind(state, id);
      inspector.bind(state);
      releaseWorkspaceSelection?.();
      let selectedBone = state.selectedBoneId;
      let selectedEvent = state.selectedEvent;
      let selectedKeys = state.selectedKeys;
      releaseWorkspaceSelection = state.subscribe(() => {
        if (
          (state.selectedBoneId && state.selectedBoneId !== selectedBone) ||
          (state.selectedEvent && state.selectedEvent !== selectedEvent) ||
          (state.selectedKeys.length && state.selectedKeys !== selectedKeys)
        )
          workspace.revealInspector();
        selectedBone = state.selectedBoneId;
        selectedEvent = state.selectedEvent;
        selectedKeys = state.selectedKeys;
      });
      let recoveryAnimation: string | null | undefined;
      let recoverySource: ReadonlyAnimation | null | undefined;
      let recoveryImportRevision = state.importRevision;
      const synchronizeRecovery = (): void => {
        const animation = state.selectedAnimationId;
        const source = state.sourceAnimation;
        const imported = state.importRevision !== recoveryImportRevision;
        recoveryImportRevision = state.importRevision;
        if (animation !== recoveryAnimation || source !== recoverySource) {
          // A same-name import establishes a new baseline and clears this session's previous draft.
          if (animation === recoveryAnimation) recovery.update();
          recoveryAnimation = animation;
          recoverySource = source;
          if (animation === null) recovery.unbind();
          else
            recovery.bind(
              {
                key: JSON.stringify([window.location.pathname, id, animation]),
                source: draftSource({ rig: state.rig, animation: state.sourceAnimation }),
                label: `animation "${animation}"`,
                snapshot: () => state.workingAnimation,
                dirty: () => state.dirty,
                data: (snapshot) => snapshot,
                validate: (data) => {
                  const inspected = inspectAnimationDefinition(data, state.rig);
                  return inspected.data?.name === animation;
                },
                restore: (data) => state.replaceWorkingAnimation(data),
              },
              { recover: !imported },
            );
        }
        recovery.update();
      };
      releaseRecovery = state.subscribe(synchronizeRecovery);
      synchronizeRecovery();
    },
    (message) => {
      mirrorTools.unbind();
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
  const onionControls = new OnionSkinControlsController(app, editorScene);
  app.querySelector<HTMLInputElement>('#animation-ik-preview')!.addEventListener(
    'change',
    (event) => {
      editorScene.setIKPreview((event.target as HTMLInputElement).checked);
    },
    { signal: previewControls.signal },
  );
  const game = createEditorGame('animation-stage', editorScene);
  const workspace = new AnimationWorkspaceController(app, () => {
    game.scale.getParentBounds();
    game.scale.refresh();
  });

  return () => {
    releaseRecovery?.();
    releaseWorkspaceSelection?.();
    mirrorTools.dispose();
    workspace.dispose();
    recovery.dispose();
    releaseNavigationGuard();
    timeline.dispose();
    inspector.dispose();
    onionControls.dispose();
    previewControls.abort();
    releaseCharacterSelection();
    game.destroy(true);
    scene = undefined;
  };
});
if (import.meta.hot) import.meta.hot.dispose(unmount);
