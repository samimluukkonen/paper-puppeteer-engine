import { useEffect, useState, useSyncExternalStore } from 'react';
import { dialogueSpeaker, type SceneDialogueLine } from '../../engine/core.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';

function DialogueProperties({
  document,
  line,
  registry,
}: {
  document: SceneEditorDocument;
  line: Readonly<SceneDialogueLine>;
  registry?: SceneCharacterRegistry;
}) {
  const [draft, setDraft] = useState({ ...line });
  useEffect(() => setDraft({ ...line }), [line]);
  return (
    <details data-guide-id={GUIDE_TARGETS.sceneDialogueProperties}>
      <summary>Dialogue line · {line.id}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          document.dialogue.update(line.id, {
            text: draft.text,
            time: draft.time,
            duration: draft.duration,
            ...(draft.progression ? { progression: draft.progression } : {}),
            actorId: draft.actorId || null,
            speakerName: draft.speakerName || null,
            voiceClipId: draft.voiceClipId || null,
          });
        }}
      >
        <label>
          Line ID
          <input readOnly value={line.id} />
        </label>
        <div data-guide-id={GUIDE_TARGETS.sceneDialogueSpeaker}>
          <label>
            Speaker Actor
            <select
              aria-label="Speaker Actor"
              value={draft.actorId ?? ''}
              onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
            >
              <option value="">Narration (no Actor)</option>
              {document.workingScene?.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Speaker label
            <input
              maxLength={1000}
              value={draft.speakerName ?? ''}
              onChange={(event) => setDraft({ ...draft, speakerName: event.target.value })}
            />
          </label>
          <p className="workspace-caption">
            Label: {dialogueSpeaker(draft)}. An explicit label overrides the Actor ID; an unassociated line defaults to
            Narrator.
          </p>
        </div>
        <label data-guide-id={GUIDE_TARGETS.sceneDialogueText}>
          Dialogue text
          <textarea
            aria-label="Dialogue text"
            rows={5}
            maxLength={100000}
            value={draft.text}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          />
        </label>
        <div data-guide-id={GUIDE_TARGETS.sceneDialogueTiming}>
          <label>
            Dialogue progression
            <select
              aria-label="Dialogue progression"
              value={draft.progression ?? 'timed'}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  progression: event.target.value === 'advance-required' ? 'advance-required' : 'timed',
                })
              }
            >
              <option value="timed">Timed</option>
              <option value="advance-required">Wait for Enter</option>
            </select>
          </label>
          {(
            [
              ['time', 'Dialogue start'],
              ['duration', 'Dialogue duration'],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              {label} (seconds)
              <input
                type="number"
                required
                min={field === 'time' || draft.progression === 'advance-required' ? '0' : '0.000001'}
                step="any"
                value={Number.isNaN(draft[field]) ? '' : draft[field] / 1000}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.valueAsNumber * 1000 })}
              />
            </label>
          ))}
          <p className="workspace-caption">
            Timed lines cannot overlap. Wait for Enter lines may share a start and play in stable ID order. Their
            duration controls passive preview only; zero allows a point hold, including at scene end. Other overlapping
            intervals are rejected. Each line must end within scene duration.
          </p>
        </div>
        <div data-guide-id={GUIDE_TARGETS.sceneDialogueVoice}>
          <label>
            Voice reference
            <select
              aria-label="Voice reference"
              value={draft.voiceClipId ?? ''}
              onChange={(event) => setDraft({ ...draft, voiceClipId: event.target.value })}
            >
              <option value="">None</option>
              {document.workingScene?.audioClips?.map((clip) => (
                <option key={clip.id} value={clip.id}>
                  {clip.id} · {document.audioAssets.find((asset) => asset.id === clip.assetId)?.name ?? clip.assetId}
                </option>
              ))}
            </select>
          </label>
          <p className="workspace-caption">Voice reference is metadata. Place and time sound on the audio timeline.</p>
        </div>
        <button type="submit">Apply dialogue properties</button>
      </form>
      {draft.progression === 'advance-required' && (
        <DialogueHoldSettings document={document} line={draft} {...(registry ? { registry } : {})} />
      )}
      <div className="scene-audio-actions" data-guide-id={GUIDE_TARGETS.sceneDialogueActions}>
        <button type="button" onClick={() => document.dialogue.duplicate(line.id)}>
          Duplicate dialogue line
        </button>
        <button type="button" className="workspace-danger" onClick={() => document.dialogue.remove(line.id)}>
          Delete dialogue line
        </button>
      </div>
      <p className="workspace-caption">
        Timed lines use scene time. Wait for Enter pauses playback until Enter is pressed or Advance dialogue is
        clicked. Duplicate places the copy in the next available interval after this line. Play or scrub to preview
        subtitles; Pause holds the current line and Stop clears it. Scrubbing stays silent and never waits for input.
      </p>
    </details>
  );
}

