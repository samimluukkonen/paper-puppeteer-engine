import packageInfo from '../../package.json';
import { defaultCharacterId } from '../shared/characterCatalog.js';
import { characterChoices, selectedCharacterId } from './characterSelection.js';
import puppetLogo from './images/puppet-running-header.png';
import './viewShell.css';
import './workspace.css';
import './dropdowns.css';

const views = {
  demo: { title: 'Engine Demo', path: '', description: 'Explore animation, playback, and inverse kinematics.' },
  rig: { title: 'Rig Editor', path: 'rig-editor/', description: 'Edit local rig values · align artwork' },
  animation: { title: 'Animation Editor', path: 'animation-editor/', description: 'Loading character…' },
} as const;

/** Shared navigation and page identity for the demo and authoring tools. */
export function ViewHeader({ view }: { view: keyof typeof views }) {
  const current = views[view];
  const root = view === 'demo' ? './' : '../';
  const characterId = selectedCharacterId();
  const characterQuery = characterId === defaultCharacterId ? '' : `?character=${characterId}`;
  return (
    <header className="view-header">
      <div className="view-header-top">
        <a className="wordmark" href={`${root}${characterQuery}`} aria-label="Paper Puppeteer Engine">
          <img className="mark" src={puppetLogo} width="44" height="44" alt="" />
          PAPER PUPPETEER <span className="wordmark-sub">ENGINE</span>
        </a>
        <span className="view-version">v{packageInfo.version}</span>
      </div>
      <div className="view-header-main">
        <div className="view-heading">
          <h1>
            {current.title}
            {view === 'rig' && (
              <>
                {' '}
                <span className="view-title-badge">Bind Pose</span>
              </>
            )}
          </h1>
          <p className="view-description" id={view === 'animation' ? 'character-status' : undefined}>
            {current.description}
          </p>
          <label className="character-choice">
            Character
            <select id="character-selection" defaultValue={characterId}>
              {characterChoices.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav className="view-navigation" aria-label="Views">
          {Object.entries(views).map(([id, item]) => (
            <a key={id} href={`${root}${item.path}${characterQuery}`} aria-current={id === view ? 'page' : undefined}>
              {item.title}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
