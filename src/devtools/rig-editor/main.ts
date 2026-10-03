import Phaser from 'phaser';
import { demoIK } from '../../demo/demoIK.js';
import { createControlsController } from './ControlsController.js';
import { mountEditorMarkup } from './editorMarkup.js';
import { createHierarchyController } from './HierarchyController.js';
import { createInspectorController } from './InspectorController.js';
import { protectUnsavedChanges } from './protectUnsavedChanges.js';
import type { RigEditor } from './RigEditor.js';
import { RigEditorScene } from './RigEditorScene.js';
import { createSessionController } from './SessionController.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#editor-app');
if (!app) throw new Error('Missing rig editor host.');
mountEditorMarkup(app);

const session = createSessionController(app, () => scene);
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
const scene = new RigEditorScene(render, inspector.showError, { ikChains: demoIK });
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'editor-stage',
  width: 760,
  height: 640,
  transparent: true,
  render: { antialias: true, maxTextures: 1 },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [scene],
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    releaseNavigationGuard();
    game.destroy(true);
  });
