import { CAMERA_PROPERTIES, type CameraProperty } from '../../engine/cameraAnimation.js';
import { sceneActionDuration } from '../../engine/SceneDefinition.js';
import { resolveTimelineSnap } from '../animation-editor/timelineSnapping.js';
import type { ReadonlyScene } from './SceneEditorDocument.js';

/** Track identity is Actor identity; empty Actors still have an editable track. */
export function buildSceneTracks(scene: ReadonlyScene) {
  return scene.actors.map((actor) => ({
    actor,
    actions: scene.actions.filter((action) => action.actorId === actor.id),
  }));
}

/** Adapt scene clip edges/markers to the shared nearest-target snapping policy (seconds). */
export function snapSceneTime(
  scene: ReadonlyScene,
  actionId: string | null,
  proposed: number,
  width: number,
  playhead: number,
  enabled: boolean,
  min = 0,
  max = scene.duration,
  excludeCameraKey?: { property: CameraProperty; id: string },
): number {
  return (
    resolveTimelineSnap(
      proposed / 1000,
      {
        duration: scene.duration / 1000,
        contentWidth: width,
        playheadTime: playhead / 1000,
        minTime: min / 1000,
        maxTime: max / 1000,
        targets: [
          ...(scene.transitions ?? []).flatMap((effect) => [
            { type: 'keyframe' as const, time: effect.time / 1000 },
            { type: 'keyframe' as const, time: (effect.time + effect.duration) / 1000 },
          ]),
          ...scene.actions
            .filter((action) => action.id !== actionId)
            .flatMap((action) => [
              { type: 'keyframe' as const, time: action.time / 1000 },
              { type: 'keyframe' as const, time: (action.time + sceneActionDuration(action)) / 1000 },
            ]),
          ...CAMERA_PROPERTIES.flatMap((property) =>
            (scene.cameraTracks?.[property] ?? [])
              .filter((key) => property !== excludeCameraKey?.property || key.id !== excludeCameraKey.id)
              .map((key) => ({ type: 'keyframe' as const, time: key.time / 1000 })),
          ),
        ],
      },
      { enabled, frames: true, keyframes: true, events: true, playhead: true },
    ).time * 1000
  );
}

/** Keep concurrent metadata markers and waits selectable instead of covering each other. */
export function layoutSceneActions(actions: ReadonlyScene['actions'], duration: number, width: number) {
  const ends: number[] = [];
  return [...actions]
    .sort((a, b) => a.time - b.time)
    .map((action) => {
      if (action.type === 'animation') return { action, lane: 0 };
      if (action.type === 'move') return { action, lane: 1 };
      const markerWidth = width > 0 ? (duration * 20) / width : 0;
      const start = action.time - (sceneActionDuration(action) ? 0 : markerWidth / 2);
      let lane = ends.findIndex((end) => end <= start);
      if (lane < 0) lane = ends.length;
      ends[lane] = action.time + Math.max(sceneActionDuration(action), markerWidth);
      return { action, lane: lane + 2 };
    });
}
