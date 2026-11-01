import Clapperboard from 'lucide-react/icons/clapperboard';
import Download from 'lucide-react/icons/download';
import FolderInput from 'lucide-react/icons/folder-input';
import FolderOpen from 'lucide-react/icons/folder-open';
import FolderPlus from 'lucide-react/icons/folder-plus';
import Images from 'lucide-react/icons/images';
import LayoutTemplate from 'lucide-react/icons/layout-template';
import Network from 'lucide-react/icons/network';
import Redo2 from 'lucide-react/icons/redo-2';
import Settings from 'lucide-react/icons/settings';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Trash2 from 'lucide-react/icons/trash-2';
import Undo2 from 'lucide-react/icons/undo-2';
import UsersRound from 'lucide-react/icons/users-round';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { abortable } from '../../engine/abortable.js';
import { CharacterLoader } from '../../engine/CharacterLoader.js';
import { readJsonFile } from '../../engine/jsonInput.js';
import { PACKAGE_MAX_BYTES } from '../../engine/packageZip.js';
import { parseSceneJson } from '../../engine/SceneDefinition.js';
import type { SceneDefinition } from '../../engine/SceneDefinition.js';
import { characterCatalog } from '../../shared/characterCatalog.js';
import { downloadBlob } from '../../shared/downloadJson.js';
import { bindExportShortcut, blocksEditorShortcut, historyShortcut } from '../../shared/keyboardShortcuts.js';
import { EditorTabs } from '../../ui/EditorTabs.js';
import { ViewHeader } from '../../ui/viewShell.js';
import { LocalAutosave } from '../shared/autosave/LocalAutosave.js';
import { buildProjectDraft } from '../shared/autosave/projectDrafts.js';
import { LocalDraftControls, localDrafts } from '../shared/autosave/RecoveryPanel.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { GuideTargets } from '../shared/guides/GuideTargets.js';
import { createNewCharacter, suggestCharacterId } from '../shared/newCharacter.js';
import { buildCharacterPackage } from '../shared/package/characterPackage.js';
import { packageZipWorker } from '../shared/package/packageZipWorkerClient.js';
import { CharacterVariantDialog, type CharacterCreationKind } from './CharacterVariantDialog.js';
import { ProjectAnimationLibrary } from './ProjectAnimationLibrary.js';
import { ProjectAssetLibrary } from './ProjectAssetLibrary.js';
import { ProjectAudioLibrary } from './ProjectAudioLibrary.js';
import { ProjectEditorHosts, type ProjectEditorHost, type ProjectSession } from './ProjectEditorHosts.js';
import { ProjectFeatureGuide } from './ProjectFeatureGuide.js';
import { ProjectValidationError, type ProjectInspection, type ValidationContext } from './projectInspection.js';
import {
  buildProjectPackage,
  characterFileFetcher,
  importProjectPackage,
  packageHostedCharacter,
} from './projectPackage.js';
import { ProjectRigMapping } from './ProjectRigMapping.js';
import { ProjectValidationPanel } from './ProjectValidationPanel.js';
import { ProjectWorkspace } from './ProjectWorkspace.js';
import '../../ui/theme.css';
import '../../ui/viewShell.css';
import '../../ui/workspace.css';

