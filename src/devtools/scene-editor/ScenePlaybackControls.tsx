import Pause from 'lucide-react/icons/pause';
import Play from 'lucide-react/icons/play';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Square from 'lucide-react/icons/square';
import { useSyncExternalStore } from 'react';
import { timeToTimelineX } from '../animation-editor/timeline.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';

/** Only clock observations subscribe to frames; the authored track tree stays unchanged during playback. */
export function ScenePlaybackControls({ playback }: { playback: SceneEditorPlayback }) {
  useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  return (
    <>
      <button
        type="button"
        data-guide-id={GUIDE_TARGETS.scenePlayback}
        aria-label={playback.status === 'playing' ? 'Pause' : 'Play'}
        title={playback.status === 'playing' ? 'Pause' : 'Play'}
        disabled={!playback.ready}
        onClick={() => (playback.status === 'playing' ? playback.pause() : playback.play())}
      >
        {playback.status === 'playing' ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      </button>
      <button
        type="button"
        data-guide-id={GUIDE_TARGETS.sceneRestart}
        aria-label="Restart"
        title="Restart"
        disabled={!playback.ready}
        onClick={() => playback.restart()}
      >
        <RotateCcw size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        data-guide-id={GUIDE_TARGETS.sceneStop}
        aria-label="Stop"
        title="Stop"
        disabled={!playback.ready}
        onClick={() => playback.stop()}
      >
        <Square size={16} aria-hidden="true" />
      </button>
      <span className="scene-playback-status" aria-label="Scene playback status">
        {playback.status} · {(playback.time / 1000).toFixed(2)} s
      </span>
    </>
  );
}

/** Secondary controls remain mounted inside the timeline's View and Audio tabs. */
export function ScenePlaybackSpeed({ playback }: { playback: SceneEditorPlayback }) {
  useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  return (
    <label>
      Speed
      <select
        data-guide-id={GUIDE_TARGETS.scenePlaybackSpeed}
        aria-label="Scene playback speed"
        value={playback.speed}
        onChange={(event) => playback.setSpeed(Number(event.target.value))}
      >
        {[0.25, 0.5, 1, 1.5, 2].map((speed) => (
          <option key={speed} value={speed}>
            {speed}×
          </option>
        ))}
      </select>
    </label>
  );
}

export function SceneAudioPlaybackControls({ playback }: { playback: SceneEditorPlayback }) {
  useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  return (
    <>
      <label data-guide-id={GUIDE_TARGETS.sceneAudioMute}>
        <input
          type="checkbox"
          checked={playback.audioMuted}
          onChange={(event) => playback.setAudioMuted(event.target.checked)}
        />
        Mute preview audio
      </label>
      <span data-guide-id={GUIDE_TARGETS.sceneAudioStatus} aria-label="Scene audio status">
        Audio: {playback.audioStatus}
        {playback.audioMuted ? ' · muted' : ''}
      </span>
      {['locked', 'error'].includes(playback.audioStatus) && (
        <button type="button" onClick={() => playback.enableAudio()}>
          Enable audio
        </button>
      )}
      {playback.audioError && <span role="alert">{playback.audioError}</span>}
    </>
  );
}

export function SceneTimeInput({ playback, duration }: { playback: SceneEditorPlayback; duration: number }) {
  useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  return (
    <label>
      Playhead (s)
      <input
        data-guide-id={GUIDE_TARGETS.sceneTime}
        type="number"
        disabled={!playback.ready}
        min="0"
        max={duration / 1000}
        step="any"
        value={Math.min(playback.time, duration) / 1000}
        onFocus={() => playback.pause()}
        onChange={(event) => {
          const time = event.target.valueAsNumber * 1000;
          if (Number.isFinite(time)) playback.seek(Math.max(0, Math.min(duration, time)));
        }}
      />
    </label>
  );
}

export function ScenePlayhead({
  playback,
  duration,
  width,
}: {
  playback: SceneEditorPlayback;
  duration: number;
  width: number;
}) {
  useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  const left = 146 + timeToTimelineX(Math.min(playback.time, duration) / 1000, duration / 1000, width);
  return <div className="scene-playhead" style={{ left }} />;
}

export function ScenePlaybackError({ playback }: { playback: SceneEditorPlayback }) {
  useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  return playback.error ? (
    <p role="alert" className="scene-errors">
      {playback.error}{' '}
      <button type="button" onClick={() => playback.retry()}>
        Retry playback
      </button>
    </p>
  ) : null;
}
