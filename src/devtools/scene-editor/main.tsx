import { mountView } from '../../ui/mountView.js';
import { SceneEditorDocument } from './SceneEditorDocument.js';
import { SceneEditorView } from './SceneEditorView.js';

const host = document.querySelector<HTMLElement>('#scene-editor-app');
if (!host) throw new Error('Missing scene editor host.');
host.classList.add('view-shell', 'workspace-shell', 'scene-workspace');
const scenes = new SceneEditorDocument();
const unmount = mountView(host, <SceneEditorView document={scenes} />, () => () => {});
if (import.meta.hot) import.meta.hot.dispose(unmount);
