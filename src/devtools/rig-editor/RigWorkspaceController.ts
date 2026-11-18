import { bindCharacterSelection } from '../../ui/characterSelection.js';
import type { AnimationEditorScene } from '../animation-editor/AnimationEditorScene.js';
import { requireElement } from '../shared/editorElements.js';
import { createControlsController } from './ControlsController.js';
import { RIG_IDS } from './elementIds.js';
import { createHierarchyController } from './HierarchyController.js';
import { createInspectorController } from './InspectorController.js';
import type { RigEditor } from './RigEditor.js';
import { createSessionController } from './SessionController.js';

/** Full rig view adapts the same editor used by Rig Tweak; it creates no scene or document. */
export function createRigWorkspaceController(
  app: HTMLElement,
  getScene: () => AnimationEditorScene,
  changed: () => void,
) {
  const releaseCharacter = bindCharacterSelection(app);
  const session = createSessionController(
    app,
    getScene,
    changed,
    {},
    { hasPendingChanges: () => getScene().hasPendingArtworkProposal },
  );
  const inspector = createInspectorController(
    requireElement(app, RIG_IDS.inspector, HTMLElement),
    session.updateStatus,
  );
  const hierarchy = createHierarchyController(requireElement(app, RIG_IDS.hierarchy, HTMLElement));
  const controls = createControlsController(app, session.updateStatus);
  let selected: string | undefined;
  let rendered = false;
  return {
    render(editor: RigEditor): void {
      const marker = editor.state.selectedFootContactMarkerId;
      const selection = editor.state.selection;
      const next = marker ? `contact:${marker}` : selection ? `${selection.type}:${selection.id}` : undefined;
      if (next && next !== selected) app.dispatchEvent(new Event('workspace:reveal-inspector'));
      if (rendered && !app.hidden && next && next !== selected) {
        // Explicit control destinations survive native dropdown blur and delayed rendering.
        // Other inspector selections keep their tab; canvas selections reveal object fields.
        const preferred = editor.state.selectionInspectorTab;
        const id = preferred
          ? `rig-inspector-${preferred}`
          : requireElement(app, RIG_IDS.rigInspector, HTMLElement).matches(':focus-within')
            ? undefined
            : marker
              ? 'rig-inspector-contact-markers'
              : 'rig-inspector-selection';
        if (id) {
          app
            .querySelector(`[data-editor-tab-panel="${id}"]`)
            ?.dispatchEvent(new CustomEvent('workspace:reveal-tab', { bubbles: true, detail: id }));
        }
      }
      selected = next;
      rendered = true;
      session.updateStatus(editor);
      controls.render(editor);
      hierarchy.render(editor);
      inspector.render(editor);
    },
    showError: inspector.showError,
    dispose(): void {
      releaseCharacter();
      session.dispose();
      controls.dispose();
      hierarchy.dispose();
      inspector.dispose();
    },
  };
}
