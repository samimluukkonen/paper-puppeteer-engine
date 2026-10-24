import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { readJsonFile } from '../../engine/jsonInput.js';
import { encodePackageZip, PACKAGE_MAX_FILE_BYTES } from '../../engine/packageZip.js';
import { serializeSceneDefinition } from '../../engine/SceneDefinition.js';
import { buildScenePackage } from '../../engine/ScenePackage.js';
import { readSceneResource } from '../../engine/sceneResource.js';
import { downloadBlob, downloadJson } from '../../shared/downloadJson.js';
import { bindExportShortcut } from '../../shared/keyboardShortcuts.js';
import { EditorContext } from '../../ui/EditorContext.js';
import { ViewHeader } from '../../ui/viewShell.js';
import { projectEditorContext } from '../project/projectBridge.js';
import { sceneDraftSource } from '../shared/autosave/editorDrafts.js';
import { LocalAutosave } from '../shared/autosave/LocalAutosave.js';
import { LocalDraftControls, localDrafts } from '../shared/autosave/RecoveryPanel.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { SceneActionInspector } from './SceneActionInspector.js';
import { SceneActorsPanel } from './SceneActorsPanel.js';
import { SceneArtworkPanel } from './SceneArtworkPanel.js';
import type { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import type { SceneEditorDocument, ReadonlyScene } from './SceneEditorDocument.js';
import { SceneEditorPlayback } from './SceneEditorPlayback.js';
import { SceneGroundPanel } from './SceneGroundPanel.js';
import { bindSceneShortcuts } from './SceneKeyboardController.js';
import { SceneLayersPanel } from './SceneLayersPanel.js';
import { ScenePlaybackInspector } from './ScenePlaybackInspector.js';
import { SceneStageView } from './SceneStage.js';
import { SceneTimeline } from './SceneTimeline.js';
import { exportSceneJson, importSceneJson, sceneExportFilename } from './SceneTransfer.js';
import { SceneWorkspaceLayoutController } from './SceneWorkspaceLayoutController.js';
import './style.css';

function SceneProperties({ scene, document }: { scene: ReadonlyScene; document: SceneEditorDocument }) {
  const [name, setName] = useState(scene.name);
  const [duration, setDuration] = useState(String(scene.duration / 1000));
  useEffect(() => {
    setName(scene.name);
    setDuration(String(scene.duration / 1000));
  }, [scene]);
  return (
    <details data-guide-id={GUIDE_TARGETS.sceneProperties}>
      <summary>Scene properties</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          document.updateProperties({ name, duration: duration.trim() ? Number(duration) * 1000 : NaN });
        }}
      >
        <label>
          Scene ID
          <input value={scene.id} readOnly />
        </label>
        <p className="workspace-caption">Assigned when the scene is created.</p>
        <label>
          Name
          <input value={name} required onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Duration (seconds)
          <input
            type="number"
            min="0.001"
            step="any"
            required
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
        <button type="submit">Apply properties</button>
      </form>
    </details>
  );
}

