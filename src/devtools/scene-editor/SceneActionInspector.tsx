import { useEffect, useState, useSyncExternalStore } from 'react';
import { evaluateRootMotionAtElapsedTime, sceneActionDuration, type SceneActionDefinition } from '../../engine/core.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { SceneAnimationLibrary } from './SceneAnimationLibrary.js';
import type { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import type { ReadonlyScene, SceneEditorDocument } from './SceneEditorDocument.js';

type Action = ReadonlyScene['actions'][number];
function ActionProperties({
  action,
  scene,
  document,
  registry,
}: {
  action: Action;
  scene: ReadonlyScene;
  document: SceneEditorDocument;
  registry: SceneCharacterRegistry;
}) {
  const [draft, setDraft] = useState<SceneActionDefinition>(() => structuredClone(action));
  const [payload, setPayload] = useState(
    action.type === 'cue' && action.payload !== undefined ? JSON.stringify(action.payload, null, 2) : '',
  );
  const [copyTime, setCopyTime] = useState(String((action.time + sceneActionDuration(action)) / 1000));
  useEffect(() => {
    setDraft(structuredClone(action));
    setPayload(action.type === 'cue' && action.payload !== undefined ? JSON.stringify(action.payload, null, 2) : '');
    setCopyTime(String((action.time + sceneActionDuration(action)) / 1000));
  }, [action]);
  const actor = scene.actors.find((actor) => actor.id === draft.actorId);
  const clips = actor ? (registry.get(actor.character.manifest)?.animations ?? []) : [];
  const animation = draft.type === 'animation' ? clips.find((clip) => clip.name === draft.animation) : undefined;
  const hasRootMotion = !!animation?.rootMotion?.translationKeys.length;
  let displacement: { x: number; y: number } | undefined;
  let displacementError = '';
  if (draft.type === 'animation' && animation && hasRootMotion) {
    try {
      displacement = evaluateRootMotionAtElapsedTime(animation, draft.duration * draft.speed, {
        loop: draft.loop,
        playback: { mode: 'smooth' },
      });
    } catch (error) {
      displacementError = error instanceof Error ? error.message : String(error);
    }
  }
  const numberField = (label: string, value: number, update: (value: number) => void, min?: number) => (
    <label>
      {label}
      <input
        type="number"
        step="any"
        min={min}
        required
        value={Number.isNaN(value) ? '' : value}
        onChange={(event) => update(event.target.valueAsNumber)}
      />
    </label>
  );
  return (
    <details data-guide-id={GUIDE_TARGETS.sceneActionProperties}>
      <summary>Action properties · {action.type}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            if (draft.type === 'animation' && !clips.some((clip) => clip.name === draft.animation))
              throw new Error('Select a loaded animation for this Actor.');
            if (draft.type === 'animation' && draft.movementSource === 'rootMotion' && !hasRootMotion)
              throw new Error(
                'This animation has no root-motion translation keys. Choose scene-controlled movement or author root motion in Animation Editor.',
              );
            let next = draft;
            if (next.type === 'cue') {
              const { payload: _old, ...rest } = next;
              next = payload.trim() ? { ...rest, payload: JSON.parse(payload) } : rest;
            }
            document.updateAction(action.id, next);
          } catch (error) {
            document.reportError(error);
          }
        }}
      >
        <label>
          Action ID
          <input readOnly value={action.id} />
        </label>
        <label>
          Actor
          <input readOnly value={draft.actorId} />
        </label>
        {numberField('Start (seconds)', draft.time / 1000, (time) => setDraft({ ...draft, time: time * 1000 }), 0)}
        {'duration' in draft &&
          numberField(
            'Action duration (seconds)',
            draft.duration / 1000,
            (duration) => setDraft({ ...draft, duration: duration * 1000 }),
            0.000001,
          )}
        {draft.type === 'animation' && (
          <>
            <label>
              Animation ID
              <select
                value={draft.animation}
                required
                onChange={(event) => setDraft({ ...draft, animation: event.target.value })}
              >
                {!clips.some((clip) => clip.name === draft.animation) && (
                  <option value="" disabled>
                    Select an animation
                  </option>
                )}
                {clips.map((clip) => (
                  <option key={clip.name} value={clip.name}>
                    {clip.name}
                  </option>
                ))}
              </select>
            </label>
            {actor && registry.get(actor.character.manifest) && (
              <SceneAnimationLibrary
                definition={registry.get(actor.character.manifest)!}
                manifest={actor.character.manifest}
                onUse={(name) => setDraft({ ...draft, animation: name })}
              />
            )}
            <label>
              Movement source
              <select
                value={draft.movementSource ?? 'scene'}
                onChange={(event) =>
                  setDraft({ ...draft, movementSource: event.target.value === 'rootMotion' ? 'rootMotion' : 'scene' })
                }
              >
                <option value="scene">Scene-controlled</option>
                <option value="rootMotion" disabled={!hasRootMotion}>
                  Animation root motion
                </option>
              </select>
            </label>
            {displacement ? (
              <p className="workspace-caption">
                Root displacement (animation-local, over this window): X: {displacement.x > 0 ? '+' : ''}
                {displacement.x}; Y: {displacement.y > 0 ? '+' : ''}
                {displacement.y}. Facing and scale at clip start transform this travel into the world.
              </p>
            ) : (
              <p className="workspace-caption">
                {displacementError ||
                  'This animation has no root-motion translation keys. Author them in Animation Editor.'}
              </p>
            )}
            <p className="workspace-caption">
              Scene-controlled clips leave translation to scene movement. Animation root motion owns translation for the
              full window; overlapping movement is rejected.
            </p>
            <label>
              <input
                type="checkbox"
                checked={draft.loop}
                onChange={(event) => setDraft({ ...draft, loop: event.target.checked })}
              />
              Loop within duration
            </label>
            {numberField('Playback speed', draft.speed, (speed) => setDraft({ ...draft, speed }), 0.000001)}
            <p className="workspace-caption">
              Duration bounds playback. Non-looping clips play once and hold their final pose for the remaining window;
              longer clips are truncated. No duration is inferred from looping.
            </p>
          </>
        )}
        {draft.type === 'move' && (
          <>
            {numberField('Destination X', draft.destination.x, (x) =>
              setDraft({ ...draft, destination: { ...draft.destination, x } }),
            )}
            {numberField('Destination Y', draft.destination.y, (y) =>
              setDraft({ ...draft, destination: { ...draft.destination, y } }),
            )}
            <p className="workspace-caption">
              Destination is a future position. Initial Actor placement stays unchanged. Travel uses a straight line
              over the explicit duration, without owning animation or facing.
            </p>
          </>
        )}
        {draft.type === 'face' && (
          <>
            <label>
              Facing target
              <select
                value={draft.target.type}
                onChange={(event) => {
                  const type = event.target.value;
                  setDraft({
                    ...draft,
                    target:
                      type === 'direction'
                        ? { type, facing: 'right' }
                        : type === 'point'
                          ? { type, x: 0, y: 0 }
                          : {
                              type: 'actor',
                              actorId: scene.actors.find((actor) => actor.id !== draft.actorId)?.id ?? '',
                            },
                  });
                }}
              >
                <option value="direction">Direction</option>
                <option value="point">Point</option>
                <option value="actor" disabled={scene.actors.length < 2}>
                  Actor
                </option>
              </select>
            </label>
            {draft.target.type === 'direction' && (
              <label>
                Direction
                <select
                  value={draft.target.facing}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      target: { type: 'direction', facing: event.target.value === 'left' ? 'left' : 'right' },
                    })
                  }
                >
                  <option value="right">Right</option>
                  <option value="left">Left</option>
                </select>
              </label>
            )}
            {draft.target.type === 'actor' && (
              <label>
                Target Actor
                <select
                  value={draft.target.actorId}
                  onChange={(event) => setDraft({ ...draft, target: { type: 'actor', actorId: event.target.value } })}
                >
                  {scene.actors
                    .filter((actor) => actor.id !== draft.actorId)
                    .map((actor) => (
                      <option key={actor.id}>{actor.id}</option>
                    ))}
                </select>
              </label>
            )}
            {draft.target.type === 'point' && (
              <>
                {numberField('Target X', draft.target.x, (x) => {
                  if (draft.target.type === 'point') setDraft({ ...draft, target: { ...draft.target, x } });
                })}
                {numberField('Target Y', draft.target.y, (y) => {
                  if (draft.target.type === 'point') setDraft({ ...draft, target: { ...draft.target, y } });
                })}
              </>
            )}
          </>
        )}
        {draft.type === 'cue' && (
          <>
            <label>
              Cue name
              <input
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              Payload (JSON, optional)
              <textarea rows={5} value={payload} onChange={(event) => setPayload(event.target.value)} />
            </label>
            <p className="workspace-caption">
              Application metadata only. Scene cues are separate from events inside an animation.
            </p>
          </>
        )}
        {draft.type === 'wait' && (
          <p className="workspace-caption">Wait marks a scheduling interval; it acquires no Actor channels.</p>
        )}
        <button type="submit">Apply action properties</button>
      </form>
      <label>
        Duplicate at (seconds)
        <input
          type="number"
          min="0"
          step="any"
          required
          value={copyTime}
          onChange={(event) => setCopyTime(event.target.value)}
        />
      </label>
      <div className="scene-actor-actions">
        <button
          type="button"
          onClick={() => document.duplicateAction(action.id, copyTime.trim() ? Number(copyTime) * 1000 : NaN)}
        >
          Duplicate action
        </button>
        <button type="button" onClick={() => document.removeAction(action.id)}>
          Delete action
        </button>
      </div>
    </details>
  );
}

export function SceneActionInspector(props: {
  scene: ReadonlyScene;
  document: SceneEditorDocument;
  registry: SceneCharacterRegistry;
}) {
  useSyncExternalStore(props.registry.subscribe, props.registry.getSnapshot, props.registry.getSnapshot);
  const action = props.scene.actions.find((action) => action.id === props.document.selectedActionId);
  return action ? (
    <ActionProperties key={action.id} {...props} action={action} />
  ) : (
    <p className="workspace-caption">Select a timeline action to edit its properties.</p>
  );
}
