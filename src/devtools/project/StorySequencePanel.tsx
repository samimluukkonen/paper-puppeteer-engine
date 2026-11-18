import ArrowDown from 'lucide-react/icons/arrow-down';
import ArrowUp from 'lucide-react/icons/arrow-up';
import ListOrdered from 'lucide-react/icons/list-ordered';
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { safeFilename } from '../../engine/core.js';
import type { DeepReadonly, StoryDefinition } from '../../engine/data.js';
import { downloadBlob } from '../../shared/downloadJson.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { packageZipWorker } from '../shared/package/packageZipWorkerClient.js';
import { buildProjectStoryPackage } from './projectPackage.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';
import { storyDiagnostics } from './storyDiagnostics.js';

const StoryPreview = lazy(() => import('./StoryPreview.js'));

/** Project metadata owns the sequence; every source scene retains its own document and history. */
export function StorySequencePanel({
  workspace,
  busy,
  openScene,
}: {
  workspace: ProjectWorkspace;
  busy: boolean;
  openScene: (id: string) => void;
}) {
  useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  const stories = workspace.definition.stories ?? [];
  const [selected, setSelected] = useState('');
  const story = stories.find(({ id }) => id === selected) ?? stories[0];
  const [name, setName] = useState('');
  const [sceneId, setSceneId] = useState('');
  const [message, setMessage] = useState('');
  const transfer = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => transfer.current?.abort(), [workspace]);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<DeepReadonly<StoryDefinition>>();
  const createDialog = useRef<HTMLDialogElement>(null);
  const [newName, setNewName] = useState('');
  useEffect(() => setName(story?.name ?? ''), [story?.id, story?.name]);
  const availableScene = workspace.definition.scenes.some(({ id }) => id === sceneId)
    ? sceneId
    : (workspace.definition.scenes[0]?.id ?? '');
  const attempt = (operation: () => void): void => {
    try {
      operation();
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  // Inspection already traverses scene, character, animation, audio and artwork dependencies.
  const report = workspace.inspect('draft');
  const issues = story ? storyDiagnostics(report, story) : [];
  return (
    <section
      className="project-panel story-sequence"
      data-guide-id={GUIDE_TARGETS.projectStories}
      aria-label="Story Sequence"
    >
      <h2 className="workspace-heading-with-icon">
        <ListOrdered size={16} aria-hidden="true" />
        Story Sequence
      </h2>
      <div className="project-actions">
        <button
          className="workspace-primary"
          disabled={busy}
          onClick={() => {
            setNewName('');
            createDialog.current?.showModal();
          }}
        >
          New Story
        </button>
        <label>
          Story{' '}
          <select
            aria-label="Select story"
            disabled={busy || !stories.length}
            value={story?.id ?? ''}
            onChange={(event) => setSelected(event.target.value)}
          >
            {!stories.length && <option value="">No stories yet</option>}
            {stories.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !story?.scenes.length || issues.some(({ issue }) => issue.severity === 'error')}
          onClick={() => story && setPreview(story)}
        >
          Preview Entire Story
        </button>
        <button
          className="workspace-primary"
          disabled={
            busy || exporting || !story?.scenes.length || issues.some(({ issue }) => issue.severity === 'error')
          }
          onClick={() => {
            if (!story) return;
            const controller = new AbortController();
            transfer.current = controller;
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
            setExporting(true);
            setMessage('Preparing story package...');
            void buildProjectStoryPackage(workspace, story.id, signal)
              .then(async (files) => {
                const { bytes } = await packageZipWorker.encode(files, signal);
                signal.throwIfAborted();
                downloadBlob(
                  new Blob([bytes], { type: 'application/zip' }),
                  `${safeFilename(story.id, 'story')}.story.zip`,
                );
                setMessage('Story ZIP download started. Use Import Project for editable workspace backups.');
              })
              .catch((error: unknown) => {
                if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
              })
              .finally(() => setExporting(false));
          }}
        >
          {exporting ? 'Preparing story package...' : 'Download story package'}
        </button>
      </div>
      {!story && <p>Create a story, then add existing scenes in playback order.</p>}
      {story && (
        <>
          <form
            className="project-actions"
            onSubmit={(event) => {
              event.preventDefault();
              attempt(() => workspace.renameStory(story.id, name));
            }}
          >
            <label>
              Story name{' '}
              <input
                required
                maxLength={200}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button disabled={busy || name.trim() === story.name}>Rename Story</button>
          </form>
          <div className="project-actions" data-guide-id={GUIDE_TARGETS.projectStorySequence}>
            <label>
              Existing scene{' '}
              <select
                aria-label="Story scene"
                disabled={busy || !availableScene}
                value={availableScene}
                onChange={(event) => setSceneId(event.target.value)}
              >
                {!availableScene && <option value="">Create a scene first</option>}
                {workspace.definition.scenes.map(({ id }) => (
                  <option key={id} value={id}>
                    {workspace.scenes.scene(id)?.name ?? id}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="workspace-primary"
              disabled={busy || !availableScene}
              onClick={() =>
                attempt(() => {
                  workspace.addStoryScene(story.id, availableScene);
                })
              }
            >
              Add Scene
            </button>
          </div>
          <ol className="story-entries">
            {story.scenes.map((entry, index) => (
              <li key={entry.id}>
                <strong>
                  {workspace.scenes.scene(entry.sceneAssetId)?.name ?? `Missing scene: ${entry.sceneAssetId}`}
                </strong>
                <span className="workspace-caption">
                  {entry.id} · {entry.sceneAssetId}
                </span>
                <div className="project-actions">
                  <label>
                    Entry transition{' '}
                    <select
                      aria-label={`Entry ${index + 1} transition`}
                      disabled={busy}
                      value={entry.transition?.type ?? 'cut'}
                      onChange={(event) =>
                        attempt(() =>
                          workspace.setStorySceneTransition(
                            story.id,
                            entry.id,
                            event.target.value === 'fade'
                              ? { type: 'fade', duration: 600, color: '#000000' }
                              : { type: 'cut' },
                          ),
                        )
                      }
                    >
                      <option value="cut">Direct cut</option>
                      <option value="fade">Fade through color</option>
                    </select>
                  </label>
                  {entry.transition?.type === 'fade' && (
                    <>
                      <label>
                        Fade duration (ms){' '}
                        <input
                          type="number"
                          min={1}
                          max={60000}
                          step={100}
                          aria-label={`Entry ${index + 1} fade duration`}
                          disabled={busy}
                          value={entry.transition.duration}
                          onChange={(event) =>
                            attempt(() => {
                              if (entry.transition?.type === 'fade')
                                workspace.setStorySceneTransition(story.id, entry.id, {
                                  ...entry.transition,
                                  duration: Number(event.target.value),
                                });
                            })
                          }
                        />
                      </label>
                      <label>
                        Fade color{' '}
                        <input
                          type="color"
                          aria-label={`Entry ${index + 1} fade color`}
                          disabled={busy}
                          value={entry.transition.color}
                          onChange={(event) =>
                            attempt(() => {
                              if (entry.transition?.type === 'fade')
                                workspace.setStorySceneTransition(story.id, entry.id, {
                                  ...entry.transition,
                                  color: event.target.value,
                                });
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                  <button
                    aria-label={`Move entry ${index + 1} up`}
                    disabled={busy || index === 0}
                    onClick={() => attempt(() => workspace.reorderStoryScene(story.id, entry.id, index - 1))}
                  >
                    <ArrowUp size={16} aria-hidden="true" />
                    Up
                  </button>
                  <button
                    aria-label={`Move entry ${index + 1} down`}
                    disabled={busy || index === story.scenes.length - 1}
                    onClick={() => attempt(() => workspace.reorderStoryScene(story.id, entry.id, index + 1))}
                  >
                    <ArrowDown size={16} aria-hidden="true" />
                    Down
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      attempt(() => {
                        workspace.duplicateStoryScene(story.id, entry.id);
                      })
                    }
                  >
                    Duplicate entry
                  </button>
                  <button
                    className="workspace-danger"
                    disabled={busy}
                    onClick={() => attempt(() => workspace.removeStoryScene(story.id, entry.id))}
                  >
                    Remove entry
                  </button>
                  <button
                    disabled={busy || !workspace.scenes.scene(entry.sceneAssetId)}
                    onClick={() => openScene(entry.sceneAssetId)}
                  >
                    Open source scene
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {!story.scenes.length && <p>This story is an empty draft. Add a scene to preview it.</p>}
          <p className="workspace-caption">
            Each entry references a shared scene. Removing an entry keeps its source. Use Undo Project / Redo Project
            for sequence edits; scene edits use Scene Undo/Redo. Local draft recovery and Export Project include all
            stories.
          </p>
          {!!issues.length && (
            <details className="story-warnings">
              <summary>Story validation ({issues.length})</summary>
              <ul className="project-assets">
                {issues.map(({ issue, sceneId }, index) => (
                  <li key={index}>
                    <strong>
                      {issue.severity}: {issue.message}
                    </strong>
                    <span className="workspace-caption">
                      {issue.path} · {issue.advice}
                    </span>
                    {sceneId && workspace.scenes.scene(sceneId) && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          const source = workspace.scenes.scene(sceneId);
                          workspace.scenes.selectScene(sceneId);
                          const dialogue =
                            issue.asset.kind === 'dialogue'
                              ? issue.asset.id
                              : source?.dialogue?.[Number(/dialogue\[(\d+)\]/.exec(issue.path)?.[1])]?.id;
                          if (dialogue) workspace.scenes.selectDialogueLine(dialogue);
                          openScene(sceneId);
                        }}
                      >
                        Open source scene{issue.asset.kind === 'dialogue' ? ' / dialogue' : ''}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {message && <p role="alert">{message}</p>}
      <dialog ref={createDialog} className="workspace-dialog" aria-label="New Story">
        <h2>New Story</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            attempt(() => {
              setSelected(workspace.createStory(newName));
              createDialog.current?.close();
            });
          }}
        >
          <label>
            New story name{' '}
            <input
              autoFocus
              required
              maxLength={200}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <div className="project-actions">
            <button className="workspace-primary">Create Story</button>
            <button type="button" onClick={() => createDialog.current?.close()}>
              Cancel
            </button>
          </div>
          {message && <p role="alert">{message}</p>}
        </form>
      </dialog>
      {preview && (
        <Suspense fallback={<p role="status">Loading story preview…</p>}>
          <StoryPreview story={preview} workspace={workspace} close={() => setPreview(undefined)} />
        </Suspense>
      )}
    </section>
  );
}
