import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { readJsonFile } from '../../engine/core.js';
import type { SceneCharacterAssets, SceneDefinition } from '../../engine/data.js';
import { downloadJson } from '../../shared/downloadJson.js';
import { projectEditorContext } from '../project/projectBridge.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import {
  captureChoreography,
  captureSceneTemplate,
  createSceneFromTemplate,
  insertChoreography,
  parseSceneReuseLibrary,
  type SceneReuseLibrary,
} from '../shared/sceneReuse.js';
import type { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import { SceneEditorDocument, type ReadonlyScene } from './SceneEditorDocument.js';
import { SceneEditorPlayback } from './SceneEditorPlayback.js';
import { ScenePlaybackControls, SceneTimeInput } from './ScenePlaybackControls.js';
import { SceneStageView } from './SceneStage.js';

type Preview = {
  kind: 'choreography' | 'template';
  scene: SceneDefinition;
  document: SceneEditorDocument;
  playback: SceneEditorPlayback;
  source: ReadonlyScene | null;
};

function DetachedPreview({ preview, registry }: { preview: Preview; registry: SceneCharacterRegistry }) {
  useEffect(() => () => preview.playback.dispose(), [preview]);
  return (
    <>
      <p className="workspace-caption">
        Detached preview · muted audio · scene cues have no host handlers. Changes here are discarded.
      </p>
      <div className="scene-timeline-toolbar">
        <ScenePlaybackControls playback={preview.playback} />
        <SceneTimeInput playback={preview.playback} duration={preview.scene.duration} />
      </div>
      <div className="scene-reuse-preview">
        <SceneStageView
          canvasId="scene-reuse-stage-canvas"
          document={preview.document}
          registry={registry}
          playback={preview.playback}
        />
      </div>
    </>
  );
}

/** Authoring-only library: independent copies use the ordinary scene editor and runtime preview. */
export function SceneReusePanel({
  document,
  registry,
  playback,
  close,
}: {
  document: SceneEditorDocument;
  registry: SceneCharacterRegistry;
  playback: SceneEditorPlayback;
  close(this: void): void;
}) {
  const project = projectEditorContext();
  useSyncExternalStore(document.subscribe, document.getSnapshot, document.getSnapshot);
  const [, refresh] = useState(0);
  useEffect(() => project?.subscribe(() => refresh((value) => value + 1)), [project]);
  const library = project?.sceneReuse ?? document.sceneReuse;
  const scene = document.workingScene;
  const selectedActionIds = document.selectedActionIds;
  const selectedActionSet = new Set(selectedActionIds);
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    dialog.current?.showModal();
    playback.pause();
  }, [playback]);
  const [name, setName] = useState('New choreography');
  const [mode, setMode] = useState<'relative' | 'absolute'>('relative');
  const [camera, setCamera] = useState(false);
  const [transitions, setTransitions] = useState(false);
  const [audioDialogue, setAudioDialogue] = useState(false);
  const [templateName, setTemplateName] = useState('New scene template');
  const [templateActors, setTemplateActors] = useState(true);
  const [templateTimeline, setTemplateTimeline] = useState(false);
  const [templateAudio, setTemplateAudio] = useState(false);
  const [roleNames, setRoleNames] = useState<Record<string, string>>({});
  const [sourceOrigins, setSourceOrigins] = useState<Record<string, { x: number; y: number }>>({});
  const [presetId, setPresetId] = useState(library.choreographies[0]?.id ?? '');
  const preset = library.choreographies.find((entry) => entry.id === presetId);
  const [templateId, setTemplateId] = useState(library.templates[0]?.id ?? '');
  const template = library.templates.find((entry) => entry.id === templateId);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [origins, setOrigins] = useState<Record<string, { x: number; y: number }>>({});
  const [time, setTime] = useState(playback.time / 1000);
  const [newId, setNewId] = useState(`scene-${crypto.randomUUID()}`);
  const [newName, setNewName] = useState('Scene from template');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const request = useRef(0);
  const invalidate = () => {
    request.current++;
    setPreview(undefined);
  };
  useEffect(() => {
    invalidate();
  }, [scene, library, presetId, templateId, actors, origins, time, newId, newName]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const rigIdentity = (manifest: string) => {
    const choice = project?.choices.find((choice) => choice.manifest === manifest);
    return choice ? `${project!.projectId ?? 'project'}:${choice.rigIdentity ?? choice.id}` : manifest;
  };
  const save = (next: SceneReuseLibrary) => {
    if (project?.saveSceneReuse) project.saveSceneReuse(next);
    else document.setSceneReuse(next);
    invalidate();
  };
  const attempt = (operation: () => void) => {
    try {
      operation();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const selectedActors =
    scene?.actors.filter((actor) =>
      scene.actions.some(
        (action) =>
          selectedActionSet.has(action.id) &&
          (action.actorId === actor.id ||
            (action.type === 'face' && action.target.type === 'actor' && action.target.actorId === actor.id)),
      ),
    ) ?? [];
  const validation = (kind: 'choreography' | 'template') => {
    const characters = new Map<string, SceneCharacterAssets>();
    for (const actor of kind === 'template' ? (template?.scene.actors ?? []) : (scene?.actors ?? [])) {
      const definition = registry.get(actor.character.manifest);
      if (!definition)
        throw new Error(`Character metadata is unavailable for ${actor.id}. Reload or repair the character.`);
      characters.set(actor.character.manifest, {
        animations: definition.animations.map((clip) => clip.name),
        rootMotionAnimations: definition.animations
          .filter((clip) => clip.rootMotion?.translationKeys.length)
          .map((clip) => clip.name),
        skins: [...definition.standaloneSkins, ...(definition.rig.skins ?? [])].map((skin) => skin.name),
      });
    }
    return {
      characters,
      images: new Set(document.images.entries.map((image) => image.reference)),
      ...(project ? { getAudioAssets: () => document.audioAssets } : {}),
    };
  };
  const proposal = (kind: 'choreography' | 'template') => {
    if (kind === 'template' && document.sceneIds.includes(newId))
      throw new Error(`Scene ID "${newId}" already exists. Choose a new scene ID.`);
    const options = validation(kind);
    const candidate =
      kind === 'choreography'
        ? scene &&
          preset &&
          insertChoreography(scene, preset, { time: time * 1000, actors, origins, rigIdentity, validation: options })
        : template && createSceneFromTemplate(template, { id: newId, name: newName }, options);
    if (!candidate) throw new Error('Choose a reusable asset and destination scene.');
    project?.validateScene(candidate);
    return candidate;
  };
  const showPreview = async (kind: 'choreography' | 'template') => {
    const generation = ++request.current;
    setBusy(true);
    setPreview(undefined);
    setMessage('Checking references…');
    try {
      const required = kind === 'template' ? template?.scene.actors : scene?.actors;
      await Promise.all(
        [...new Set(required?.map((actor) => actor.character.manifest))].map((manifest) => registry.load(manifest)),
      );
      if (generation !== request.current) return;
      const candidate = proposal(kind);
      const detached = new SceneEditorDocument();
      if (!detached.createSceneCopy(candidate))
        throw new Error(detached.validationIssues.map((issue) => issue.message).join(' '));
      for (const image of candidate.images ?? [])
        detached.images.register(image.image, document.images.read(image.image));
      for (const asset of candidate.audioAssets ?? [])
        detached.registerAudio(asset.path, document.readAudio(asset.path));
      detached.setCameraPreview(true);
      const player = new SceneEditorPlayback();
      player.setAudioMuted(true);
      setPreview({ kind, scene: candidate, document: detached, playback: player, source: scene });
      setMessage(
        kind === 'choreography'
          ? 'Preview is valid. Confirm insertion to add one Undo step.'
          : 'Preview is valid. Create the independent scene when ready.',
      );
    } catch (error) {
      if (generation === request.current) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog scene-reuse-dialog"
      aria-labelledby="scene-reuse-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id="scene-reuse-title">Choreography and scene templates</h2>
      <p className="workspace-caption">
        {project
          ? 'Saved in this project, including project exports and local drafts.'
          : 'Download the library JSON to keep presets and templates. Scene JSON does not include this library.'}{' '}
        Shared character, artwork and audio assets stay referenced.
      </p>
      <fieldset disabled={busy} className="scene-reuse-fields">
        <details data-guide-id={GUIDE_TARGETS.sceneReuseSave}>
          <summary>Save selected actions as choreography ({selectedActionIds.length})</summary>
          <p className="workspace-caption">
            Ctrl/Cmd/Shift-click timeline actions before opening this panel. Optional tracks copy only complete items
            inside the selected action range.
          </p>
          <label>
            Preset name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Position semantics
            <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="relative">Relative to role origins</option>
              <option value="absolute">Absolute scene-world positions</option>
            </select>
          </label>
          <p className="workspace-caption">
            Origins default to authored initial Actor positions. For a sequence after earlier movement, enter each
            Actor’s position at the sequence start. At insertion, set its destination origin. Animation root motion
            stays owned by its clip and is never added to these offsets.
          </p>
          {selectedActors.map((actor) => (
            <div key={actor.id} className="scene-reuse-role">
              <label>
                Role for {actor.id}
                <input
                  value={roleNames[actor.id] ?? actor.id}
                  onChange={(event) => setRoleNames({ ...roleNames, [actor.id]: event.target.value })}
                />
              </label>
              {(['x', 'y'] as const).map((axis) => (
                <label key={axis}>
                  Source origin {axis.toUpperCase()}
                  <input
                    type="number"
                    step="any"
                    value={(sourceOrigins[actor.id] ?? actor.position)[axis]}
                    onChange={(event) =>
                      setSourceOrigins({
                        ...sourceOrigins,
                        [actor.id]: {
                          ...(sourceOrigins[actor.id] ?? actor.position),
                          [axis]: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          ))}
          <label>
            <input type="checkbox" checked={camera} onChange={(event) => setCamera(event.target.checked)} />
            Include camera keys (absolute values)
          </label>
          <label>
            <input type="checkbox" checked={transitions} onChange={(event) => setTransitions(event.target.checked)} />
            Include fades
          </label>
          <label>
            <input
              type="checkbox"
              checked={audioDialogue}
              onChange={(event) => setAudioDialogue(event.target.checked)}
            />
            Include audio and dialogue
          </label>
          <button
            type="button"
            disabled={!scene || !selectedActionIds.length || !name.trim()}
            onClick={() =>
              attempt(() => {
                const entry = captureChoreography(scene!, {
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  actionIds: selectedActionIds,
                  positionMode: mode,
                  rigIdentity,
                  origins: sourceOrigins,
                  roleNames,
                  includeCamera: camera,
                  includeTransitions: transitions,
                  includeAudioDialogue: audioDialogue,
                });
                save(parseSceneReuseLibrary({ ...library, choreographies: [...library.choreographies, entry] }));
                setPresetId(entry.id);
                setMessage(`Saved choreography “${entry.name}”.`);
              })
            }
          >
            Save Selected Actions as Choreography
          </button>
        </details>
        <details data-guide-id={GUIDE_TARGETS.sceneReuseInsert}>
          <summary>Insert choreography ({library.choreographies.length})</summary>
          <label>
            Choreography
            <select
              value={presetId}
              onChange={(event) => {
                setPresetId(event.target.value);
                setActors({});
                setOrigins({});
              }}
            >
              <option value="">Choose a preset</option>
              {library.choreographies.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          {preset && (
            <>
              <p>
                {preset.roles.length} required Actors · {preset.scene.duration / 1000} s · {preset.positionMode}{' '}
                positions
              </p>
              <ul>
                {preset.scene.actions
                  .filter((action) => action.type === 'animation')
                  .map((action) => (
                    <li key={action.id}>
                      {action.animation} ·{' '}
                      {action.movementSource === 'rootMotion'
                        ? 'Animation root motion owns translation'
                        : 'Scene movement owns translation'}
                    </li>
                  ))}
              </ul>
              {preset.roles.map((role) => {
                const actor = scene?.actors.find((actor) => actor.id === actors[role.id]);
                return (
                  <div key={role.id} className="scene-reuse-role">
                    <label>
                      {role.name}
                      <select
                        value={actors[role.id] ?? ''}
                        onChange={(event) => {
                          setActors({ ...actors, [role.id]: event.target.value });
                          setOrigins((previous) => {
                            const next = { ...previous };
                            delete next[role.id];
                            return next;
                          });
                        }}
                      >
                        <option value="">Assign Actor</option>
                        {scene?.actors.map((actor) => (
                          <option key={actor.id} value={actor.id}>
                            {actor.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    {actor &&
                      preset.positionMode === 'relative' &&
                      (['x', 'y'] as const).map((axis) => (
                        <label key={axis}>
                          Destination origin {axis.toUpperCase()}
                          <input
                            type="number"
                            step="any"
                            value={(origins[role.id] ?? actor.position)[axis]}
                            onChange={(event) =>
                              setOrigins({
                                ...origins,
                                [role.id]: {
                                  ...(origins[role.id] ?? actor.position),
                                  [axis]: Number(event.target.value),
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                  </div>
                );
              })}
              <p className="workspace-caption">
                Different rigs require an explicit Animation Library retarget workflow. Preview reports missing
                animations, audio, incompatible rigs and ownership collisions.
              </p>
            </>
          )}
          <label>
            Insertion time (seconds)
            <input
              type="number"
              min="0"
              step="any"
              value={time}
              onChange={(event) => setTime(Number(event.target.value))}
            />
          </label>
          <div className="scene-dialog-actions">
            <button
              type="button"
              disabled={!preset || !scene}
              onClick={() => {
                void showPreview('choreography');
              }}
            >
              Preview choreography
            </button>
            <button
              type="button"
              className="workspace-primary"
              disabled={preview?.kind !== 'choreography' || preview.source !== scene || preview.scene.id !== scene?.id}
              onClick={() =>
                attempt(() => {
                  if (document.replaceScene(proposal('choreography'))) {
                    invalidate();
                    setMessage('Choreography inserted. Undo restores the destination in one step.');
                  }
                })
              }
            >
              Confirm insertion
            </button>
            <button
              type="button"
              disabled={!preset}
              onClick={() =>
                attempt(() => {
                  save(
                    parseSceneReuseLibrary({
                      ...library,
                      choreographies: library.choreographies.filter((entry) => entry.id !== presetId),
                    }),
                  );
                  setPresetId('');
                  setMessage('Preset removed. Inserted copies are independent.');
                })
              }
            >
              Remove preset
            </button>
          </div>
        </details>
        <details data-guide-id={GUIDE_TARGETS.sceneReuseTemplate}>
          <summary>Scene templates ({library.templates.length})</summary>
          <label>
            Template name
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={templateActors}
              onChange={(event) => setTemplateActors(event.target.checked)}
            />
            Include Actors
          </label>
          <label>
            <input
              type="checkbox"
              checked={templateTimeline}
              onChange={(event) => setTemplateTimeline(event.target.checked)}
            />
            Include action, camera and fade timeline
          </label>
          <label>
            <input
              type="checkbox"
              checked={templateAudio}
              onChange={(event) => setTemplateAudio(event.target.checked)}
            />
            Include audio and dialogue
          </label>
          <button
            type="button"
            disabled={!scene || !templateName.trim()}
            onClick={() =>
              attempt(() => {
                const entry = captureSceneTemplate(scene!, {
                  id: crypto.randomUUID(),
                  name: templateName.trim(),
                  actors: templateActors,
                  timeline: templateTimeline,
                  audioDialogue: templateAudio,
                });
                save(parseSceneReuseLibrary({ ...library, templates: [...library.templates, entry] }));
                setTemplateId(entry.id);
                setMessage(`Saved scene template “${entry.name}”.`);
              })
            }
          >
            Save Scene as Template
          </button>
          <label>
            Scene template
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              <option value="">Choose a template</option>
              {library.templates.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          {template && (
            <p>
              {template.scene.actors.length} Actors · {template.scene.actions.length} actions ·{' '}
              {template.scene.duration / 1000} s
            </p>
          )}
          <label>
            New scene ID
            <input value={newId} onChange={(event) => setNewId(event.target.value)} />
          </label>
          <label>
            New scene name
            <input value={newName} onChange={(event) => setNewName(event.target.value)} />
          </label>
          <div className="scene-dialog-actions">
            <button
              type="button"
              disabled={!template}
              onClick={() => {
                void showPreview('template');
              }}
            >
              Preview template
            </button>
            <button
              type="button"
              className="workspace-primary"
              disabled={!template || preview?.kind !== 'template' || preview.scene.id !== newId}
              onClick={() =>
                attempt(() => {
                  const next = proposal('template');
                  if (project?.createSceneCopy) project.createSceneCopy(next);
                  else if (!document.createSceneCopy(next)) return;
                  invalidate();
                  setNewId(`scene-${crypto.randomUUID()}`);
                  setMessage('Created an independent scene. Template and source are unchanged.');
                })
              }
            >
              Create Scene from Template
            </button>
            <button
              type="button"
              disabled={!template}
              onClick={() =>
                attempt(() => {
                  save(
                    parseSceneReuseLibrary({
                      ...library,
                      templates: library.templates.filter((entry) => entry.id !== templateId),
                    }),
                  );
                  setTemplateId('');
                  setMessage('Template removed. Created scenes are independent.');
                })
              }
            >
              Remove template
            </button>
          </div>
        </details>
        <details>
          <summary>Transfer library JSON</summary>
          <p className="workspace-caption">
            Library JSON contains authored presets and templates with shared asset references. It does not include
            image, audio or character binaries. Import merges independent entries; duplicate IDs are rejected.
          </p>
          <button
            type="button"
            onClick={() => downloadJson(JSON.stringify(library, null, 2), 'scene-reuse-library.json')}
          >
            Download library JSON
          </button>
          <label className="scene-open">
            Import library JSON
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file)
                  void readJsonFile(file)
                    .then((json) =>
                      attempt(() => {
                        const incoming = parseSceneReuseLibrary(JSON.parse(json) as unknown);
                        const current = project?.sceneReuse ?? document.sceneReuse;
                        save(
                          parseSceneReuseLibrary({
                            version: 1,
                            choreographies: [...current.choreographies, ...incoming.choreographies],
                            templates: [...current.templates, ...incoming.templates],
                          }),
                        );
                        setMessage('Library imported. Preview to check shared assets in this project.');
                      }),
                    )
                    .catch((error: unknown) => setMessage(String(error)));
              }}
            />
          </label>
        </details>
      </fieldset>
      <p role="status">{message}</p>
      {preview && <DetachedPreview preview={preview} registry={registry} />}
      <div className="scene-dialog-actions">
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </dialog>
  );
}
