import { createRoot } from 'react-dom/client';
import { ProjectView } from './ProjectView.js';
import './style.css';

const host = document.querySelector('#project-app');
if (!host) throw new Error('Missing project workspace host.');
const root = createRoot(host);
root.render(<ProjectView />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
