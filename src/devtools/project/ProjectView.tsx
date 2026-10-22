import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import packageInfo from '../../../package.json';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { CharacterLoader } from '../../engine/CharacterLoader.js';
import { readJsonFile } from '../../engine/jsonInput.js';
import { decodePackageZip, encodePackageZip, PACKAGE_MAX_BYTES } from '../../engine/packageZip.js';
import { parseSceneJson } from '../../engine/SceneDefinition.js';
import type { SceneDefinition } from '../../engine/SceneDefinition.js';
import { characterCatalog } from '../../shared/characterCatalog.js';
import { downloadBlob } from '../../shared/downloadJson.js';
import { bindExportShortcut, blocksEditorShortcut, historyShortcut } from '../../shared/keyboardShortcuts.js';
import puppetLogo from '../../ui/images/puppet-running-header.png';
import { LocalAutosave } from '../shared/autosave/LocalAutosave.js';
import { LocalDraftControls, localDrafts } from '../shared/autosave/RecoveryPanel.js';
import { createNewCharacter, suggestCharacterId } from '../shared/newCharacter.js';
import { buildCharacterPackage, openPackageRuntime } from '../shared/package/characterPackage.js';
import type { ProjectEditorContext } from './projectBridge.js';
import { ProjectFeatureGuide } from './ProjectFeatureGuide.js';
import {
  ProjectValidationError,
  requireValidExport,
  type ProjectInspection,
  type ValidationContext,
} from './projectInspection.js';
import {
  buildProjectPackage,
  buildProjectScenePackage,
  characterFileFetcher,
  importProjectPackage,
  packageHostedCharacter,
} from './projectPackage.js';
import { ProjectValidationPanel } from './ProjectValidationPanel.js';
import { ProjectWorkspace } from './ProjectWorkspace.js';
import '../../ui/theme.css';
import '../../ui/viewShell.css';
import '../../ui/workspace.css';

interface ProjectSession {
  key: string;
  workspace: ProjectWorkspace;
  autosave: LocalAutosave;
  releaseAutosave: () => void;
}
interface EditorHost {
  token: string;
  session: ProjectSession;
  asset: string;
  kind: 'character' | 'scene';
  src: string;
  context: ProjectEditorContext;
  pending?: () => boolean;
  openView?: (view: 'rig' | 'animation') => void;
  openGuide?: () => void;
  guidePending?: boolean;
}
interface RuntimeLease {
  definition: CharacterDefinition;
  dispose(): void;
}