/** Project documents outlive the bounded cache of disposable editor renderers. */
export function ProjectView() {
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [selected, setSelected] = useState<ProjectSession>();
  const [active, setActive] = useState<string>();
  const [hosts, setHosts] = useState<readonly ProjectEditorHost[]>([]);
  const [status, setStatus] = useState('Create a project or import a project ZIP.');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<{
    workspace: ProjectWorkspace;
    report: ProjectInspection;
    revision: number;
  }>();
  const operation = useRef(false);
  const transferLifetime = useRef(new AbortController());
  const projectRoot = useRef<HTMLDivElement>(null);
  const [guideTargets] = useState(() => new GuideTargets(document));
  const projectHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!active) projectHeading.current?.focus({ preventScroll: true });
  }, [active]);
  const projectDialog = useRef<HTMLDialogElement>(null);
  const characterDialog = useRef<HTMLDialogElement>(null);
  const sceneDialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [characterCreation, setCharacterCreation] = useState<{ source: string; kind: CharacterCreationKind }>();
  const [sceneName, setSceneName] = useState('');
  const [example, setExample] = useState(characterCatalog[0]!.id);
  const [settingsName, setSettingsName] = useState('');
  const importDialog = useRef<HTMLDialogElement>(null);
  const [sceneImport, setSceneImport] = useState<SceneDefinition>();
  const [sceneReferences, setSceneReferences] = useState<Record<string, string>>({});
  const current = useRef({ sessions, hosts });
  current.current = { sessions, hosts };
  const workspace = selected?.workspace;
  const revision = useSyncExternalStore(workspace?.subscribe ?? noSubscribe, workspace?.getSnapshot ?? zero);
  const validationContext = validation?.workspace === workspace ? validation?.report.context : undefined;
  const validationRevision = validation?.revision;
  const showValidation = (owner: ProjectWorkspace, report: ProjectInspection): void => {
    setValidation({ workspace: owner, report, revision: owner.getSnapshot() });
  };
  const [editors] = useState(
    () =>
      new ProjectEditorHosts({
        baseUrl: window.location.href,
        changed: setHosts,
        activate: setActive,
        validate: showValidation,
      }),
  );
  useEffect(() => {
    if (!workspace || !validationContext || validationRevision === revision) return;
    const timer = setTimeout(
      () =>
        setValidation({ workspace, report: workspace.inspect(validationContext), revision: workspace.getSnapshot() }),
      250,
    );
    return () => clearTimeout(timer);
  }, [workspace, revision, validationContext, validationRevision]);
  const validate = (context: ValidationContext = 'draft'): void => {
    if (workspace) showValidation(workspace, workspace.inspect(context, true));
  };
  useEffect(() => {
    const resolve = editors.resolve;
    window.paperProjectEditor = resolve;
    const guard = (event: BeforeUnloadEvent): void => {
      if (
        !current.current.sessions.some(({ workspace }) => workspace.hasUnsavedChanges) &&
        !current.current.hosts.some((host) => host.pending?.())
      )
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    const poll = setInterval(() => {
      for (const session of current.current.sessions) session.autosave.update();
    }, 500);
    const flush = (): void => {
      for (const session of current.current.sessions) void session.autosave.flush();
    };
    const leave = (): void => {
      for (const session of current.current.sessions) session.autosave.suspend();
    };
    const resume = (): void => {
      for (const session of current.current.sessions) session.autosave.start();
    };
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', hidden);
    const transfers = transferLifetime.current;
    return () => {
      transfers.abort(new DOMException('Project Workspace closed.', 'AbortError'));
      clearInterval(poll);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', hidden);
      for (const session of current.current.sessions) {
        session.releaseAutosave();
        session.autosave.dispose();
      }
      window.removeEventListener('beforeunload', guard);
      if (window.paperProjectEditor === resolve) delete window.paperProjectEditor;
      try {
        editors.dispose();
      } finally {
        for (const session of current.current.sessions) session.workspace.disposeCharacterDocuments();
      }
    };
  }, [editors]);
  const run = (task: () => Promise<void>): void => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    void task()
      .catch((error: unknown) => {
        if (error instanceof ProjectValidationError && workspace) showValidation(workspace, error.report);
        setStatus(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        operation.current = false;
        setBusy(false);
      });
  };
  const attempt = (task: () => void): void => {
    try {
      task();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const addProject = useCallback((workspace: ProjectWorkspace): void => {
    const autosave = new LocalAutosave(
      workspace.recoveryKey ?? `project:${workspace.definition.id}`,
      localDrafts,
      () => {
        const revision = workspace.autosaveRevision;
        return revision === undefined
          ? undefined
          : {
              revision,
              name: workspace.definition.name,
              dirty: workspace.hasUnsavedChanges,
              build: (signal) => buildProjectDraft(workspace, signal),
            };
      },
    );
    const session = {
      key: crypto.randomUUID(),
      workspace,
      autosave,
      releaseAutosave: workspace.subscribe(autosave.update),
    };
    autosave.start();
    setSessions((held) => [...held, session]);
    setSelected(session);
    setActive(undefined);
    setSettingsName(workspace.definition.name);
    setStatus('Project open in this tab. Export a project ZIP to keep your work.');
  }, []);
  const openAsset = (
    kind: 'character' | 'scene',
    id: string,
    view: 'rig' | 'animation' = 'rig',
    guide = false,
    guideId?: string,
  ): Promise<void> => (selected ? editors.open(selected, kind, id, view, guide, guideId) : Promise.resolve());
  const readZip = async (file: File) => {
    if (file.size > PACKAGE_MAX_BYTES) throw new Error('Package exceeds 100 MiB.');
    const signal = AbortSignal.any([transferLifetime.current.signal, AbortSignal.timeout(60_000)]);
    signal.throwIfAborted();
    const bytes = new Uint8Array(await abortable(file.arrayBuffer(), signal));
    return packageZipWorker.decodeOwned(bytes, signal);
  };
  const importScene = async (file: File): Promise<void> => {
    if (!workspace) return;
    const scene = parseSceneJson(await readJsonFile(file));
    // Map source references to explicit project references on a detached proposal.
    // Unregistered dependencies are reported without partially modifying this project.
    const references: Record<string, string> = {};
    for (const actor of scene.actors) {
      const exact = workspace.definition.characters.find((entry) => entry.manifest === actor.character.manifest);
      const catalog = characterCatalog.find(
        (entry) => actor.character.manifest === `../characters/${entry.id}/character.json`,
      );
      const entry =
        exact ?? (catalog ? workspace.definition.characters.find((entry) => entry.id === catalog.id) : undefined);
      references[actor.character.manifest] = entry?.id ?? '';
    }
    if (!scene.actors.length) {
      workspace.addScene(scene);
      setStatus('Scene imported.');
      return;
    }
    setSceneImport(scene);
    setSceneReferences(references);
    importDialog.current?.showModal();
  };
  const exportProject = async (): Promise<void> => {
    if (!workspace) return;
    const signal = AbortSignal.any([transferLifetime.current.signal, AbortSignal.timeout(60_000)]);
    const captured = await buildProjectPackage(workspace, signal);
    const { bytes } = await packageZipWorker.encode(captured.files, signal);
    signal.throwIfAborted();
    showValidation(workspace, workspace.inspect('export'));
    downloadBlob(
      new Blob([bytes], { type: 'application/zip' }),
      `${workspace.definition.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'project'}.project.zip`,
    );
    workspace.markExported(captured.metadata, captured.characters, captured.scenes);
    selected?.autosave.exported();
    setStatus('Project ZIP download started. Repository files were not overwritten.');
  };
  useEffect(() => {
    if (active) return;
    const releaseExport = bindExportShortcut(projectRoot.current!, () => {
      if (workspace) run(exportProject);
    });
    const keydown = (event: KeyboardEvent): void => {
      if (busy || !workspace || blocksEditorShortcut(event)) return;
      const history = historyShortcut(event);
      if (!history) return;
      event.preventDefault();
      if (!event.repeat)
        attempt(() => {
          if (history === 'undo') workspace.undo();
          else workspace.redo();
        });
    };
    window.addEventListener('keydown', keydown);
    return () => {
      releaseExport();
      window.removeEventListener('keydown', keydown);
    };
  });
  return (
    <div ref={projectRoot} className="view-shell workspace-shell project-workspace">
      <div className="project-overview" hidden={!!active}>
        <ViewHeader
          view="project"
          headingRef={projectHeading}
          featureGuide={
            <ProjectFeatureGuide
              key={selected?.key ?? 'empty'}
              targets={guideTargets}
              {...(workspace ? { project: workspace.definition } : {})}
              open={(kind, id, view, guideId) => run(() => openAsset(kind, id, view, true, guideId))}
            />
          }
        />
        <EditorTabs
          label="Project workspace controls"
          tabs={[
            {
              id: 'project-edit',
              label: 'Project',
              icon: 'project',
              content: (
                <div className="workspace-command-bar">
                  <button
                    className="workspace-primary"
                    disabled={busy}
                    onClick={() => {
                      setName('');
                      projectDialog.current?.showModal();
                    }}
                  >
                    <FolderPlus size={16} aria-hidden="true" />
                    New Project
                  </button>
                  <FileAction
                    label="Import Project"
                    icon={<FolderInput size={16} aria-hidden="true" />}
                    accept=".zip"
                    disabled={busy}
                    onFile={(file) =>
                      run(async () => {
                        const signal = AbortSignal.any([transferLifetime.current.signal, AbortSignal.timeout(60_000)]);
                        const imported = await importProjectPackage(await readZip(file), { signal });
                        signal.throwIfAborted();
                        addProject(imported);
                      })
                    }
                  />
                  <label>
                    <FolderOpen size={16} aria-hidden="true" />
                    Project{' '}
                    <select
                      aria-label="Select project"
                      value={selected?.key ?? ''}
                      disabled={busy}
                      onChange={(event) => {
                        const session = sessions.find((entry) => entry.key === event.target.value);
                        setSelected(session);
                        setSettingsName(session?.workspace.definition.name ?? '');
                      }}
                    >
                      <option value="" disabled>
                        No project selected
                      </option>
                      {sessions.map((session) => (
                        <option key={session.key} value={session.key}>
                          {session.workspace.definition.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {workspace && (
                    <>
                      <button
                        data-guide-id={GUIDE_TARGETS.projectHistory}
                        disabled={busy || !workspace.history.canUndo}
                        onClick={() => attempt(() => workspace.undo())}
                      >
                        <Undo2 size={16} aria-hidden="true" />
                        Undo Project
                      </button>
                      <button
                        disabled={busy || !workspace.history.canRedo}
                        onClick={() => attempt(() => workspace.redo())}
                      >
                        <Redo2 size={16} aria-hidden="true" />
                        Redo Project
                      </button>
                      <button
                        data-guide-id={GUIDE_TARGETS.projectExport}
                        disabled={busy}
                        title="Export project ZIP (Ctrl/Cmd+S)"
                        onClick={() => run(exportProject)}
                      >
                        <Download size={16} aria-hidden="true" />
                        Export Project
                      </button>
                      <button data-guide-id={GUIDE_TARGETS.projectValidate} disabled={busy} onClick={() => validate()}>
                        <ShieldCheck size={16} aria-hidden="true" />
                        Validate Project
                      </button>
                    </>
                  )}
                </div>
              ),
            },
            {
              id: 'project-draft',
              label: 'Local draft',
              icon: 'draft',
              content: (
                <LocalDraftControls onRecover={addProject} {...(selected ? { autosave: selected.autosave } : {})} />
              ),
            },
          ]}
        />
        <p className="workspace-caption project-status" role="status">
          {busy ? 'Working… ' : ''}
          {status}
        </p>
        {!workspace && (
          <main className="project-content project-panel">
            <h2>No project open</h2>
            <p>
              Choose New Project to start empty, or Import Project to open a project ZIP. Saved recovery drafts are
              available in the Local draft tab.
            </p>
          </main>
        )}
        {workspace && (
          <main className="project-content">
            <div className="workspace-panel-heading">
              <h2>{workspace.definition.name}</h2>
              <span>{workspace.dirty ? 'Project metadata: Unsaved' : 'Project metadata: Exported'}</span>
            </div>
            <p className="workspace-caption">
              Project ID: {workspace.definition.id} ·{' '}
              {workspace.hasUnsavedChanges ? 'Unexported project changes' : 'Project exported'}. Documents keep their
              own editing histories and export checkpoints.
            </p>
            {validation?.workspace === workspace && (
              <ProjectValidationPanel
                report={validation.report}
                busy={busy}
                revalidate={validate}
                openAsset={(issue) =>
                  run(() =>
                    openAsset(
                      issue.view === 'scene' ? 'scene' : 'character',
                      issue.asset.owner,
                      issue.view === 'animation' ? 'animation' : 'rig',
                    ),
                  )
                }
              />
            )}
            <div className="project-columns">
              <section className="project-panel" data-guide-id={GUIDE_TARGETS.projectCharacters}>
                <h2 className="workspace-heading-with-icon">
                  <UsersRound size={16} aria-hidden="true" />
                  Characters
                </h2>
                <div className="project-actions">
                  <button
                    className="workspace-primary"
                    disabled={busy}
                    onClick={() => characterDialog.current?.showModal()}
                  >
                    + New Character
                  </button>
                  <button
                    className="workspace-primary"
                    disabled={busy || !workspace.definition.characters.some((entry) => entry.template)}
                    onClick={() =>
                      setCharacterCreation({
                        source: workspace.definition.characters.find((entry) => entry.template)!.id,
                        kind: 'template',
                      })
                    }
                  >
                    New from Template
                  </button>
                  <FileAction
                    label="Import Character ZIP"
                    accept=".zip"
                    disabled={busy}
                    onFile={(file) =>
                      run(async () => {
                        await workspace.addCharacter(await readZip(file));
                        setStatus('Character registered.');
                      })
                    }
                  />
                </div>
                <div className="project-actions">
                  <label>
                    Existing character{' '}
                    <select value={example} disabled={busy} onChange={(event) => setExample(event.target.value)}>
                      {characterCatalog.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="workspace-primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const definition = await CharacterLoader.load(
                          new URL(`../characters/${example}/character.json`, window.location.href).href,
                        );
                        await workspace.addCharacter(await packageHostedCharacter(definition));
                        setStatus('Existing character registered without modifying its source.');
                      })
                    }
                  >
                    Add Existing Character
                  </button>
                </div>
                <ul className="project-assets">
                  {workspace.definition.characters.map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.name}</strong>
                      <span className="workspace-caption">
                        {entry.id} · {workspace.characterDirty(entry.id) ? 'Document modified' : 'Document unchanged'}
                        <br />
                        {entry.manifest}
                        <br />
                        {entry.variant
                          ? `Shared rig and animations: ${entry.variant.rig} · Appearance: ${entry.variant.skin}`
                          : `Independent rig: ${entry.id}${entry.template ? ' · Reusable template' : ''}`}
                      </span>
                      {entry.variant && (
                        <label>
                          Appearance only{' '}
                          <select
                            aria-label={`Appearance for ${entry.name}`}
                            value={entry.variant.skin}
                            disabled={busy}
                            onChange={(event) =>
                              attempt(() => {
                                workspace.setVariantSkin(entry.id, event.target.value);
                                setStatus(
                                  [
                                    'Appearance updated.',
                                    ...workspace.appearanceWarnings(entry.id, event.target.value),
                                  ].join(' '),
                                );
                              })
                            }
                          >
                            {workspace.characterSkins(entry.id).map((skin) => (
                              <option key={skin} value={skin}>
                                {skin}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {!entry.variant && (
                        <label className="project-template-toggle">
                          <input
                            type="checkbox"
                            checked={!!entry.template}
                            disabled={busy}
                            onChange={(event) =>
                              attempt(() => workspace.setCharacterTemplate(entry.id, event.target.checked))
                            }
                          />
                          Reusable template
                        </label>
                      )}
                      <div className="project-actions">
                        <button
                          className="workspace-button-with-icon"
                          disabled={busy}
                          onClick={() => run(() => openAsset('character', entry.id, 'rig'))}
                        >
                          <Network size={16} aria-hidden="true" />
                          {entry.variant ? 'Edit Shared Rig' : 'Rig Editor'}
                        </button>
                        <button
                          className="workspace-button-with-icon"
                          disabled={busy}
                          onClick={() => run(() => openAsset('character', entry.id, 'animation'))}
                        >
                          <Clapperboard size={16} aria-hidden="true" />
                          {entry.variant ? 'Edit Shared Animations' : 'Animation Editor'}
                        </button>
                        <button
                          className="workspace-primary"
                          disabled={busy}
                          onClick={() => setCharacterCreation({ source: entry.id, kind: 'variant' })}
                        >
                          Create Character Variant
                        </button>
                        <button
                          className="workspace-primary"
                          disabled={busy}
                          onClick={() => setCharacterCreation({ source: entry.id, kind: 'copy' })}
                        >
                          Create Independent Character Copy
                        </button>
                        {entry.variant && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                const signal = AbortSignal.any([
                                  transferLifetime.current.signal,
                                  AbortSignal.timeout(60_000),
                                ]);
                                const files = await buildCharacterPackage(
                                  workspace.captureCharacter(entry.id),
                                  characterFileFetcher(workspace.character(entry.id).files),
                                  signal,
                                );
                                const { bytes } = await packageZipWorker.encode(files, signal);
                                signal.throwIfAborted();
                                downloadBlob(new Blob([bytes], { type: 'application/zip' }), `${entry.id}.zip`);
                                setStatus(
                                  'Variant character ZIP downloaded with its selected appearance, rig and animations.',
                                );
                              })
                            }
                          >
                            Download Character ZIP
                          </button>
                        )}
                        <button
                          className="workspace-danger workspace-button-with-icon"
                          disabled={busy}
                          onClick={() => attempt(() => workspace.remove('characters', entry.id))}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {!workspace.definition.characters.length && (
                  <p>No characters. Create an empty character or register an existing package.</p>
                )}
              </section>
              <section className="project-panel" data-guide-id={GUIDE_TARGETS.projectScenes}>
                <h2 className="workspace-heading-with-icon">
                  <LayoutTemplate size={16} aria-hidden="true" />
                  Scenes
                </h2>
                <div className="project-actions">
                  <button
                    className="workspace-primary"
                    disabled={busy}
                    onClick={() => sceneDialog.current?.showModal()}
                  >
                    + New Scene
                  </button>
                  <FileAction
                    label="Import Scene JSON"
                    accept=".json"
                    disabled={busy}
                    onFile={(file) => run(() => importScene(file))}
                  />
                </div>
                <ul className="project-assets">
                  {workspace.definition.scenes.map((entry) => (
                    <li key={entry.id}>
                      <strong>{workspace.scenes.scene(entry.id)?.name}</strong>
                      <span className="workspace-caption">
                        {entry.id} · {workspace.sceneDirty(entry.id) ? 'Document modified' : 'Project checkpoint'}
                      </span>
                      <div className="project-actions">
                        <button
                          className="workspace-button-with-icon"
                          disabled={busy}
                          onClick={() => run(() => openAsset('scene', entry.id))}
                        >
                          <LayoutTemplate size={16} aria-hidden="true" />
                          Scene Editor
                        </button>
                        <button
                          className="workspace-danger workspace-button-with-icon"
                          disabled={busy}
                          onClick={() => attempt(() => workspace.remove('scenes', entry.id))}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {!workspace.definition.scenes.length && <p>No scenes. New scenes start empty.</p>}
              </section>
            </div>
            <ProjectAnimationLibrary
              key={`animations:${selected.key}`}
              workspace={workspace}
              busy={busy}
              create={(target, clip, targetRevision) => editors.createAnimation(selected, target, clip, targetRevision)}
              open={(character, animation, copy) =>
                run(() =>
                  editors.open(selected, 'character', character, 'animation', false, undefined, {
                    name: animation,
                    copy,
                  }),
                )
              }
            />
            <ProjectRigMapping key={`mappings:${selected.key}`} workspace={workspace} busy={busy} />
            <ProjectAudioLibrary
              key={selected.key}
              workspace={workspace}
              busy={busy}
              active={!active}
              run={run}
              onStatus={setStatus}
            />
            <section className="project-panel" data-guide-id={GUIDE_TARGETS.projectAssets}>
              <h2 className="workspace-heading-with-icon">
                <Images size={16} aria-hidden="true" />
                Assets
              </h2>
              <p className="workspace-caption">
                Artwork, rigs, animations, skins and attachments belong to their character. Open its editor to author
                them.
              </p>
              {workspace.definition.characters.map(({ id, name }) => {
                const entry = workspace.character(id);
                const snapshot = workspace.characterInventory(id);
                return <ProjectAssetLibrary key={id} name={name} snapshot={snapshot} files={entry.files} />;
              })}
            </section>
            <details className="project-panel project-settings">
              <summary>
                <span className="workspace-heading-with-icon">
                  <Settings size={16} aria-hidden="true" />
                  Project Settings
                </span>
              </summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  attempt(() => workspace.rename(settingsName));
                }}
              >
                <label>
                  Project name{' '}
                  <input required value={settingsName} onChange={(event) => setSettingsName(event.target.value)} />
                </label>
                <button disabled={busy}>Apply name</button>
              </form>
            </details>
          </main>
        )}
      </div>
      {hosts.map((host) => (
        <iframe
          key={host.token}
          title={`${host.kind === 'character' ? 'Character' : 'Scene'} editor: ${host.asset}`}
          className="project-editor-host"
          src={host.src}
          hidden={active !== host.token}
        />
      ))}
      {workspace && characterCreation && (
        <CharacterVariantDialog
          key={`${selected?.key}:${characterCreation.source}:${characterCreation.kind}`}
          workspace={workspace}
          {...characterCreation}
          busy={busy}
          run={run}
          close={() => setCharacterCreation(undefined)}
          created={async (id, independent) => {
            setStatus(
              independent
                ? 'Independent character created from the current source. Artwork binaries are reused.'
                : 'Variant created with a shared rig and animations. Change Appearance only to select another skin.',
            );
            if (independent) await openAsset('character', id, 'rig');
          }}
        />
      )}
      <dialog ref={projectDialog} className="workspace-dialog" aria-label="New Project">
        <h2>New Project</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            attempt(() => {
              addProject(new ProjectWorkspace(name));
              projectDialog.current?.close();
            });
          }}
        >
          <label>
            Project name
            <input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <p>Starts empty. No demo assets are copied.</p>
          <div className="project-dialog-actions">
            <button type="button" onClick={() => projectDialog.current?.close()}>
              Cancel
            </button>
            <button className="workspace-primary">Create Project</button>
          </div>
        </form>
      </dialog>
      <dialog ref={characterDialog} className="workspace-dialog" aria-label="New Character">
        <h2>New Character</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              if (!workspace) return;
              const id = suggestCharacterId(characterName, [
                ...characterCatalog.map((entry) => entry.id),
                ...workspace.definition.characters.map((entry) => entry.id),
              ]);
              const draft = createNewCharacter({ id, name: characterName });
              await workspace.addCharacter(
                await buildCharacterPackage({
                  definition: draft.definition,
                  rig: draft.definition.rigFile!,
                  skins: draft.definition.standaloneSkins,
                  animations: [],
                  replacements: [],
                }),
              );
              characterDialog.current?.close();
              setCharacterName('');
              setStatus('Empty character created. Open Rig Editor to start authoring.');
            });
          }}
        >
          <label>
            Character name
            <input
              required
              maxLength={100}
              value={characterName}
              onChange={(event) => setCharacterName(event.target.value)}
            />
          </label>
          <div className="project-dialog-actions">
            <button type="button" onClick={() => characterDialog.current?.close()}>
              Cancel
            </button>
            <button className="workspace-primary" disabled={busy}>
              Create Character
            </button>
          </div>
        </form>
      </dialog>
      <dialog ref={sceneDialog} className="workspace-dialog" aria-label="New Scene">
        <h2>New Scene</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            attempt(() => {
              workspace?.createScene({ id: crypto.randomUUID(), name: sceneName.trim() });
              sceneDialog.current?.close();
              setSceneName('');
            });
          }}
        >
          <label>
            Scene name
            <input required maxLength={200} value={sceneName} onChange={(event) => setSceneName(event.target.value)} />
          </label>
          <div className="project-dialog-actions">
            <button type="button" onClick={() => sceneDialog.current?.close()}>
              Cancel
            </button>
            <button className="workspace-primary" disabled={busy}>
              Create Scene
            </button>
          </div>
        </form>
      </dialog>
      <dialog ref={importDialog} className="workspace-dialog" aria-label="Register scene dependencies">
        <h2>Register scene dependencies</h2>
        <p>Choose the registered character for each source reference. The imported file stays unchanged.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            attempt(() => {
              if (!sceneImport || !workspace) return;
              const proposal = structuredClone(sceneImport);
              for (const actor of proposal.actors)
                actor.character.manifest = workspace.characterReference(
                  sceneReferences[actor.character.manifest] ?? '',
                );
              workspace.addScene(proposal);
              importDialog.current?.close();
              setSceneImport(undefined);
              setStatus('Scene registered with explicit character references.');
            });
          }}
        >
          {Object.keys(sceneReferences).map((reference) => (
            <label key={reference}>
              {reference}
              <select
                required
                value={sceneReferences[reference]}
                onChange={(event) => setSceneReferences((held) => ({ ...held, [reference]: event.target.value }))}
              >
                <option value="">Select a project character</option>
                {workspace?.definition.characters.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} ({entry.id})
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="project-dialog-actions">
            <button type="button" onClick={() => importDialog.current?.close()}>
              Cancel
            </button>
            <button disabled={busy}>Import Scene</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
const zero = (): number => 0;
const noSubscribe = (): (() => void) => () => {};

function FileAction({
  label,
  icon,
  accept,
  disabled,
  onFile,
}: {
  label: string;
  icon?: ReactNode;
  accept: string;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="project-file-action">
      <button type="button" disabled={disabled} onClick={() => input.current?.click()}>
        {icon}
        {label}
      </button>
      <input
        ref={input}
        hidden
        type="file"
        accept={accept}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onFile(file);
        }}
      />
    </span>
  );
}
