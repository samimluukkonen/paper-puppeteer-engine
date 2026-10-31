import Clapperboard from 'lucide-react/icons/clapperboard';
import FolderOpen from 'lucide-react/icons/folder-open';
import LayoutTemplate from 'lucide-react/icons/layout-template';
import Network from 'lucide-react/icons/network';
import { useSyncExternalStore, type ReactNode, type Ref } from 'react';
import packageInfo from '../../package.json';
import { projectEditorContext } from '../devtools/project/projectBridge.js';
import { AutosaveStatus } from '../devtools/shared/autosave/RecoveryPanel.js';
import { GUIDE_TARGETS } from '../devtools/shared/guides/anchors.js';
import { defaultCharacterId } from '../shared/characterCatalog.js';
import { selectedCharacterId, workspaceCharacterChoices } from './characterSelection.js';
import { FeatureGuideButton } from './FeatureGuide.js';
import puppetLogo from './images/puppet-running-header.png';
import { NewCharacterDialog } from './NewCharacterDialog.js';
import './theme.css';
import './viewShell.css';
import './workspace.css';
import './dropdowns.css';

const views = {
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
  scene: {
    title: 'Scene Editor',
    path: 'scene-editor/',
    description: 'Create and manage scene documents.',
    icon: LayoutTemplate,
  },
  project: {
    title: 'Project Workspace',
    path: 'project/',
    description: 'Characters, animations, artwork and scenes in one project.',
    icon: FolderOpen,
  },
} as const;
const noSubscribe = () => () => {};

/** Shared navigation and page identity for the authoring tools. */
export function ViewHeader({
  view,
  selectionId = 'character-selection',
  featureGuide,
  headingRef,
  afterHeader,
}: {
  view: keyof typeof views;
  selectionId?: string;
  featureGuide?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  afterHeader?: ReactNode;
}) {
  const current = views[view];
  const project = projectEditorContext();
  const projectIdentity = useSyncExternalStore(project?.subscribe ?? noSubscribe, () =>
    project
      ? `Project: ${project.projectName} · ${view === 'scene' ? 'Scene' : 'Character'}: ${project.assetName}`
      : '',
  );
  const root = '../';
  const characterId = selectedCharacterId();
  const choices = workspaceCharacterChoices();
  const characterQuery =
    view === 'project' || characterId === defaultCharacterId ? '' : `?character=${encodeURIComponent(characterId)}`;
  const characterView = view === 'rig' || view === 'animation';
  return (
    <>
      <header className="view-header">
        <div className="view-header-main">
          <div className="view-header-top">
            <a
              className="wordmark"
              href={`${root}project/`}
              aria-label="Paper Puppeteer Engine"
              onClick={
                project
                  ? (event) => {
                      event.preventDefault();
                      project.navigate('project');
                    }
                  : undefined
              }
            >
              <img className="mark" src={puppetLogo} width="44" height="44" alt="" />
              <span className="wordmark-name">
                Paper Puppeteer <span className="wordmark-sub">/ Engine</span>
              </span>
            </a>
            <span className="view-version">v{packageInfo.version}</span>
          </div>
          <div className="view-heading">
            <h1 ref={headingRef} tabIndex={-1}>
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
            {projectIdentity && <p className="project-identity">{projectIdentity}</p>}
            {characterView && !project && (
              <label className="character-choice">
                Character
                <select
                  id={selectionId}
                  data-guide-id={view === 'rig' ? GUIDE_TARGETS.rigCharacter : undefined}
                  defaultValue={characterId}
                >
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
            )}
            {characterView && !project && (
              <NewCharacterDialog
                root={root}
                guideTargetId={view === 'rig' ? GUIDE_TARGETS.rigNewCharacter : undefined}
              />
            )}
          </div>
        </div>
        <div className="view-header-guide">{featureGuide ?? <FeatureGuideButton />}</div>
        <nav className="view-navigation" aria-label="Views">
          {project ? (
            <button type="button" onClick={() => project.navigate('project')}>
              ← Project
            </button>
          ) : (
            <a
              href={`${root}project/`}
              aria-label="Project Workspace"
              aria-current={view === 'project' ? 'page' : undefined}
            >
              <FolderOpen size={16} aria-hidden="true" />
              Project
            </a>
          )}
          {Object.entries(views)
            .filter(([id]) => id !== 'project')
            .filter(([id]) => !project || (view !== 'scene' && (id === 'rig' || id === 'animation')))
            .map(([id, item]) => (
              <a
                key={id}
                href={`${root}${item.path}${project ? window.location.search : characterQuery}`}
                aria-current={id === view ? 'page' : undefined}
              >
                <item.icon size={16} aria-hidden="true" />
                {item.title}
              </a>
            ))}
        </nav>
      </header>
      {afterHeader}
      {view === 'project' && project?.autosave && <AutosaveStatus autosave={project.autosave} />}
    </>
  );
}

/** Local/project save controls share the editor's Local draft tab. */
export function EditorDraftControls({ children }: { children?: ReactNode }) {
  const project = projectEditorContext();
  return (
    <>
      {children}
      {project?.autosave && <AutosaveStatus autosave={project.autosave} />}
    </>
  );
}
