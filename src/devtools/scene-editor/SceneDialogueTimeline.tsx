import CornerDownLeft from 'lucide-react/icons/corner-down-left';
import { compareDialogueLines, dialogueSpeaker } from '../../engine/sceneDialogue.js';
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
        Select a line to edit text, timing and progression. Timed lines cannot overlap; Wait for Enter lines can share a
        start.
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
  // Same-start holds are individually selectable, in the same order as playback.
  const counts = new Map<number, number>();
  const lines = [...(scene.dialogue ?? [])].sort(compareDialogueLines).map((line) => {
    const lane = counts.get(line.time) ?? 0;
    counts.set(line.time, lane + 1);
    return { line, lane };
  });
  const laneCount = Math.max(1, ...counts.values());
  return (
    <div
      className="scene-track-row"
      data-guide-id={GUIDE_TARGETS.sceneDialogueTrack}
      style={{ height: 8 + laneCount * 28 }}
    >
      <span className="scene-track-label">Dialogue</span>
      <div className="scene-track-lane" style={{ width }} aria-label="Dialogue lines">
        {lines.map(({ line, lane }) => (
          <button
            key={line.id}
            type="button"
            className="scene-action clip scene-dialogue-line"
            aria-label={`Dialogue ${line.id}: ${dialogueSpeaker(line)}${line.progression === 'advance-required' ? ' · Wait for Enter' : ''}`}
            aria-pressed={document.selectedDialogueLine?.id === line.id}
            title={`${line.time / 1000}–${(line.time + line.duration) / 1000} s · ${line.progression === 'advance-required' ? `Wait for Enter · Sequence ${lane + 1} · ` : 'Timed · '}${dialogueSpeaker(line)}: ${line.text}`}
            style={{
              left: x(line.time),
              width: Math.max(line.progression === 'advance-required' ? 76 : 6, x(line.duration)),
              top: 4 + lane * 28,
            }}
            onClick={() => {
              playback.pause();
              document.selectDialogueLine(line.id);
            }}
          >
            {line.progression === 'advance-required' && (
              <span className="scene-dialogue-hold-marker">
                <CornerDownLeft size={12} aria-hidden="true" />
                Enter · {lane + 1}{' '}
              </span>
            )}
            {dialogueSpeaker(line)}: {line.text || '(empty line)'}
          </button>
        ))}
      </div>
    </div>
  );
}
