import { inspectAnimationDefinition } from '../../engine/externalData.js';
import { getCharacterPreviewSettings } from '../../shared/characterPreviewSettings.js';
import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { DraftRecovery } from '../shared/DraftRecovery.js';
import { draftSource } from '../shared/draftSource.js';
import { createEditorGame } from '../shared/editorGame.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { AnimationEditorScene } from './AnimationEditorScene.js';
import type { ReadonlyAnimation } from './AnimationEditorState.js';
import { AnimationWorkspaceController } from './AnimationWorkspaceController.js';
import { BoneInspectorController } from './BoneInspectorController.js';
import { mountEditorMarkup } from './editorMarkup.js';
import { TimelineController } from './TimelineController.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#animation-editor-app');
if (!app) throw new Error('Missing animation editor host.');
mountEditorMarkup(app);

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
const scene = new AnimationEditorScene(
  (state, id) => {
    scene.fitPreview();
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
  (message) => timeline.showError(message),
  {
    characterUrl: `../characters/${selectedCharacterId()}/character.json`,
    ikChains: getCharacterPreviewSettings(selectedCharacterId()).ikChains,
  },
);
const previewControls = new AbortController();
app.querySelector<HTMLSelectElement>('#animation-facing')!.addEventListener(
  'change',
  (event) => {
    const facing = (event.target as HTMLSelectElement).value;
    if (facing === 'left' || facing === 'right') scene.setFacing(facing);
  },
  { signal: previewControls.signal },
);
app.querySelector<HTMLInputElement>('#animation-show-bones')!.addEventListener(
  'change',
  (event) => {
    scene.setBonesVisible((event.target as HTMLInputElement).checked);
  },
  { signal: previewControls.signal },
);
app.querySelector<HTMLInputElement>('#animation-ik-preview')!.addEventListener(
  'change',
  (event) => {
    scene.setIKPreview((event.target as HTMLInputElement).checked);
  },
  { signal: previewControls.signal },
);
const game = createEditorGame('animation-stage', scene);
const workspace = new AnimationWorkspaceController(app, () => {
  game.scale.getParentBounds();
  game.scale.refresh();
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    releaseRecovery?.();
    releaseWorkspaceSelection?.();
    workspace.dispose();
    recovery.dispose();
    releaseNavigationGuard();
    timeline.dispose();
    inspector.dispose();
    previewControls.abort();
    releaseCharacterSelection();
    game.destroy(true);
  });
