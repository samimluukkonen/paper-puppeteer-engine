import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CharacterDefinition } from '../../engine/CharacterDefinition.js';
import { projectEditorContext } from '../project/projectBridge.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { sceneCharacterChoices, type SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import type { ReadonlyScene, SceneEditorDocument } from './SceneEditorDocument.js';

type ActorData = ReadonlyScene['actors'][number];

function ActorProperties({
  actor,
  document,
  definition,
}: {
  actor: ActorData;
  document: SceneEditorDocument;
  definition: CharacterDefinition | undefined;
}) {
  const [id, setId] = useState(actor.id);
  const [x, setX] = useState(String(actor.position.x));
  const [y, setY] = useState(String(actor.position.y));
  useEffect(() => {
    setId(actor.id);
    setX(String(actor.position.x));
    setY(String(actor.position.y));
  }, [actor]);
  return (
    <details data-guide-id={GUIDE_TARGETS.sceneActorProperties}>
      <summary>Actor properties</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          document.updateActor(actor.id, {
            id,
            position: { x: x.trim() ? Number(x) : NaN, y: y.trim() ? Number(y) : NaN },
          });
        }}
      >
        <label>
          Actor ID / name
          <input required value={id} onChange={(event) => setId(event.target.value)} />
        </label>
        <label>
          Character reference
          <input value={actor.character.manifest} readOnly />
        </label>
        {definition && <p className="workspace-caption">Character definition: {definition.id}</p>}
        <label>
          Initial X<input type="number" step="any" required value={x} onChange={(event) => setX(event.target.value)} />
        </label>
        <label>
          Initial Y<input type="number" step="any" required value={y} onChange={(event) => setY(event.target.value)} />
        </label>
        <button type="submit">Apply actor properties</button>
      </form>
      <label>
        Facing
        <select
          value={actor.facing ?? 'right'}
          onChange={(event) => {
            document.updateActor(actor.id, { facing: event.target.value === 'left' ? 'left' : 'right' });
          }}
        >
          <option value="right">Right</option>
          <option value="left">Left</option>
        </select>
      </label>
      {!!definition?.animations.length && (
        <label>
          Initial animation
          <select
            value={actor.animation ?? ''}
            onChange={(event) => {
              document.setActorAppearance(actor.id, 'animation', event.target.value || null);
            }}
          >
            <option value="">Bind pose</option>
            {definition.animations.map((clip) => (
              <option key={clip.name}>{clip.name}</option>
            ))}
          </select>
        </label>
      )}
      {!!definition?.rig.skins.length && (
        <label>
          Initial skin
          <select
            value={actor.skin ?? ''}
            onChange={(event) => {
              document.setActorAppearance(actor.id, 'skin', event.target.value || null);
            }}
          >
            <option value="">Character default ({definition.defaultSkin})</option>
            {definition.rig.skins.map((skin) => (
              <option key={skin.name}>{skin.name}</option>
            ))}
          </select>
        </label>
      )}
      {!definition && <p>Loading character properties…</p>}
    </details>
  );
}

export function SceneActorsPanel({
  document,
  scene,
  registry,
}: {
  document: SceneEditorDocument;
  scene: ReadonlyScene;
  registry: SceneCharacterRegistry;
}) {
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const choices = projectEditorContext()?.choices ?? sceneCharacterChoices;
  const [manifest, setManifest] = useState(choices[0]?.manifest ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const actor = scene.actors.find((actor) => actor.id === document.selectedActorId);
  const selectedIndex = scene.actors.findIndex((actor) => actor.id === document.selectedActorId);
  return (
    <>
      <details data-guide-id={GUIDE_TARGETS.sceneActors}>
        <summary>Scene actors ({scene.actors.length})</summary>
        <button
          type="button"
          className="workspace-primary"
          data-guide-id={GUIDE_TARGETS.sceneAddActor}
          onClick={() => {
            setError('');
            dialog.current?.showModal();
          }}
        >
          + Add Actor
        </button>
        <ul className="scene-actor-list">
          {scene.actors.map((actor) => (
            <li key={actor.id}>
              <button
                type="button"
                aria-pressed={actor.id === document.selectedActorId}
                onClick={() => document.selectActor(actor.id)}
              >
                {actor.id} → {registry.get(actor.character.manifest)?.id ?? actor.character.manifest}
              </button>
            </li>
          ))}
        </ul>
        {!scene.actors.length && (
          <p>
            Choose + Add Actor to place a character instance. Character artwork and animations stay in their character
            editor.
          </p>
        )}
        {actor && (
          <div className="scene-actor-actions">
            <button
              type="button"
              onClick={() => {
                document.duplicateActor(actor.id);
              }}
            >
              Duplicate Actor
            </button>
            <button
              type="button"
              onClick={() => {
                const references = document.actorReferences(actor.id);
                if (
                  references.length &&
                  !window.confirm(
                    `Remove actor "${actor.id}" and its ${references.length} referenced scene action(s)? This can be undone.`,
                  )
                )
                  return;
                document.removeActor(actor.id, { removeActions: references.length > 0 });
              }}
            >
              Remove Actor
            </button>
            <button
              type="button"
              disabled={selectedIndex === 0}
              onClick={() => {
                document.reorderActor(actor.id, -1);
              }}
            >
              Send backward
            </button>
            <button
              type="button"
              disabled={selectedIndex === scene.actors.length - 1}
              onClick={() => {
                document.reorderActor(actor.id, 1);
              }}
            >
              Bring forward
            </button>
          </div>
        )}
      </details>
      {actor && (
        <ActorProperties
          key={actor.id}
          actor={actor}
          document={document}
          definition={registry.get(actor.character.manifest)}
        />
      )}
      <dialog
        ref={dialog}
        className="workspace-dialog"
        aria-labelledby="add-actor-title"
        onCancel={() => {
          request.current++;
          setLoading(false);
        }}
      >
        <h2 id="add-actor-title">Add Actor</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const current = ++request.current;
            setLoading(true);
            setError('');
            void registry
              .load(manifest)
              .then(() => {
                if (request.current !== current) return;
                if (document.addActor(manifest)) dialog.current?.close();
                else setError(document.validationIssues.map((issue) => issue.message).join(' '));
              })
              .catch((error: unknown) => {
                if (request.current === current) setError(error instanceof Error ? error.message : String(error));
              })
              .finally(() => {
                if (request.current === current) setLoading(false);
              });
          }}
        >
          <label>
            Workspace character
            <select
              value={choices.some((entry) => entry.manifest === manifest) ? manifest : ''}
              onChange={(event) => setManifest(event.target.value)}
              disabled={loading}
            >
              <option value="" disabled>
                Custom package
              </option>
              {choices.map((entry) => (
                <option key={entry.id} value={entry.manifest}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Character manifest
            <input required value={manifest} onChange={(event) => setManifest(event.target.value)} disabled={loading} />
          </label>
          <p className="workspace-caption">
            {projectEditorContext()
              ? 'Choose a registered project character. Add other characters from the project workspace.'
              : 'Choose a workspace package or enter a permanent character.json path/URL. Unsaved character drafts need an exported, hosted package first.'}
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="scene-dialog-actions">
            <button
              type="button"
              onClick={() => {
                request.current++;
                setLoading(false);
                dialog.current?.close();
              }}
            >
              Cancel
            </button>
            <button type="submit" disabled={loading}>
              {loading ? 'Loading character…' : 'Add actor'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
