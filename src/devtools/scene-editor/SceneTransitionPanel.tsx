import { useEffect, useState } from 'react';
import type { SceneTransition } from '../../engine/sceneTransitions.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';

function TransitionProperties({
  effect,
  document,
}: {
  effect: Readonly<SceneTransition>;
  document: SceneEditorDocument;
}) {
  const [draft, setDraft] = useState({ ...effect });
  useEffect(() => setDraft({ ...effect }), [effect]);
  return (
    <details data-guide-id={GUIDE_TARGETS.sceneTransitionProperties}>
      <summary>Transition properties · {effect.type === 'fade-in' ? 'Fade in' : 'Fade out'}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const { id: _id, ...properties } = draft;
          document.updateTransition(effect.id, properties);
        }}
      >
        <label>
          Transition ID
          <input readOnly value={effect.id} />
        </label>
        <div data-guide-id={GUIDE_TARGETS.sceneTransitionTiming}>
          <label>
            Fade start (seconds)
            <input
              type="number"
              min="0"
              step="any"
              required
              value={Number.isNaN(draft.time) ? '' : draft.time / 1000}
              onChange={(event) => setDraft({ ...draft, time: event.target.valueAsNumber * 1000 })}
            />
          </label>
          <label>
            Fade duration (seconds)
            <input
              type="number"
              min="0.000001"
              step="any"
              required
              value={Number.isNaN(draft.duration) ? '' : draft.duration / 1000}
              onChange={(event) => setDraft({ ...draft, duration: event.target.valueAsNumber * 1000 })}
            />
          </label>
        </div>
        <div data-guide-id={GUIDE_TARGETS.sceneTransitionAppearance}>
          <label>
            Fade type
            <select
              value={draft.type}
              onChange={(event) =>
                setDraft({ ...draft, type: event.target.value === 'fade-in' ? 'fade-in' : 'fade-out' })
              }
            >
              <option value="fade-in">Fade in from color</option>
              <option value="fade-out">Fade out to color</option>
            </select>
          </label>
          <label>
            Fade color
            <input
              type="color"
              value={draft.color}
              onChange={(event) => setDraft({ ...draft, color: event.target.value })}
            />
          </label>
        </div>
        <button type="submit">Apply transition properties</button>
      </form>
      <p className="workspace-caption">
        Fade out holds its color until a later fade. Add a fade in after a hold to reveal the scene. Fade intervals
        cannot overlap.
      </p>
      <button type="button" className="workspace-danger" onClick={() => document.removeTransition(effect.id)}>
        Delete transition
      </button>
    </details>
  );
}

export function SceneTransitionPanel({ document }: { document: SceneEditorDocument }) {
  const effect = document.selectedTransition;
  return effect ? (
    <TransitionProperties key={effect.id} effect={effect} document={document} />
  ) : (
    <details data-guide-id={GUIDE_TARGETS.sceneTransitionProperties}>
      <summary>Transition properties</summary>
      <div data-guide-id={GUIDE_TARGETS.sceneTransitionTiming}>
        <p className="workspace-caption">
          Select a fade in the Transitions track to edit its start and duration. No fades yet? Choose Effect type and
          Add effect at the playhead after exiting the guide.
        </p>
      </div>
      <div data-guide-id={GUIDE_TARGETS.sceneTransitionAppearance}>
        <p className="workspace-caption">
          A selected fade exposes direction and color controls. Fade in reveals the scene from color; Fade out covers
          it. Apply transition properties commits the edit.
        </p>
      </div>
    </details>
  );
}
