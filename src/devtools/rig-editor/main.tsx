import { mountView } from '../../ui/mountView.js';
import { ArtworkController } from '../shared/artwork/ArtworkController.js';
import { PackageController } from '../shared/package/PackageController.js';
import { AttachmentController } from './AttachmentController.js';
import { RigEditorView } from './editorMarkup.js';
import { initializeRigEditor } from './initializeRigEditor.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#editor-app');
if (!app) throw new Error('Missing rig editor host.');
app.classList.add('view-shell', 'workspace-shell', 'rig-workspace');
const artwork = new ArtworkController();
const packages = new PackageController();
const attachments = new AttachmentController(artwork);
const unmount = mountView(
  app,
  <RigEditorView artwork={artwork} attachments={attachments} packages={packages} />,
  (host) => initializeRigEditor(host, artwork, attachments, packages),
);
if (import.meta.hot) import.meta.hot.dispose(unmount);
