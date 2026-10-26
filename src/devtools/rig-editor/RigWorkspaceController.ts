import { bindCharacterSelection } from '../../ui/characterSelection.js';
import type { AnimationEditorScene } from '../animation-editor/AnimationEditorScene.js';
import { createControlsController } from './ControlsController.js';
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
    {
      hasPendingChanges: () => getScene().hasPendingArtworkProposal,
    },
  );
  const inspector = createInspectorController(app.querySelector<HTMLElement>('#inspector')!, session.updateStatus);
  const hierarchy = createHierarchyController(app.querySelector<HTMLElement>('#hierarchy')!);
  const controls = createControlsController(app, session.updateStatus);
  let selected: string | undefined;
  let rendered = false;
  return {
    render(editor: RigEditor): void {
      const marker = editor.state.selectedFootContactMarkerId;
      const next = marker ? `contact:${marker}` : editor.state.selection?.id;
      if (next && next !== selected) app.dispatchEvent(new Event('workspace:reveal-inspector'));
      if (rendered && !app.hidden && next && next !== selected) {
        // Keep hierarchy navigation and skeleton commands in their current tab.
        // Canvas selections still reveal the fields for the selected object.
        const hierarchyFocused = app.querySelector('.workspace-hierarchy:focus-within');
        if (!hierarchyFocused) {
          const id = marker ? 'rig-inspector-contact-markers' : 'rig-inspector-selection';
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
