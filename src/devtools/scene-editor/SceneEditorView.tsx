import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { readJsonFile } from '../../engine/jsonInput.js';
import { downloadJson } from '../../shared/downloadJson.js';
import { ViewHeader } from '../../ui/viewShell.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { SceneActionInspector } from './SceneActionInspector.js';
import { SceneActorsPanel } from './SceneActorsPanel.js';
import type { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import type { SceneEditorDocument, ReadonlyScene } from './SceneEditorDocument.js';
import { SceneStageView } from './SceneStage.js';
import { SceneTimeline } from './SceneTimeline.js';
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
    <details>
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
  const workspace = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const layout = new SceneWorkspaceLayoutController(workspace.current!);
    return () => layout.dispose();
  }, []);
  const newId = useRef<HTMLInputElement>(null);
  const importRequest = useRef(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => protectUnsavedChanges(() => document.hasUnsavedChanges), [document]);
  useEffect(
    () => () => {
      importRequest.current++;
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
  const download = (): void => {
    try {
      const snapshot = document.workingScene;
      if (!snapshot) return;
      const json = document.exportJson();
      downloadJson(json, `${snapshot.id.replace(/[^a-zA-Z0-9._-]/g, '_')}.scene.json`);
      document.markSaved(snapshot);
    } catch (error) {
      document.reportError(error);
    }
  };
  return (
    <>
      <ViewHeader view="scene" />
      <div className="workspace-command-bar" aria-label="Scene document commands">
        <button type="button" onClick={openNew}>
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
              const request = ++importRequest.current;
              setLoading(true);
              void readJsonFile(file)
                .then((json) => {
                  if (request === importRequest.current) document.importJson(json, { confirmDiscard });
                })
                .catch((error: unknown) => {
                  if (request === importRequest.current) document.reportError(error);
                })
                .finally(() => {
                  if (request === importRequest.current) setLoading(false);
                });
            }}
          />
        </label>
        <label>
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
        <button type="button" disabled={!scene} onClick={download}>
          Download scene JSON
        </button>
      </div>
      <p className="workspace-caption" role="status">
        {scene
          ? `${scene.name} · ${scene.id} · ${scene.duration / 1000} s · ${document.isNewScene ? 'New / Unsaved' : document.dirty ? 'Unsaved changes' : 'Saved'}`
          : 'Create a new scene or open a scene JSON document.'}
        {scene && ' Switch scenes to keep working; download each scene to keep it after leaving this page.'}
      </p>
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
        <section className="scene-stage" aria-label="Scene stage">
          {scene ? (
            <SceneStageView document={document} registry={registry} />
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
            <SceneTimeline key={scene.id} scene={scene} document={document} registry={registry} />
          ) : (
            <p>Create a scene to arrange Actor actions.</p>
          )}
        </section>
      </main>
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
