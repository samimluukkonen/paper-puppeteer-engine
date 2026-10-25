import { useEffect, useState } from 'react';
import { dialogueSpeaker, type SceneDialogueLine } from '../../engine/sceneDialogue.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';

function DialogueProperties({ document, line }: { document: SceneEditorDocument; line: Readonly<SceneDialogueLine> }) {
  const [draft, setDraft] = useState({ ...line });
  useEffect(() => setDraft({ ...line }), [line]);
  return (
    <details data-guide-id={GUIDE_TARGETS.sceneDialogueProperties}>
      <summary>Dialogue line · {line.id}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          document.updateDialogueLine(line.id, {
            text: draft.text,
            time: draft.time,
            duration: draft.duration,
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
                min={field === 'time' ? '0' : '0.000001'}
                step="any"
                value={Number.isNaN(draft[field]) ? '' : draft[field] / 1000}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.valueAsNumber * 1000 })}
              />
            </label>
          ))}
          <p className="workspace-caption">
            Lines cannot overlap. Adjacent intervals are allowed; each line must end within scene duration.
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
      <div className="scene-audio-actions" data-guide-id={GUIDE_TARGETS.sceneDialogueActions}>
        <button type="button" onClick={() => document.duplicateDialogueLine(line.id)}>
          Duplicate dialogue line
        </button>
        <button type="button" className="workspace-danger" onClick={() => document.removeDialogueLine(line.id)}>
          Delete dialogue line
        </button>
      </div>
      <p className="workspace-caption">
        Lines use scene time without pausing for input. Overlapping intervals are rejected; adjacent lines are allowed.
        Duplicate places the copy in the next available interval after this line. Subtitle playback display is not
        available yet.
      </p>
    </details>
  );
}

export function SceneDialogueInspector({ document }: { document: SceneEditorDocument }) {
  const line = document.selectedDialogueLine;
  return line ? (
    <DialogueProperties key={line.id} document={document} line={line} />
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
          Select a line to set Dialogue start and Dialogue duration in seconds. Lines cannot overlap. Adjacent intervals
          are allowed; each line must end within scene duration.
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
