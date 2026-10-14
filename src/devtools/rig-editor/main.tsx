import { mountView } from '../../ui/mountView.js';
import { ArtworkController } from '../shared/artwork/ArtworkController.js';
import { AttachmentController } from './AttachmentController.js';
import { RigEditorView } from './editorMarkup.js';
import { initializeRigEditor } from './initializeRigEditor.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#editor-app');
if (!app) throw new Error('Missing rig editor host.');
app.classList.add('view-shell', 'workspace-shell', 'rig-workspace');
const artwork = new ArtworkController();
const attachments = new AttachmentController(artwork);
const unmount = mountView(app, <RigEditorView artwork={artwork} attachments={attachments} />, (host) =>
  initializeRigEditor(host, artwork, attachments),
);
if (import.meta.hot) import.meta.hot.dispose(unmount);
