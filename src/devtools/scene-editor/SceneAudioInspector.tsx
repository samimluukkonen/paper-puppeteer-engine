import { useEffect, useState } from 'react';
import type { SceneAudioClip } from '../../engine/sceneAudio.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';

function AudioProperties({ document, clip }: { document: SceneEditorDocument; clip: Readonly<SceneAudioClip> }) {
  const [draft, setDraft] = useState({ ...clip });
  useEffect(() => setDraft({ ...clip }), [clip]);
  const asset = document.audioAssets.find((asset) => asset.id === draft.assetId);
  const timingFields = [
    ['time', 'Start'],
    ['duration', 'Duration'],
    ['sourceOffset', 'Source offset'],
  ] as const;
  return (
    <details data-guide-id={GUIDE_TARGETS.sceneAudioProperties}>
      <summary>Audio clip · {asset?.name ?? clip.assetId}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          document.updateAudioClip(clip.id, draft);
        }}
      >
        <label>
          Clip ID
          <input readOnly value={clip.id} />
        </label>
        <label>
          Clip asset
          <select value={draft.assetId} onChange={(event) => setDraft({ ...draft, assetId: event.target.value })}>
            {document.audioAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
        <p className="workspace-caption">
          Media duration:{' '}
          {asset?.durationSeconds === undefined
            ? 'Unknown; source bounds will be checked when decoded.'
            : `${asset.durationSeconds.toFixed(3)} seconds`}
        </p>
        <label>
          Clip track
          <select value={draft.trackId} onChange={(event) => setDraft({ ...draft, trackId: event.target.value })}>
            {document.workingScene?.audioTracks?.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
              </option>
            ))}
          </select>
        </label>
        <div data-guide-id={GUIDE_TARGETS.sceneAudioTiming}>
          {timingFields.map(([field, label]) => (
            <label key={field}>
              {label} (seconds)
              <input
                type="number"
                required
                step="any"
                min={field === 'duration' ? '0.000001' : '0'}
                value={Number.isNaN(draft[field]) ? '' : (draft[field] ?? 0) / 1000}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.valueAsNumber * 1000 })}
              />
            </label>
          ))}
        </div>
        <div data-guide-id={GUIDE_TARGETS.sceneAudioPlayback}>
          <label>
            Audio playback
            <select
              aria-label="Audio playback"
              value={draft.playback ?? 'scene'}
              onChange={(event) =>
                setDraft(
                  event.target.value === 'dialogue-hold'
                    ? { ...draft, playback: 'dialogue-hold', loop: true, fadeIn: 0, fadeOut: 0 }
                    : { ...draft, playback: 'scene' },
                )
              }
            >
              <option value="scene">Scene timeline (pause during holds)</option>
              <option value="dialogue-hold">Hold-only loop (music / ambience)</option>
            </select>
          </label>
          <p className="workspace-caption">
            Hold-only loops require a Music or Ambience track. Start and Duration select eligible holds; sound loops
            from Source offset while waiting. Advance stops it. Scene fades do not apply.
          </p>
          <label>
            Volume (%)
            <input
              type="number"
              required
              min="0"
              max="100"
              step="any"
              value={Number.isNaN(draft.volume) ? '' : draft.volume * 100}
              onChange={(event) => setDraft({ ...draft, volume: event.target.valueAsNumber / 100 })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              disabled={draft.playback === 'dialogue-hold'}
              checked={draft.loop}
              onChange={(event) => setDraft({ ...draft, loop: event.target.checked })}
            />
            Loop
          </label>
        </div>
        <div data-guide-id={GUIDE_TARGETS.sceneAudioFades}>
          {(
            [
              ['fadeIn', 'Fade in'],
              ['fadeOut', 'Fade out'],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              {label} (seconds)
              <input
                type="number"
                disabled={draft.playback === 'dialogue-hold'}
                required
                step="any"
                min="0"
                value={Number.isNaN(draft[field]) ? '' : (draft[field] ?? 0) / 1000}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.valueAsNumber * 1000 })}
              />
            </label>
          ))}
        </div>
        <button type="submit">Apply audio clip properties</button>
      </form>
      <p className="workspace-caption">
        {clip.playback === 'dialogue-hold'
          ? 'Drag to move the hold eligibility window. Edges resize that window; left trim also advances Source offset. Each eligible hold loops indefinitely until Advance. Overlapping hold loops play together.'
          : 'Drag to move. Drag either edge to trim. Left trim advances the source offset; right trim sets the scene end. Loops repeat from source offset to media end within the clip duration. Fades are linear gain ramps at the scene clip edges; overlapping fades multiply. Overlapping clips are allowed.'}{' '}
        Edits preserve the audio file and scene duration.
      </p>
      <div className="scene-audio-actions" data-guide-id={GUIDE_TARGETS.sceneAudioActions}>
        <button type="button" onClick={() => document.duplicateAudioClip(clip.id)}>
          Duplicate audio clip
        </button>
        <button type="button" className="workspace-danger" onClick={() => document.removeAudioClip(clip.id)}>
          Delete audio clip
        </button>
      </div>
    </details>
  );
}

export function SceneAudioInspector({ document }: { document: SceneEditorDocument }) {
  const clip = document.selectedAudioClip;
  return clip ? (
    <AudioProperties key={clip.id} document={document} clip={clip} />
  ) : (
    <details data-guide-id={GUIDE_TARGETS.sceneAudioProperties}>
      <summary>Audio clip</summary>
      <div data-guide-id={GUIDE_TARGETS.sceneAudioTiming}>
        <p className="workspace-caption">
          Select an audio clip in the timeline to edit Start, Duration and Source offset. No clips yet? Choose an audio
          asset and track, then Add Audio Clip after exiting the guide.
        </p>
      </div>
      <div data-guide-id={GUIDE_TARGETS.sceneAudioPlayback}>
        <p className="workspace-caption">
          A selected clip exposes Audio playback, Volume and Loop. Scene timeline audio pauses during dialogue holds.
          Hold-only loops require a Music or Ambience track and play while waiting. Passive scrubbing stays silent.
        </p>
      </div>
      <div data-guide-id={GUIDE_TARGETS.sceneAudioFades}>
        <p className="workspace-caption">
          A selected clip exposes Fade in and Fade out durations. Each fade must fit inside the clip. Apply audio clip
          properties commits the values.
        </p>
      </div>
      <div data-guide-id={GUIDE_TARGETS.sceneAudioActions}>
        <p className="workspace-caption">
          Select a clip to Duplicate audio clip or Delete audio clip. Scene Undo/Redo restores edits; a completed drag
          creates one history entry.
        </p>
      </div>
    </details>
  );
}