function DialogueHoldSettings({
  document,
  line,
  registry,
}: {
  document: SceneEditorDocument;
  line: Readonly<SceneDialogueLine>;
  registry?: SceneCharacterRegistry;
}) {
  const scene = document.workingScene;
  const [selected, setSelected] = useState(line.actorId ?? '');
  const actor =
    scene?.actors.find(({ id }) => id === selected) ??
    scene?.actors.find(({ id }) => id === line.actorId) ??
    scene?.actors[0];
  const definition = actor && registry?.get(actor.character.manifest);
  const clips =
    scene?.audioClips?.filter(
      (clip) =>
        clip.playback === 'dialogue-hold' &&
        clip.time <= line.time &&
        (line.time < clip.time + clip.duration ||
          (line.time === scene.duration && line.time === clip.time + clip.duration)),
    ) ?? [];
  return (
    <div className="scene-dialogue-hold-settings">
      <p className="workspace-caption">
        The scene clock freezes at this line. Enter advances one line. Stop or scrub to return to ordinary editing.
        Apply dialogue properties to save progression changes.
      </p>
      {actor && (
        <>
          <label>
            Hold Actor{' '}
            <select
              aria-label="Dialogue hold Actor"
              value={actor.id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {scene?.actors.map(({ id }) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Actor idle during holds{' '}
            <select
              aria-label="Actor idle during holds"
              disabled={!definition}
              value={actor.dialogueIdle?.animation ?? ''}
              onChange={(event) => document.setActorAppearance(actor.id, 'dialogueIdle', event.target.value || null)}
            >
              <option value="">Hold cinematic pose</option>
              {definition?.animations.map(({ name }) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p className="workspace-caption">
            Applies immediately to this Actor during every dialogue hold in this scene. Only tracked pose channels loop;
            movement and animation events are ignored. Scene Undo restores the selection.
          </p>
        </>
      )}
      <p className="workspace-caption">
        Ordinary audio pauses. Only dedicated Music / Ambience hold loops play while waiting. Configure their
        eligibility window in the Audio inspector.
      </p>
      {clips.length ? (
        <ul>
          {clips.map((clip) => (
            <li key={clip.id}>
              <button onClick={() => document.selectAudioClip(clip.id)}>Edit hold audio · {clip.id}</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="workspace-caption">No hold audio at this line.</p>
      )}
    </div>
  );
}

const noSubscribe = () => () => {};
const zero = () => 0;
export function SceneDialogueInspector({
  document,
  registry,
}: {
  document: SceneEditorDocument;
  registry?: SceneCharacterRegistry;
}) {
  useSyncExternalStore(
    registry?.subscribe ?? noSubscribe,
    registry?.getSnapshot ?? zero,
    registry?.getSnapshot ?? zero,
  );
  const line = document.selectedDialogueLine;
  return line ? (
    <DialogueProperties key={line.id} document={document} line={line} {...(registry ? { registry } : {})} />
  ) : (
    <details data-guide-id={GUIDE_TARGETS.sceneDialogueProperties}>
      <summary>Dialogue line</summary>
      <div data-guide-id={GUIDE_TARGETS.sceneDialogueText}>
        <p className="workspace-caption">
          No lines yet? Add Dialogue Line at the playhead, then select a line to edit multiline plain text in any
          language. Intentional line breaks and whitespace are preserved.
        </p>
      </div>
      <div data-guide-id={GUIDE_TARGETS.sceneDialogueSpeaker}>
        <p className="workspace-caption">
          Select a line to choose a scene-local Speaker Actor or Narration (no Actor). An optional Speaker label
          overrides the Actor ID or Narrator label.
        </p>
      </div>
      <div data-guide-id={GUIDE_TARGETS.sceneDialogueTiming}>
        <p className="workspace-caption">
          Select a line to set Dialogue progression, Dialogue start and Dialogue duration in seconds. Timed lines cannot
          overlap. Wait for Enter lines may share a start in stable ID order; other overlaps are rejected. Their
          duration controls passive preview, with zero allowed at scene end. Each line must end within scene duration.
        </p>
      </div>
      <div data-guide-id={GUIDE_TARGETS.sceneDialogueVoice}>
        <p className="workspace-caption">
          A selected line can reference an existing audio clip. Voice reference is metadata; place and time sound on the
          audio timeline.
        </p>
      </div>
      <div data-guide-id={GUIDE_TARGETS.sceneDialogueActions}>
        <p className="workspace-caption">
          Select a line to Duplicate dialogue line or Delete dialogue line. Scene Undo/Redo restores edits; duplication
          finds the next gap that fits the whole interval.
        </p>
      </div>
    </details>
  );
}
