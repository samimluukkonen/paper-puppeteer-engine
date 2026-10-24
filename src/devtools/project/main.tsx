import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { finishViewLoading } from '../../ui/viewLoading.js';
import { ProjectView } from './ProjectView.js';
import './style.css';

const host = document.querySelector('#project-app');
if (!host) throw new Error('Missing project workspace host.');
const root = createRoot(host);
flushSync(() => root.render(<ProjectView />));
finishViewLoading();
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
