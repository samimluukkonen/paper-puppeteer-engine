import { Clapperboard, MonitorPlay, Network } from 'lucide-react';
import packageInfo from '../../package.json';
import { defaultCharacterId } from '../shared/characterCatalog.js';
import { characterChoices, selectedCharacterId, workspaceCharacterChoices } from './characterSelection.js';
import { FeatureGuideButton } from './FeatureGuide.js';
import puppetLogo from './images/puppet-running-header.png';
import { NewCharacterDialog } from './NewCharacterDialog.js';
import './theme.css';
import './viewShell.css';
import './workspace.css';
import './dropdowns.css';

const views = {
  demo: {
    title: 'Engine Demo',
    path: '',
    description: 'Explore animation, playback, and inverse kinematics.',
    icon: MonitorPlay,
  },
  rig: {
    title: 'Rig Editor',
    path: 'rig-editor/',
    description: 'Edit local rig values · align artwork',
    icon: Network,
  },
  animation: {
    title: 'Animation Editor',
    path: 'animation-editor/',
    description: 'Loading character…',
    icon: Clapperboard,
  },
} as const;

/** Shared navigation and page identity for the demo and authoring tools. */
export function ViewHeader({
  view,
  selectionId = 'character-selection',
}: {
  view: keyof typeof views;
  selectionId?: string;
}) {
  const current = views[view];
  const root = view === 'demo' ? './' : '../';
  const characterId = selectedCharacterId();
  const choices = view === 'demo' ? characterChoices : workspaceCharacterChoices();
  const characterQuery = characterId === defaultCharacterId ? '' : `?character=${encodeURIComponent(characterId)}`;
  return (
    <header className="view-header">
      <div className="view-header-top">
        <a className="wordmark" href={`${root}${characterQuery}`} aria-label="Paper Puppeteer Engine">
          <img className="mark" src={puppetLogo} width="44" height="44" alt="" />
          <span className="wordmark-name">
            Paper Puppeteer <span className="wordmark-sub">/ Engine</span>
          </span>
        </a>
        <span className="view-version">v{packageInfo.version}</span>
      </div>
      <div className="view-header-main">
        <div className="view-heading">
          <h1 tabIndex={-1}>
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
            <select id={selectionId} defaultValue={characterId}>
              {!choices.some((entry) => entry.id === characterId) && (
                <option value={characterId}>{characterId} (unavailable)</option>
              )}
              {choices.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <NewCharacterDialog root={root} />
        </div>
        <nav className="view-navigation" aria-label="Views">
          {Object.entries(views).map(([id, item]) => (
            <a key={id} href={`${root}${item.path}${characterQuery}`} aria-current={id === view ? 'page' : undefined}>
              <item.icon size={16} aria-hidden="true" />
              {item.title}
            </a>
          ))}
          <FeatureGuideButton />
        </nav>
      </div>
    </header>
  );
}
