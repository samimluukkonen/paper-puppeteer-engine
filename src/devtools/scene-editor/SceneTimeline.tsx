import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { sceneActionDuration, type SceneActionDefinition } from '../../engine/SceneDefinition.js';
import { generateRulerTicks, timeToTimelineX, timelineXToTime } from '../animation-editor/timeline.js';
import type { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import type { ReadonlyScene, SceneEditorDocument, SceneActionInput } from './SceneEditorDocument.js';
import { buildSceneTracks, layoutSceneActions, snapSceneTime } from './timelineActions.js';

type Drag = {
  pointer: number;
  x: number;
  action: SceneActionDefinition;
  resize: boolean;
  valid: boolean;
  width: number;
};
export function SceneTimeline({
  scene,
  document,
  registry,
}: {
  scene: ReadonlyScene;
  document: SceneEditorDocument;
  registry: SceneCharacterRegistry;
}) {
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Drag | null>(null);
  const scrub = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [kind, setKind] = useState<SceneActionDefinition['type']>('animation');
  const width = Math.max(300, viewportWidth - 146) * zoom;
  const seconds = scene.duration / 1000;
  const actor = scene.actors.find((actor) => actor.id === document.selectedActorId);
  const animations = actor ? (registry.get(actor.character.manifest)?.animations ?? []) : [];
  useLayoutEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const cancel = (): void => {
      gesture.current = null;
      scrub.current = null;
      document.cancelActionDrag();
    };
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, [document]);
  const add = (): void => {
    if (!actor) return;
    const time = Math.min(playhead, scene.duration);
    const duration = Math.min(1000, scene.duration - time);
    const common = { actorId: actor.id, time };
    let action: SceneActionInput;
    switch (kind) {
      case 'animation':
        if (!animations[0]) return;
        action = { ...common, type: kind, animation: animations[0].name, duration, loop: false, speed: 1 };
        break;
      case 'move':
        action = { ...common, type: kind, destination: { x: actor.position.x + 120, y: actor.position.y }, duration };
        break;
      case 'wait':
        action = { ...common, type: kind, duration };
        break;
      case 'face':
        action = { ...common, type: kind, target: { type: 'direction', facing: 'right' } };
        break;
      case 'cue':
        action = { ...common, type: kind, name: 'cue' };
        break;
    }
    document.addAction(action);
  };
  const x = (time: number): number => timeToTimelineX(time / 1000, seconds, width);
  return (
    <>
      <div className="scene-timeline-toolbar">
        <h2>Scene timeline</h2>
        <label>
          Action type
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="animation">Play animation</option>
            <option value="move">Move to position</option>
            <option value="face">Change facing</option>
            <option value="wait">Wait / hold</option>
            <option value="cue">Scene cue</option>
          </select>
        </label>
        <button type="button" disabled={!actor || (kind === 'animation' && !animations.length)} onClick={add}>
          Add action
        </button>
        <label>
          <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} />
          Snap
        </label>
        <label>
          Zoom
          <input
            aria-label="Timeline zoom"
            type="range"
            min="1"
            max="8"
            step="0.25"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <label>
          Playhead (s)
          <input
            type="number"
            min="0"
            max={seconds}
            step="any"
            value={Math.min(playhead, scene.duration) / 1000}
            onChange={(event) => {
              const value = event.target.valueAsNumber * 1000;
              if (Number.isFinite(value)) setPlayhead(Math.max(0, Math.min(scene.duration, value)));
            }}
          />
        </label>
      </div>
      <p className="workspace-caption">
        Select an Actor to add actions. Drag clips to move; drag the right edge to resize. Alt bypasses snapping. Scroll
        to pan. Stage shows initial placement.
      </p>
      <div
        ref={viewport}
        className="scene-timeline-viewport"
        tabIndex={0}
        aria-label="Action tracks"
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest('input, select, textarea')) return;
          if (event.key === 'Escape') {
            scrub.current = null;
            gesture.current = null;
            document.cancelActionDrag();
          }
          if ((event.key === 'Delete' || event.key === 'Backspace') && document.selectedActionId) {
            event.preventDefault();
            document.removeAction(document.selectedActionId);
          }
        }}
        onPointerMove={(event) => {
          if (scrub.current === event.pointerId) {
            const element = event.currentTarget;
            const offset = event.clientX - element.getBoundingClientRect().left + element.scrollLeft - 146;
            setPlayhead(
              snapSceneTime(
                scene,
                null,
                timelineXToTime(offset, seconds, width) * 1000,
                width,
                -1000,
                snap && !event.altKey,
              ),
            );
            return;
          }
          const drag = gesture.current;
          if (!drag || drag.pointer !== event.pointerId) return;
          const delta = ((event.clientX - drag.x) / drag.width) * scene.duration;
          const action = drag.action;
          let next: SceneActionDefinition;
          if (drag.resize && 'duration' in action) {
            const end = snapSceneTime(
              scene,
              action.id,
              action.time + action.duration + delta,
              drag.width,
              playhead,
              snap && !event.altKey,
              action.time + 0.001,
            );
            next = { ...action, duration: end - action.time };
          } else {
            const time = snapSceneTime(
              scene,
              action.id,
              action.time + delta,
              drag.width,
              playhead,
              snap && !event.altKey,
              0,
              scene.duration - sceneActionDuration(action),
            );
            next = { ...action, time };
          }
          drag.valid = document.changeActionDrag(next);
        }}
        onPointerUp={(event) => {
          scrub.current = null;
          const drag = gesture.current;
          if (!drag || drag.pointer !== event.pointerId) return;
          gesture.current = null;
          if (drag.valid) document.endActionDrag();
          else document.cancelActionDrag();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          scrub.current = null;
          gesture.current = null;
          document.cancelActionDrag();
        }}
        onLostPointerCapture={() => {
          scrub.current = null;
          gesture.current = null;
          document.cancelActionDrag();
        }}
      >
        <div className="scene-timeline-content" style={{ width: width + 146 }}>
          <div className="scene-track-row scene-ruler-row">
            <span className="scene-track-label">Time</span>
            <div
              className="scene-track-lane scene-ruler"
              style={{ width }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                viewport.current?.focus();
                viewport.current?.setPointerCapture(event.pointerId);
                scrub.current = event.pointerId;
                setPlayhead(
                  snapSceneTime(
                    scene,
                    null,
                    timelineXToTime(event.clientX - event.currentTarget.getBoundingClientRect().left, seconds, width) *
                      1000,
                    width,
                    -1000,
                    snap && !event.altKey,
                  ),
                );
              }}
            >
              {generateRulerTicks(seconds, width).map((tick) => (
                <span
                  className={`scene-ruler-tick ${tick.major ? 'major' : ''}`}
                  key={tick.time}
                  style={{ left: x(tick.time * 1000) }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          {buildSceneTracks(scene).map(({ actor, actions }) => {
            const layout = layoutSceneActions(actions, scene.duration, width);
            const rows = Math.max(3, ...layout.map(({ lane }) => lane + 1));
            return (
              <div className="scene-track-row" key={actor.id} style={{ height: rows * 26 + 6 }}>
                <button
                  type="button"
                  className="scene-track-label"
                  aria-pressed={actor.id === document.selectedActorId}
                  onClick={() => document.selectActor(actor.id)}
                >
                  {actor.id}
                </button>
                <div className="scene-track-lane" style={{ width }} aria-label={`${actor.id} actions`}>
                  {layout.map(({ action, lane }) => {
                    const duration = sceneActionDuration(action);
                    return (
                      <button
                        key={action.id}
                        type="button"
                        className={`scene-action ${duration ? 'clip' : 'marker'} scene-action-${action.type}`}
                        aria-pressed={action.id === document.selectedActionId}
                        aria-label={`${actor.id}: ${action.type} ${action.id}`}
                        title={`${action.type} · ${action.time / 1000} s · ${duration / 1000} s`}
                        style={{
                          left: x(action.time),
                          width: duration ? Math.max(6, x(duration)) : 16,
                          top: lane * 26 + 4,
                        }}
                        onClick={() => document.selectAction(action.id)}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          viewport.current?.focus();
                          if (!document.beginActionDrag(action.id)) return;
                          viewport.current?.setPointerCapture(event.pointerId);
                          gesture.current = {
                            pointer: event.pointerId,
                            x: event.clientX,
                            action: structuredClone(action) as SceneActionDefinition,
                            resize: (event.target as HTMLElement).dataset.resize === 'true',
                            valid: true,
                            width,
                          };
                        }}
                      >
                        {duration ? (action.type === 'animation' ? action.animation : action.type) : '◆'}
                        {duration > 0 && (
                          <span className="scene-action-resize" data-resize="true" aria-hidden="true">
                            ⋮
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!scene.actors.length && <p>Add Actors to create timeline tracks.</p>}
          <div className="scene-playhead" style={{ left: 146 + x(Math.min(playhead, scene.duration)) }} />
        </div>
      </div>
    </>
  );
}