/** React owns the workspace. The document and authored format have no React or Phaser dependency. */
export function SceneEditorView({
  document,
  registry,
}: {
  document: SceneEditorDocument;
  registry: SceneCharacterRegistry;
}) {
  useSyncExternalStore(document.subscribe, document.getSnapshot, document.getSnapshot);
  const scene = document.workingScene;
  const project = projectEditorContext();
  const [playback] = useState(() => new SceneEditorPlayback());
  const [autosave] = useState(() => {
    const id = crypto.randomUUID();
    return project
      ? undefined
      : new LocalAutosave(`scenes:${location.pathname}`, localDrafts, () => sceneDraftSource(document, registry, id));
  });
  useEffect(() => {
    if (!autosave) return;
    autosave.start();
    const unsubscribe = document.subscribe(autosave.update);
    const poll = setInterval(autosave.update, 500);
    const flush = (): void => {
      void autosave.flush();
    };
    const leave = (): void => autosave.suspend();
    const resume = (): void => autosave.start();
    const hidden = (): void => {
      if (globalThis.document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', resume);
    globalThis.document.addEventListener('visibilitychange', hidden);
    return () => {
      clearInterval(poll);
      unsubscribe();
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', resume);
      globalThis.document.removeEventListener('visibilitychange', hidden);
      autosave.dispose();
    };
  }, [autosave, document]);
  const workspace = useRef<HTMLElement>(null);
  const source = document.sourceScene;
  useLayoutEffect(() => {
    // A same-ID import is a fresh document too. Ordinary authored edits keep disclosure state.
    for (const section of workspace.current?.querySelectorAll('.scene-inspector details[open]') ?? [])
      section.removeAttribute('open');
  }, [source]);
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const layout = new SceneWorkspaceLayoutController(workspace.current!);
    return () => layout.dispose();
  }, []);
  const newId = useRef<HTMLInputElement>(null);
  const pasteDialog = useRef<HTMLDialogElement>(null);
  const [pasteJson, setPasteJson] = useState('');
  const [transferStatus, setTransferStatus] = useState('');
  const transfer = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => protectUnsavedChanges(() => document.hasUnsavedChanges), [document]);
  useEffect(
    () => () => {
      transfer.current?.abort();
    },
    [],
  );
  const confirmDiscard = (): boolean => window.confirm('Replace this scene and discard its unsaved changes?');
  const openNew = (): void => {
    let index = 1;
    while (document.sceneIds.includes(`scene-${index}`)) index++;
    if (newId.current) newId.current.value = `scene-${index}`;
    dialog.current?.showModal();
  };
  const runTransfer = (operation: (signal: AbortSignal) => Promise<void>): void => {
    if (transfer.current) return;
    const request = new AbortController();
    transfer.current = request;
    setLoading(true);
    setTransferStatus('Checking scene dependencies…');
    void operation(request.signal)
      .catch((error: unknown) => {
        if (!request.signal.aborted) {
          setTransferStatus('');
          document.reportError(error);
        }
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
        if (transfer.current === request) transfer.current = null;
      });
  };
  const assetOptions = (signal: AbortSignal) => ({
    baseUrl: window.location.href,
    signal,
    loadImage: (reference: string) =>
      document.images.has(reference)
        ? Promise.resolve(document.images.read(reference))
        : readSceneResource(new URL(reference, window.location.href).href, fetch, PACKAGE_MAX_FILE_BYTES, signal),
    loadCharacter: (_url: string, reference: string) => registry.load(reference),
  });
  const importJson = async (json: string, signal: AbortSignal): Promise<void> => {
    if (await importSceneJson(document, json, assetOptions(signal), confirmDiscard)) {
      pasteDialog.current?.close();
      setPasteJson('');
      setTransferStatus('Scene imported.');
    } else setTransferStatus('Import cancelled.');
  };
  const exportScene = (kind: 'validate' | 'copy' | 'json' | 'zip'): void => {
    const snapshot = document.workingScene;
    if (!snapshot) return;
    runTransfer(async (signal) => {
      if (project) project.validateScene(snapshot);
      if (kind === 'zip') {
        const files = await (project
          ? project.buildScenePackage(snapshot)
          : buildScenePackage(snapshot, assetOptions(signal)));
        signal.throwIfAborted();
        downloadBlob(
          new Blob([encodePackageZip(files)], { type: 'application/zip' }),
          sceneExportFilename(snapshot.id, 'zip'),
        );
        // The package contains rebased references; a JSON checkpoint must retain this captured source.
        document.markSaved(snapshot);
        autosave?.exported();
        setTransferStatus(
          'Scene package downloaded. Extract it for hosting or open the ZIP in the standalone runtime.',
        );
        return;
      }
      const json = project ? serializeSceneDefinition(snapshot) : await exportSceneJson(snapshot, assetOptions(signal));
      signal.throwIfAborted();
      if (document.workingScene === snapshot) document.validateScene();
      if (kind === 'copy') {
        if (!navigator.clipboard?.writeText)
          throw new Error('Clipboard is unavailable. Use Download scene JSON instead.');
        await navigator.clipboard.writeText(json);
        signal.throwIfAborted();
        setTransferStatus('Scene JSON copied. Download scene JSON or a scene package for a disk copy.');
      } else if (kind === 'json') {
        downloadJson(json, sceneExportFilename(snapshot.id, 'json'));
        document.markSaved(snapshot);
        autosave?.exported();
        setTransferStatus('Scene JSON downloaded. Character references stay relative to the scene file.');
      } else setTransferStatus('Scene and character dependencies are valid.');
    });
  };
  useEffect(() => {
    const releaseKeys = bindSceneShortcuts(document, playback);
    const releaseExport = bindExportShortcut(workspace.current!, () => {
      if (!document.hasActiveGesture) exportScene('json');
    });
    return () => {
      releaseKeys();
      releaseExport();
    };
  });
  return (
    <>
      <ViewHeader view="scene" />
      {!project && <LocalDraftControls {...(autosave ? { autosave } : {})} />}
      <div className="workspace-command-bar" aria-label="Scene document commands">
        <div hidden={!!project} className="scene-transfer-commands">
          <button type="button" data-guide-id={GUIDE_TARGETS.sceneNew} onClick={openNew}>
            New Scene
          </button>
          <label className="scene-open">
            Open scene JSON
            <input
              type="file"
              accept=".json,application/json"
              disabled={loading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                runTransfer(async (signal) => {
                  const json = await readJsonFile(file);
                  signal.throwIfAborted();
                  await importJson(json, signal);
                });
              }}
            />
          </label>
          <button type="button" disabled={loading} onClick={() => pasteDialog.current?.showModal()}>
            Paste scene JSON
          </button>
        </div>
        <label hidden={!!project}>
          Scene{' '}
          <select
            aria-label="Select scene"
            value={document.selectedSceneId ?? ''}
            disabled={!scene}
            onChange={(event) => {
              document.selectScene(event.target.value);
            }}
          >
            {!scene && <option value="">No scene selected</option>}
            {document.sceneIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-guide-id={GUIDE_TARGETS.sceneHistory}
          disabled={!document.canUndo}
          onClick={() => {
            document.undo();
          }}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!document.canRedo}
          onClick={() => {
            document.redo();
          }}
        >
          Redo
        </button>
        <button
          type="button"
          disabled={!scene}
          onClick={() => {
            if (!document.dirty || window.confirm('Revert this scene to its original source?'))
              document.revertScene({ discardChanges: true });
          }}
        >
          Revert
        </button>
        <button type="button" disabled={!scene || loading} onClick={() => exportScene('validate')}>
          Validate Scene
        </button>
        <button type="button" disabled={!scene || loading} onClick={() => exportScene('copy')}>
          Copy Scene JSON
        </button>
        <button
          type="button"
          data-guide-id={GUIDE_TARGETS.sceneExport}
          disabled={!scene || loading}
          title="Download scene JSON (Ctrl/Cmd+S)"
          onClick={() => exportScene('json')}
        >
          Download scene JSON
        </button>
        <button
          type="button"
          data-guide-id={GUIDE_TARGETS.scenePackage}
          disabled={!scene || loading}
          onClick={() => exportScene('zip')}
        >
          Download scene package
        </button>
      </div>
      <EditorContext
        {...(project ? { project: project.projectName } : {})}
        editor="Scene"
        ready={!!scene}
        document={
          <span role="status">
            {scene
              ? `Scene: ${scene.name} · ${scene.id} · ${scene.duration / 1000} s · ${document.isNewScene ? 'New / Unsaved' : document.dirty ? 'Unsaved changes' : 'Matches loaded / exported checkpoint'}`
              : 'Create a new scene or open a scene JSON document.'}
            {transferStatus && ` ${transferStatus}`}
          </span>
        }
        modified={scene && document.dirty ? ['Scene'] : []}
      />
      {document.validationIssues.length > 0 && (
        <div role="alert" className="scene-errors">
          {document.validationIssues.map((issue, index) => (
            <p key={index}>
              {issue.path ? `${issue.path}: ` : ''}
              {issue.message}
            </p>
          ))}
        </div>
      )}
      <main ref={workspace} className="scene-workspace-body">
        <section data-guide-id={GUIDE_TARGETS.sceneStage} className="scene-stage" aria-label="Scene stage">
          {scene ? (
            <SceneStageView document={document} registry={registry} playback={playback} />
          ) : (
            <div className="scene-empty-stage">
              <h2>No scene open</h2>
              <p>Start a scene without loading a character.</p>
              <button type="button" onClick={openNew}>
                Create a scene
              </button>
            </div>
          )}
        </section>
        <aside id="scene-inspector" className="scene-inspector" aria-label="Scene inspector">
          <h2>Inspector</h2>
          {scene ? (
            <>
              <SceneProperties key={scene.id} scene={scene} document={document} />
              <SceneLayersPanel key={`layers-${scene.id}`} document={document} />
              <SceneArtworkPanel key={`artwork-${scene.id}`} document={document} />
              <SceneGroundPanel key={`ground-${scene.id}`} document={document} playback={playback} />
              <ScenePlaybackInspector
                key={`preview-${scene.id}`}
                playback={playback}
                actorId={document.selectedActorId}
              />
              <SceneActionInspector key={`actions-${scene.id}`} scene={scene} document={document} registry={registry} />
              <SceneActorsPanel key={`actors-${scene.id}`} scene={scene} document={document} registry={registry} />
              <details>
                <summary>Document contents</summary>
                <p>
                  {scene.actors.length} actors · {scene.actions.length} scheduled actions
                </p>
                <p>Actor array order controls preview depth. Actions are preserved in downloads.</p>
              </details>
            </>
          ) : (
            <p>Select a scene to inspect its properties.</p>
          )}
        </aside>
        <div
          id="scene-inspector-divider"
          role="separator"
          tabIndex={0}
          aria-label="Scene inspector width"
          aria-controls="scene-inspector"
          aria-orientation="vertical"
          aria-valuemin={260}
          aria-valuemax={600}
          aria-valuenow={300}
          title="Drag to resize. Left/Right adjusts; Home/End selects the limits."
        />
        <div
          id="scene-timeline-divider"
          role="separator"
          tabIndex={0}
          aria-label="Scene timeline height"
          aria-controls="scene-timeline"
          aria-orientation="horizontal"
          aria-valuemin={240}
          aria-valuemax={600}
          aria-valuenow={300}
          title="Drag to resize. Up/Down adjusts; Home/End selects the limits."
        />
        <section id="scene-timeline" className="scene-timeline" aria-label="Scene timeline">
          {scene ? (
            <SceneTimeline key={scene.id} scene={scene} document={document} registry={registry} playback={playback} />
          ) : (
            <p>Create a scene to arrange Actor actions.</p>
          )}
        </section>
      </main>
      <dialog ref={pasteDialog} className="workspace-dialog" aria-labelledby="paste-scene-title">
        <h2 id="paste-scene-title">Import scene JSON</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            runTransfer((signal) => importJson(pasteJson, signal));
          }}
        >
          <label>
            Scene JSON
            <textarea
              rows={16}
              cols={80}
              required
              value={pasteJson}
              onChange={(event) => setPasteJson(event.target.value)}
            />
          </label>
          <p className="workspace-caption">
            Character paths resolve from this editor page. Imports check all character metadata before replacing a
            working copy.
          </p>
          {document.validationIssues.length > 0 && (
            <p role="alert">{document.validationIssues.map(({ message }) => message).join(' ')}</p>
          )}
          <div className="scene-dialog-actions">
            <button type="button" disabled={loading} onClick={() => pasteDialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" disabled={loading}>
              Import scene
            </button>
          </div>
        </form>
      </dialog>
      <dialog ref={dialog} className="workspace-dialog" aria-labelledby="new-scene-title">
        <h2 id="new-scene-title">New Scene</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            const id = fields.get('id');
            const name = fields.get('name');
            if (
              document.createScene({
                id: typeof id === 'string' ? id : '',
                name: typeof name === 'string' ? name : '',
                duration: Number(fields.get('duration')) * 1000,
              })
            ) {
              dialog.current?.close();
              event.currentTarget.reset();
            }
          }}
        >
          <label>
            Scene ID
            <input ref={newId} name="id" required />
          </label>
          <label>
            Name
            <input name="name" defaultValue="Untitled Scene" required />
          </label>
          <label>
            Duration (seconds)
            <input name="duration" type="number" min="0.001" step="any" defaultValue="10" required />
          </label>
          {document.validationIssues.length > 0 && (
            <p role="alert">{document.validationIssues.map(({ message }) => message).join(' ')}</p>
          )}
          <div className="scene-dialog-actions">
            <button type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit">Create scene</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
