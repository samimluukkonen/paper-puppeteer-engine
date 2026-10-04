import packageInfo from '../../package.json';
import puppetLogo from './images/puppet-running.png';
import './viewShell.css';

const views = {
  demo: { title: 'Engine Demo', path: '', description: 'Explore animation, playback, and inverse kinematics.' },
  rig: { title: 'Rig Editor', path: 'rig-editor/', description: 'Edit local rig values · right facing' },
  animation: { title: 'Animation Editor', path: 'animation-editor/', description: 'Loading character…' },
} as const;

/** Shared navigation and page identity for the demo and authoring tools. */
export function viewHeader(view: keyof typeof views): string {
  const current = views[view];
  const root = view === 'demo' ? './' : '../';
  const status = view === 'rig' ? '<p id="dirty-status"></p>' : '';
  return `
    <header class="view-header">
      <div class="view-header-top">
        <a class="wordmark" href="${root}" aria-label="Paper Puppeteer Engine"><img class="mark" src="${puppetLogo}" width="44" height="44" alt=""> PAPER PUPPETEER <span class="wordmark-sub">ENGINE</span></a>
        <span class="view-version">v${packageInfo.version}</span>
      </div>
      <div class="view-header-main">
        <div class="view-heading">
          <h1>${current.title}${view === 'rig' ? ' <span class="view-title-badge">Bind Pose</span>' : ''}</h1>
          <p${view === 'animation' ? ' id="character-status"' : ''}>${current.description}</p>
          ${status}
        </div>
        <nav class="view-navigation" aria-label="Views">
          ${Object.entries(views)
            .map(
              ([id, item]) =>
                `<a href="${root}${item.path}"${id === view ? ' aria-current="page"' : ''}>${item.title}</a>`,
            )
            .join('')}
        </nav>
      </div>
    </header>`;
}
