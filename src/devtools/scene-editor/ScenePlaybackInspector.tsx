import { useState, useSyncExternalStore } from 'react';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';

/** Runtime observations never share the authored initial-position form. */
export function ScenePlaybackInspector({
  playback,
  actorId,
}: {
  playback: SceneEditorPlayback;
  actorId: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Runtime preview</summary>
      {open && <PlaybackObservation playback={playback} actorId={actorId} />}
    </details>
  );
}

function PlaybackObservation({ playback, actorId }: { playback: SceneEditorPlayback; actorId: string | null }) {
  useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  const actor = actorId ? playback.actors?.get(actorId) : undefined;
  const live = actor && !actor.isDisposed ? actor : undefined;
  return (
    <>
      {live ? (
        <dl>
          <dt>Actor</dt>
          <dd>{live.id}</dd>
          <dt>Scene time</dt>
          <dd>{(playback.time / 1000).toFixed(3)} s</dd>
          {playback.dialogueHoldPlayback && (
            <>
              <dt>Hold elapsed</dt>
              <dd>{(playback.dialogueHoldPlayback.holdElapsedTime / 1000).toFixed(3)} s</dd>
            </>
          )}
          <dt>Position</dt>
          <dd>
            {live.position.x.toFixed(3)}, {live.position.y.toFixed(3)}
          </dd>
          <dt>Facing</dt>
          <dd>{live.facingDirection}</dd>
          <dt>Animation</dt>
          <dd>{live.currentAnimation ?? 'Bind pose'}</dd>
          <dt>Clip time</dt>
          <dd>{(live.puppet.posePipeline.player.elapsedTime / 1000).toFixed(3)} s</dd>
        </dl>
      ) : (
        <p>Play or scrub, then select an Actor track to inspect its runtime transform and pose.</p>
      )}
    </>
  );
}
