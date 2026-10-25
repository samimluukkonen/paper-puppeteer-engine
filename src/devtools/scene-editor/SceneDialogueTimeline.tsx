import { dialogueSpeaker } from '../../engine/sceneDialogue.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { ReadonlyScene, SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';

export function SceneDialogueControls({
  document,
  playback,
}: {
  document: SceneEditorDocument;
  playback: SceneEditorPlayback;
}) {
  const scene = document.workingScene;
  return (
    <div className="scene-timeline-toolbar">
      <button
        type="button"
        className="workspace-primary"
        data-guide-id={GUIDE_TARGETS.sceneDialogueAdd}
        disabled={!scene || document.hasActiveGesture || playback.time >= scene.duration}
        onClick={() => {
          if (!scene) return;
          playback.pause();
          const time = playback.time;
          const next = scene.dialogue?.filter((line) => line.time > time).sort((a, b) => a.time - b.time)[0];
          document.addDialogueLine({
            time,
            duration: Math.min(2000, (next?.time ?? scene.duration) - time),
            text: '',
            ...(document.selectedActorId ? { actorId: document.selectedActorId } : {}),
          });
        }}
      >
        Add Dialogue Line
      </button>
      <span className="workspace-caption">
        Dialogue uses scene time. Select a line to edit its text and interval; lines cannot overlap.
      </span>
    </div>
  );
}

export function SceneDialogueTrack({
  scene,
  document,
  playback,
  width,
  x,
}: {
  scene: ReadonlyScene;
  document: SceneEditorDocument;
  playback: SceneEditorPlayback;
  width: number;
  x: (time: number) => number;
}) {
  return (
    <div className="scene-track-row" data-guide-id={GUIDE_TARGETS.sceneDialogueTrack} style={{ height: 36 }}>
      <span className="scene-track-label">Dialogue</span>
      <div className="scene-track-lane" style={{ width }} aria-label="Dialogue lines">
        {(scene.dialogue ?? []).map((line) => (
          <button
            key={line.id}
            type="button"
            className="scene-action clip scene-dialogue-line"
            aria-label={`Dialogue ${line.id}: ${dialogueSpeaker(line)}`}
            aria-pressed={document.selectedDialogueLine?.id === line.id}
            title={`${line.time / 1000}–${(line.time + line.duration) / 1000} s · ${dialogueSpeaker(line)}: ${line.text}`}
            style={{ left: x(line.time), width: Math.max(6, x(line.duration)), top: 4 }}
            onClick={() => {
              playback.pause();
              document.selectDialogueLine(line.id);
            }}
          >
            {dialogueSpeaker(line)}: {line.text || '(empty line)'}
          </button>
        ))}
      </div>
    </div>
  );
}
