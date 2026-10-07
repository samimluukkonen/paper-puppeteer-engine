import { getDemoCharacterProfile } from '../../demo/demoCharacterProfiles.js';
import type { RigDefinition } from '../../engine/types.js';
import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { DraftRecovery } from '../shared/DraftRecovery.js';
import { createEditorGame } from '../shared/editorGame.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { createControlsController } from './ControlsController.js';
import { mountEditorMarkup } from './editorMarkup.js';
import { createHierarchyController } from './HierarchyController.js';
import { createInspectorController } from './InspectorController.js';
import type { RigEditor } from './RigEditor.js';
import { RigEditorScene } from './RigEditorScene.js';
import type { ReadonlyRigData } from './RigEditorState.js';
import { createSessionController } from './SessionController.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#editor-app');
if (!app) throw new Error('Missing rig editor host.');
mountEditorMarkup(app);
const releaseCharacterSelection = bindCharacterSelection(app);

const recoveryStatus = app.querySelector<HTMLElement>('#rig-draft-status')!;
const recovery = new DraftRecovery<ReadonlyRigData<RigDefinition>>((message) => {
  recoveryStatus.textContent = message;
});
let recoveryEditor: RigEditor | undefined;
const session = createSessionController(
  app,
  () => scene,
  (editor) => {
    if (editor !== recoveryEditor) {
      recoveryEditor = editor;
      recovery.bind({
        key: JSON.stringify([globalThis.location?.pathname ?? '', selectedCharacterId(), scene.rigFilename]),
        source: JSON.stringify({ name: editor.state.name, rig: editor.state.workingCopy }),
        label: 'rig',
        snapshot: () => editor.state.workingCopy,
        dirty: () => editor.state.dirty,
        data: (snapshot) => ({ version: 1, ...snapshot }),
        validate: (data) => editor.state.canRestoreDraft(data),
        restore: (data) => {
          const restored = editor.state.restoreDraft(data);
          if (restored) editor.refresh(false);
          return restored;
        },
      });
    }
    recovery.update();
  },
);
const releaseNavigationGuard = protectUnsavedChanges(session.hasUnsavedChanges);
const inspector = createInspectorController(app.querySelector<HTMLElement>('#inspector')!, session.updateStatus);
const hierarchy = createHierarchyController(app.querySelector<HTMLElement>('#hierarchy')!);
const controls = createControlsController(app, session.updateStatus);
const render = (editor: RigEditor): void => {
  session.updateStatus(editor);
  hierarchy.render(editor);
  controls.render(editor);
  inspector.render(editor);
};
const scene = new RigEditorScene(render, inspector.showError, {
  characterUrl: `../characters/${selectedCharacterId()}/character.json`,
  ikChains: getDemoCharacterProfile(selectedCharacterId()).ikChains,
});
const game = createEditorGame('editor-stage', scene);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    recovery.dispose();
    releaseNavigationGuard();
    releaseCharacterSelection();
    inspector.dispose();
    controls.dispose();
    hierarchy.dispose();
    session.dispose();
    game.destroy(true);
  });
