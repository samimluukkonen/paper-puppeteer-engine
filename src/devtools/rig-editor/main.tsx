import { mountView } from '../../ui/mountView.js';
import { ArtworkController } from '../shared/artwork/ArtworkController.js';
import { RigEditorView } from './editorMarkup.js';
import { initializeRigEditor } from './initializeRigEditor.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#editor-app');
if (!app) throw new Error('Missing rig editor host.');
app.classList.add('view-shell', 'workspace-shell', 'rig-workspace');
const artwork = new ArtworkController();
const unmount = mountView(app, <RigEditorView artwork={artwork} />, (host) => initializeRigEditor(host, artwork));
if (import.meta.hot) import.meta.hot.dispose(unmount);
