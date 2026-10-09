import { mountView } from '../../ui/mountView.js';
import { RigEditorView } from './editorMarkup.js';
import { initializeRigEditor } from './initializeRigEditor.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#editor-app');
if (!app) throw new Error('Missing rig editor host.');
app.classList.add('view-shell', 'workspace-shell', 'rig-workspace');
const unmount = mountView(app, <RigEditorView />, initializeRigEditor);
if (import.meta.hot) import.meta.hot.dispose(unmount);