/** Each retained host runs the existing editor app; hiding it never destroys authored state/history. */
export function ProjectView() {
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [selected, setSelected] = useState<ProjectSession>();
  const [active, setActive] = useState<string>();
  const [hosts, setHosts] = useState<EditorHost[]>([]);
  const owners = useRef(new Map<string, EditorHost>());
  const leases = useRef(new Set<RuntimeLease>());
  const [status, setStatus] = useState('Create a project or import a project ZIP.');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<{
    workspace: ProjectWorkspace;
    report: ProjectInspection;
    revision: number;
  }>();
  const operation = useRef(false);
  const projectRoot = useRef<HTMLDivElement>(null);
  const projectHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!active) projectHeading.current?.focus({ preventScroll: true });
  }, [active]);
  const projectDialog = useRef<HTMLDialogElement>(null);
  const characterDialog = useRef<HTMLDialogElement>(null);
  const sceneDialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [characterName, setCharacterName] = useState('');
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
    const resolve = (token: string) => owners.current.get(token)?.context;
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
    const resources = leases.current;
    return () => {
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
      for (const lease of resources) lease.dispose();
      resources.clear();
    };
  }, []);
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
  const addProject = (workspace: ProjectWorkspace): void => {
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
              build: async () => (await buildProjectPackage(workspace)).files,
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
  };
  const runtime = async (workspace: ProjectWorkspace, id: string, namespace?: string): Promise<RuntimeLease> => {
    const snapshot = workspace.captureCharacter(id);
    const files = await buildCharacterPackage(snapshot, characterFileFetcher(workspace.character(id).files));
    const lease = await openPackageRuntime(files, new AbortController().signal, namespace);
    leases.current.add(lease);
    return lease;
  };
  const openAsset = async (
    kind: 'character' | 'scene',
    id: string,
    view: 'rig' | 'animation' = 'rig',
    guide = false,
  ): Promise<void> => {
    if (!selected) return;
    const workspace = selected.workspace;
    const existing = [...owners.current.values()].find(
      (host) => host.session === selected && host.kind === kind && host.asset === id,
    );
    if (existing) {
      existing.openView?.(view);
      setActive(existing.token);
      if (guide) {
        if (existing.openGuide) existing.openGuide();
        else existing.guidePending = true;
      }
      return;
    }
    const token = crypto.randomUUID();
    const ownedLeases = new Set<RuntimeLease>();
    let closed = false;
    let disposeScene: (() => void) | undefined;
    const initialLease = kind === 'character' ? await runtime(workspace, id) : undefined;
    if (initialLease) ownedLeases.add(initialLease);
    const definition = initialLease?.definition;
    if (kind === 'scene') workspace.scenes.selectScene(id);
    const choices = workspace.definition.characters.map((entry) => ({
      id: entry.id,
      label: entry.name,
      manifest: entry.manifest,
    }));
    // Scene runtime definitions are fresh on every opening. The document remains the same owner.
    const runtimeCharacters = new Map<string, Promise<CharacterDefinition>>();
    let lastAuthoredRevision = workspace.autosaveRevision;
    const context: ProjectEditorContext = {
      get projectName() {
        return workspace.definition.name;
      },
      get assetName() {
        return kind === 'character'
          ? (workspace.definition.characters.find((entry) => entry.id === id)?.name ?? id)
          : (workspace.scenes.scene(id)?.name ?? id);
      },
      subscribe: workspace.subscribe,
      bindGuide: (open) => {
        const host = owners.current.get(token)!;
        host.openGuide = open;
        if (host.guidePending) {
          host.guidePending = false;
          open();
        }
        return () => {
          delete host.openGuide;
        };
      },
      ...(definition
        ? {
            definition,
            characterId: id,
            sourceDefinition: workspace.character(id).definition,
            fetcher: characterFileFetcher(workspace.character(id).files),
          }
        : { scenes: workspace.scenes }),
      choices,
      changed: () => {
        const revision = workspace.autosaveRevision;
        if (revision === lastAuthoredRevision) return;
        lastAuthoredRevision = revision;
        workspace.refresh();
      },
      bindScene: (dispose) => {
        disposeScene = dispose;
      },
      validateScene: (scene) => {
        const report = workspace.inspect('export', true, parseSceneJson(JSON.stringify(scene)));
        showValidation(workspace, report);
        requireValidExport(report);
        workspace.validateScene(scene);
      },
      confirmReplacement: (assetKind, assetId) => {
        const dependents = workspace
          .dependents({ kind: assetKind, owner: id, id: assetId })
          .filter(({ from }) => from.kind !== 'character');
        return (
          !dependents.length ||
          window.confirm(
            `Replace ${assetKind} "${assetId}"? This affects:\n${dependents.map(({ label }) => label).join('\n')}\n\nReferences will be kept. Continue?`,
          )
        );
      },
      assetReferences: (kind, assetId) =>
        workspace
          .dependents({ kind, owner: id, id: assetId })
          .filter(({ from }) => from.kind === 'actor')
          .map(({ label }) => label),
      buildScenePackage: (scene) =>
        buildProjectScenePackage(workspace, scene).catch((error: unknown) => {
          if (error instanceof ProjectValidationError) showValidation(workspace, error.report);
          throw error;
        }),
      loadCharacter: (reference) => {
        const characterId = workspace.resolveCharacter(reference);
        let request = runtimeCharacters.get(reference);
        if (!request) {
          request = runtime(
            workspace,
            characterId,
            `project_${token.replaceAll('-', '_')}_${runtimeCharacters.size}`,
          ).then((lease) => {
            if (closed) {
              lease.dispose();
              leases.current.delete(lease);
              throw new Error('Scene preview closed.');
            }
            ownedLeases.add(lease);
            return lease.definition;
          });
          runtimeCharacters.set(reference, request);
        }
        return request;
      },
      bindCharacter: (capture, pending, navigate) => {
        const entry = workspace.character(id);
        entry.capture = capture;
        entry.pending = pending;
        entry.loading = false;
        const host = owners.current.get(token)!;
        host.pending = pending;
        host.openView = navigate;
        workspace.refresh();
        return () => {
          delete entry.capture;
          delete entry.pending;
          entry.loading = false;
          delete host.pending;
          delete host.openView;
        };
      },
      navigate: () => {
        setActive(undefined);
        workspace.refresh();
        // Scene stages cache textures by reference. Dispose this preview on return so later
        // character edits are reflected on its next opening; authored scene history is retained.
        if (kind === 'scene') {
          closed = true;
          disposeScene?.();
          disposeScene = undefined;
          owners.current.delete(token);
          setHosts((held) => held.filter((host) => host.token !== token));
          // React removes the iframe and its Phaser consumers before releasing their URLs.
          setTimeout(() => {
            for (const lease of ownedLeases) {
              lease.dispose();
              leases.current.delete(lease);
            }
            ownedLeases.clear();
          }, 0);
        }
      },
    };
    const url = new URL(`../${kind === 'scene' ? 'scene' : view}-editor/`, window.location.href);
    url.searchParams.set('projectSession', token);
    if (kind === 'character') {
      url.searchParams.set('character', id);
      workspace.character(id).loading = true;
    }
    const host: EditorHost = { token, session: selected, asset: id, kind, src: url.href, context, guidePending: guide };
    owners.current.set(token, host);
    setHosts((held) => [...held, host]);
    setActive(token);
  };
  const readZip = async (file: File) => {
    if (file.size > PACKAGE_MAX_BYTES) throw new Error('Package exceeds 100 MiB.');
    return decodePackageZip(new Uint8Array(await file.arrayBuffer()));
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
    const captured = await buildProjectPackage(workspace);
    showValidation(workspace, workspace.inspect('export'));
    downloadBlob(
      new Blob([encodePackageZip(captured.files)], { type: 'application/zip' }),
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
      <LocalDraftControls onRecover={addProject} {...(selected ? { autosave: selected.autosave } : {})} />
      <div hidden={!!active}>
        <header className="view-header">
          <div className="view-header-top">
            <a className="wordmark" href="../">
              <img className="mark" src={puppetLogo} width="44" height="44" alt="" />
              <span className="wordmark-name">
                Paper Puppeteer <span className="wordmark-sub">/ Engine</span>
              </span>
            </a>
            <span className="view-version">v{packageInfo.version}</span>
          </div>
          <div className="view-header-main">
            <div className="view-heading">
              <h1 ref={projectHeading} tabIndex={-1}>
                Project Workspace
              </h1>
              <p className="view-description">Characters, animations, artwork and scenes in one project.</p>
            </div>
            <div className="view-header-guide">
              <ProjectFeatureGuide
                {...(workspace ? { project: workspace.definition } : {})}
                open={(kind, id, view) => run(() => openAsset(kind, id, view, true))}
              />
            </div>
            <nav className="view-navigation" aria-label="Views">
              <a href="../">Engine Demo</a>
              <a href="../rig-editor/">Rig Editor</a>
              <a href="../animation-editor/">Animation Editor</a>
              <a href="../scene-editor/">Scene Editor</a>
            </nav>
          </div>
        </header>
        <div className="workspace-command-bar">
          <button
            className="workspace-primary"
            disabled={busy}
            onClick={() => {
              setName('');
              projectDialog.current?.showModal();
            }}
          >
            New Project
          </button>
          <FileAction
            label="Import Project"
            accept=".zip"
            disabled={busy}
            onFile={(file) => run(async () => addProject(await importProjectPackage(await readZip(file))))}
          />
          <label>
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
              <button disabled={busy || !workspace.history.canUndo} onClick={() => attempt(() => workspace.undo())}>
                Undo Project
              </button>
              <button disabled={busy || !workspace.history.canRedo} onClick={() => attempt(() => workspace.redo())}>
                Redo Project
              </button>
              <button disabled={busy} title="Export project ZIP (Ctrl/Cmd+S)" onClick={() => run(exportProject)}>
                Export Project
              </button>
              <button disabled={busy} onClick={() => validate()}>
                Validate Project
              </button>
            </>
          )}
        </div>
        <p className="workspace-caption project-status" role="status">
          {busy ? 'Working… ' : ''}
          {status}
        </p>
        {!workspace && (
          <main className="project-content project-panel">
            <h2>No project open</h2>
            <p>
              Choose New Project to start empty, Import Project to open a project ZIP, or Recovery drafts to restore
              local work.
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
              <section className="project-panel">
                <h2>Characters</h2>
                <div className="project-actions">
                  <button disabled={busy} onClick={() => characterDialog.current?.showModal()}>
                    + New Character
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
                      </span>
                      <div className="project-actions">
                        <button disabled={busy} onClick={() => run(() => openAsset('character', entry.id, 'rig'))}>
                          Rig Editor
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => run(() => openAsset('character', entry.id, 'animation'))}
                        >
                          Animation Editor
                        </button>
                        <button disabled={busy} onClick={() => attempt(() => workspace.remove('characters', entry.id))}>
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
              <section className="project-panel">
                <h2>Scenes</h2>
                <div className="project-actions">
                  <button disabled={busy} onClick={() => sceneDialog.current?.showModal()}>
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
                        <button disabled={busy} onClick={() => run(() => openAsset('scene', entry.id))}>
                          Scene Editor
                        </button>
                        <button disabled={busy} onClick={() => attempt(() => workspace.remove('scenes', entry.id))}>
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {!workspace.definition.scenes.length && <p>No scenes. New scenes start empty.</p>}
              </section>
            </div>
            <section className="project-panel">
              <h2>Assets</h2>
              <p className="workspace-caption">
                Artwork, rigs, animations, skins and attachments belong to their character. Open its editor to author
                them.
              </p>
              {workspace.definition.characters.map(({ id, name }) => {
                const entry = workspace.character(id);
                const snapshot = entry.capture?.() ?? {
                  definition: entry.definition,
                  rig: entry.definition.rigFile!,
                  skins: entry.definition.standaloneSkins,
                  animations: entry.definition.animations,
                  replacements: [],
                };
                return (
                  <details key={id}>
                    <summary>{name} asset library</summary>
                    <p>Rig: {snapshot.definition.rigPath}</p>
                    <p>
                      Images:{' '}
                      {[
                        ...new Set([
                          ...Object.keys(snapshot.definition.textures),
                          ...snapshot.replacements.map((entry) => entry.assetKey),
                        ]),
                      ].join(', ') || 'None'}
                    </p>
                    <p>Animations: {snapshot.animations.map((clip) => clip.name).join(', ') || 'None'}</p>
                    <p>
                      Skins:{' '}
                      {[...new Set([...snapshot.skins, ...(snapshot.rig.skins ?? [])].map((skin) => skin.name))].join(
                        ', ',
                      ) || 'None'}
                    </p>
                    <p>Attachments: {snapshot.rig.attachments?.map((entry) => entry.id).join(', ') || 'None'}</p>
                  </details>
                );
              })}
            </section>
            <details className="project-panel">
              <summary>Project Settings</summary>
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
            <button disabled={busy}>Create Character</button>
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
            <button disabled={busy}>Create Scene</button>
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
  accept,
  disabled,
  onFile,
}: {
  label: string;
  accept: string;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className="project-file-action">
      {label}
      <input
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
    </label>
  );
}
