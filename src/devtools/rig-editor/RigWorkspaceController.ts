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
  return {
    render(editor: RigEditor): void {
      const next = editor.state.selection?.id;
      if (next && next !== selected) app.dispatchEvent(new Event('workspace:reveal-inspector'));
      selected = next;
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
