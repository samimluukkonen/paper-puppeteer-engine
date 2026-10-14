import { getCharacterPreviewSettings } from '../../shared/characterPreviewSettings.js';
import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { observePreview } from '../../ui/observePreview.js';
import type { ArtworkController } from '../shared/artwork/ArtworkController.js';
import { DraftRecoveryControls } from '../shared/DraftRecoveryControls.js';
import { draftSource } from '../shared/draftSource.js';
import { createEditorGame } from '../shared/editorGame.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { rigDraftKey } from '../shared/rigDraftSession.js';
import { createControlsController } from './ControlsController.js';
import { createHierarchyController } from './HierarchyController.js';
import { createInspectorController } from './InspectorController.js';
import type { RigEditor } from './RigEditor.js';
import { RigEditorScene } from './RigEditorScene.js';
import type { RigEditorRecoverySnapshot } from './RigEditorState.js';
import { createSessionController } from './SessionController.js';

/** Connect the existing editing model/controllers to their committed React hosts. */
export function initializeRigEditor(app: HTMLElement, artwork?: ArtworkController): () => void {
  const releaseCharacterSelection = bindCharacterSelection(app);

  const recoveryControls = new DraftRecoveryControls<RigEditorRecoverySnapshot>(
    app.querySelector<HTMLElement>('#rig-draft-status')!,
    app.querySelector<HTMLButtonElement>('#rig-download-retained-drafts')!,
  );
  const recovery = recoveryControls.recovery;
  let recoveryEditor: RigEditor | undefined;
  const session = createSessionController(
    app,
    () => scene,
    (editor) => {
      if (editor !== recoveryEditor) {
        const recover = scene.sessionReplacementReason === 'load';
        // The scene publishes this reason only after the replacement has initialized successfully.
        if (!recover) recovery.discard();
        recoveryEditor = editor;
        recovery.bind(
          {
            key: rigDraftKey(globalThis.location?.pathname ?? '', selectedCharacterId(), scene.rigFilename),
            source: draftSource({ name: editor.state.name, rig: editor.state.workingCopy }),
            label: 'rig',
            snapshot: () => editor.state.recoverySnapshot,
            dirty: () => editor.state.dirty,
            data: (snapshot) => editor.state.createRecoveryDraft(snapshot),
            validate: (data) => editor.state.canRestoreDraft(data),
            restore: (data) => {
              const restored = editor.state.restoreDraft(data);
              if (restored) editor.refresh(false);
              return restored;
            },
          },
          { recover },
        );
      }
      recovery.update();
    },
  );
  const releaseNavigationGuard = protectUnsavedChanges(
    () => session.hasUnsavedChanges() || !!artwork?.hasUnsavedChanges,
  );
  const inspector = createInspectorController(app.querySelector<HTMLElement>('#inspector')!, session.updateStatus);
  const hierarchy = createHierarchyController(app.querySelector<HTMLElement>('#hierarchy')!);
  const controls = createControlsController(app, session.updateStatus);
  let selected: string | undefined;
  const render = (editor: RigEditor): void => {
    const next = editor.state.selection?.id;
    if (next && next !== selected) app.dispatchEvent(new Event('workspace:reveal-inspector'));
    selected = next;
    session.updateStatus(editor);
    hierarchy.render(editor);
    controls.render(editor);
    inspector.render(editor);
  };
  const scene = new RigEditorScene(
    render,
    inspector.showError,
    {
      characterUrl: `../characters/${selectedCharacterId()}/character.json`,
      ikChains: getCharacterPreviewSettings(selectedCharacterId()).ikChains,
    },
    artwork,
  );
  const game = createEditorGame('editor-stage', scene);
  const releaseResize = observePreview(app.querySelector<HTMLElement>('#editor-stage')!, game);

  return () => {
    releaseResize();

    recoveryControls.dispose();
    releaseNavigationGuard();
    releaseCharacterSelection();
    inspector.dispose();
    controls.dispose();
    hierarchy.dispose();
    session.dispose();
    game.destroy(true);
    artwork?.dispose();
  };
}
