import Blend from 'lucide-react/icons/blend';
import Camera from 'lucide-react/icons/camera';
import Eye from 'lucide-react/icons/eye';
import ListVideo from 'lucide-react/icons/list-video';
import MessagesSquare from 'lucide-react/icons/messages-square';
import Volume2 from 'lucide-react/icons/volume-2';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CAMERA_PROPERTIES, type CameraProperty } from '../../engine/cameraAnimation.js';
import type { SceneAudioClip } from '../../engine/sceneAudio.js';
import { sceneActionDuration, type SceneActionDefinition } from '../../engine/SceneDefinition.js';
import { blocksEditorShortcut } from '../../shared/keyboardShortcuts.js';
import { EditorTabs } from '../../ui/EditorTabs.js';
import { generateRulerTicks, timeToTimelineX, timelineXToTime } from '../animation-editor/timeline.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { SceneAnimationLibrary } from './SceneAnimationLibrary.js';
import { SceneAudioControls, SceneAudioTracks } from './SceneAudioTimeline.js';
import type { SceneCharacterRegistry } from './SceneCharacterRegistry.js';
import { SceneDialogueControls, SceneDialogueTrack } from './SceneDialogueTimeline.js';
import type { ReadonlyScene, SceneEditorDocument, SceneActionInput } from './SceneEditorDocument.js';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';
import {
  ScenePlaybackControls,
  ScenePlaybackSpeed,
  SceneAudioPlaybackControls,
  SceneTimeInput,
  ScenePlayhead,
  ScenePlaybackError,
} from './ScenePlaybackControls.js';
import { buildSceneTracks, layoutSceneActions, snapSceneTime, editAudioClipOnTimeline } from './timelineActions.js';

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
  playback,
}: {
  scene: ReadonlyScene;
  document: SceneEditorDocument;
  registry: SceneCharacterRegistry;
  playback: SceneEditorPlayback;
}) {
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  const selectedActionIds = new Set(document.selectedActionIds);
  const viewport = useRef<HTMLDivElement>(null);
  const audioGesture = useRef<{
    pointer: number;
    x: number;
    clip: SceneAudioClip;
    edge: 'move' | 'start' | 'end';
    width: number;
    valid: boolean;
  } | null>(null);
  const gesture = useRef<Drag | null>(null);
  const cameraGesture = useRef<{
    pointer: number;
    x: number;
    time: number;
    property: CameraProperty;
    id: string;
    width: number;
    valid: boolean;
  } | null>(null);
  const scrub = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const setPlayhead = (time: number): void => playback.queueSeek(time);
  const [kind, setKind] = useState<SceneActionDefinition['type']>('animation');
  const [fadeType, setFadeType] = useState<'fade-in' | 'fade-out'>('fade-in');
  const cuts = [
    ...new Set(
      CAMERA_PROPERTIES.flatMap((property) =>
        (scene.cameraTracks?.[property] ?? []).flatMap((key, index, keys) =>
          index > 0 && keys[index - 1]?.curve?.mode === 'stepped' ? [key.time] : [],
        ),
      ),
    ),
  ].sort((a, b) => a - b);
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
      playback.cancelSeek();
      audioGesture.current = null;
      document.cancelAudioDrag();
      gesture.current = null;
      cameraGesture.current = null;
      scrub.current = null;
      document.cancelActionDrag();
      document.cancelCameraDrag();
    };
    window.addEventListener('blur', cancel);
    const escape = (event: KeyboardEvent): void => {
      if (
        event.key === 'Escape' &&
        !blocksEditorShortcut(event) &&
        (audioGesture.current || gesture.current || cameraGesture.current || scrub.current !== null)
      ) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
      cancel();
    };
  }, [document, playback, scene.id]);
  const add = (animationName?: string): void => {
    if (!actor) return;
    const time = Math.min(playback.time, scene.duration);
    const duration = Math.min(1000, scene.duration - time);
    const common = { actorId: actor.id, time };
    let action: SceneActionInput;
    const actionKind = animationName ? 'animation' : kind;
    switch (actionKind) {
      case 'animation':
        if (!animations[0]) return;
        if (animationName && !animations.some((clip) => clip.name === animationName)) return;
        action = {
          ...common,
          type: 'animation',
          animation: animationName ?? animations[0].name,
          duration,
          loop: false,
          speed: 1,
        };
        break;
      case 'move':
        action = {
          ...common,
          type: actionKind,
          destination: { x: actor.position.x + 120, y: actor.position.y },
          duration,
        };
        break;
      case 'wait':
        action = { ...common, type: actionKind, duration };
        break;
      case 'face':
        action = { ...common, type: actionKind, target: { type: 'direction', facing: 'right' } };
        break;
      case 'cue':
        action = { ...common, type: actionKind, name: 'cue' };
        break;
    }
    document.addAction(action);
  };
  const x = (time: number): number => timeToTimelineX(time / 1000, seconds, width);
  return (
    <>
      <EditorTabs
        label="Scene timeline tools"
        controlsLabel="scene timeline controls"
        defaultExpanded={false}
        toolbar={
          <div className="scene-timeline-toolbar scene-timeline-transport" aria-label="Scene playback controls">
            <ScenePlaybackControls playback={playback} />
            <SceneTimeInput playback={playback} duration={scene.duration} />
          </div>
        }
        tabs={[
          {
            id: 'scene-timeline-actions',
            label: 'Actions',
            icon: ListVideo,
            content: (
              <>
                <div className="scene-timeline-toolbar">
                  <label>
                    Action type
                    <select
                      data-guide-id={GUIDE_TARGETS.sceneActionType}
                      value={kind}
                      onChange={(event) => setKind(event.target.value as typeof kind)}
                    >
                      <option value="animation">Play animation</option>
                      <option value="move">Move to position</option>
                      <option value="face">Change facing</option>
                      <option value="wait">Wait / hold</option>
                      <option value="cue">Scene cue</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="workspace-primary"
                    data-guide-id={GUIDE_TARGETS.sceneAddAction}
                    disabled={!actor || (kind === 'animation' && !animations.length)}
                    onClick={() => add()}
                  >
                    Add action
                  </button>
                </div>
                {kind === 'animation' && actor && registry.get(actor.character.manifest) && (
                  <SceneAnimationLibrary
                    definition={registry.get(actor.character.manifest)!}
                    manifest={actor.character.manifest}
                    onUse={(name) => add(name)}
                  />
                )}
                {scene.actors.length > 0 && !scene.actions.length && (
                  <p className="workspace-caption">
                    No timeline clips. Select an Actor, choose an Action type, then Add action.
                    {actor &&
                      !animations.length &&
                      ' This character has no animations; create one in Animation Editor or choose Move, Wait, Change facing or Scene cue.'}
                  </p>
                )}
              </>
            ),
          },
          {
            id: 'scene-timeline-camera',
            label: 'Camera',
            icon: Camera,
            content: (
              <div className="scene-timeline-toolbar">
                <button
                  type="button"
                  data-guide-id={GUIDE_TARGETS.sceneCameraSetKey}
                  disabled={document.hasActiveGesture}
                  onClick={() => {
                    playback.pause();
                    document.setCameraKey(playback.time);
                    document.setCameraKeyEditing(true);
                  }}
                >
                  Set Camera Key
                </button>
                <button
                  type="button"
                  data-guide-id={GUIDE_TARGETS.sceneCameraCut}
                  disabled={document.hasActiveGesture}
                  onClick={() => {
                    playback.pause();
                    document.setCameraCut(playback.time);
                  }}
                >
                  Set Camera Cut
                </button>
              </div>
            ),
          },
          {
            id: 'scene-timeline-transitions',
            label: 'Transitions',
            icon: Blend,
            content: (
              <div className="scene-timeline-toolbar">
                <label>
                  Effect type
                  <select
                    value={fadeType}
                    onChange={(event) => setFadeType(event.target.value === 'fade-in' ? 'fade-in' : 'fade-out')}
                  >
                    <option value="fade-in">Fade in</option>
                    <option value="fade-out">Fade out</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="workspace-primary"
                  data-guide-id={GUIDE_TARGETS.sceneAddTransition}
                  disabled={document.hasActiveGesture || playback.time >= scene.duration}
                  onClick={() => {
                    playback.pause();
                    document.addTransition({
                      type: fadeType,
                      time: playback.time,
                      duration: Math.min(1000, scene.duration - playback.time),
                      color: '#000000',
                    });
                  }}
                >
                  Add effect
                </button>
              </div>
            ),
          },
          {
            id: 'scene-timeline-dialogue',
            label: 'Dialogue',
            icon: MessagesSquare,
            content: <SceneDialogueControls document={document} playback={playback} />,
          },
          {
            id: 'scene-timeline-audio',
            label: 'Audio',
            icon: Volume2,
            content: (
              <>
                <SceneAudioControls document={document} playback={playback} />
                <div className="scene-timeline-toolbar">
                  <SceneAudioPlaybackControls playback={playback} />
                </div>
              </>
            ),
          },
          {
            id: 'scene-timeline-view',
            label: 'View',
            icon: Eye,
            content: (
              <>
                <div className="scene-timeline-toolbar">
                  <label>
                    <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} />
                    Snap
                  </label>
                  <label>
                    Zoom
                    <input
                      data-guide-id={GUIDE_TARGETS.sceneZoom}
                      aria-label="Timeline zoom"
                      type="range"
                      min="1"
                      max="8"
                      step="0.25"
                      value={zoom}
                      onChange={(event) => setZoom(Number(event.target.value))}
                    />
                  </label>
                  <ScenePlaybackSpeed playback={playback} />
                </div>
                <details className="scene-timeline-help">
                  <summary>Timeline help</summary>
                  <p className="workspace-caption">
                    Select an Actor to add actions. Ctrl/Cmd/Shift-click clips to select several for choreography. Drag
                    clips to move; drag the right edge to resize. Alt bypasses snapping. Scroll to pan. Scrubbing pauses
                    playback. Stop restores initial placement for stage editing. Camera diamonds select keys; drag to
                    move their time. Set Camera Cut holds the preceding shot until this key; edit the new shot in
                    Cinematic Camera. Select fades to edit start, duration and color in Transition properties.
                  </p>
                </details>
              </>
            ),
          },
        ]}
      />
      <ScenePlaybackError playback={playback} />
      <div
        ref={viewport}
        className="scene-timeline-viewport"
        data-guide-id={GUIDE_TARGETS.sceneTimeline}
        tabIndex={0}
        aria-label="Action tracks"
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
          const audioDrag = audioGesture.current;
          if (audioDrag?.pointer === event.pointerId) {
            audioDrag.valid = document.changeAudioDrag(
              editAudioClipOnTimeline(
                scene,
                audioDrag.clip,
                audioDrag.edge,
                ((event.clientX - audioDrag.x) / audioDrag.width) * scene.duration,
                audioDrag.width,
                playback.time,
                snap && !event.altKey,
              ),
            );
            return;
          }
          const drag = gesture.current;
          const cameraDrag = cameraGesture.current;
          if (cameraDrag?.pointer === event.pointerId) {
            const time = snapSceneTime(
              scene,
              null,
              cameraDrag.time + ((event.clientX - cameraDrag.x) / cameraDrag.width) * scene.duration,
              cameraDrag.width,
              playback.time,
              snap && !event.altKey,
              0,
              scene.duration,
              cameraDrag,
            );
            cameraDrag.valid = document.changeCameraKeyDrag(time);
            return;
          }
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
              playback.time,
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
              playback.time,
              snap && !event.altKey,
              0,
              scene.duration - sceneActionDuration(action),
            );
            next = { ...action, time };
          }
          drag.valid = document.changeActionDrag(next);
        }}
        onPointerUp={(event) => {
          if (scrub.current === event.pointerId) {
            scrub.current = null;
            playback.flushSeek();
            event.currentTarget.releasePointerCapture(event.pointerId);
            return;
          }
          scrub.current = null;
          const audioDrag = audioGesture.current;
          if (audioDrag?.pointer === event.pointerId) {
            audioGesture.current = null;
            if (audioDrag.valid) document.endAudioDrag();
            else document.cancelAudioDrag();
            event.currentTarget.releasePointerCapture(event.pointerId);
            return;
          }
          const cameraDrag = cameraGesture.current;
          if (cameraDrag?.pointer === event.pointerId) {
            cameraGesture.current = null;
            if (cameraDrag.valid) document.endCameraDrag();
            else document.cancelCameraDrag();
            event.currentTarget.releasePointerCapture(event.pointerId);
            return;
          }
          const drag = gesture.current;
          if (!drag || drag.pointer !== event.pointerId) return;
          audioGesture.current = null;
          document.cancelAudioDrag();
          gesture.current = null;
          if (drag.valid) document.endActionDrag();
          else document.cancelActionDrag();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          playback.cancelSeek();
          scrub.current = null;
          audioGesture.current = null;
          document.cancelAudioDrag();
          gesture.current = null;
          document.cancelActionDrag();
          cameraGesture.current = null;
          document.cancelCameraDrag();
        }}
        onLostPointerCapture={() => {
          playback.cancelSeek();
          scrub.current = null;
          audioGesture.current = null;
          document.cancelAudioDrag();
          gesture.current = null;
          document.cancelActionDrag();
          cameraGesture.current = null;
          document.cancelCameraDrag();
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
                        aria-pressed={selectedActionIds.has(action.id)}
                        aria-label={`${actor.id}: ${action.type} ${action.id}`}
                        title={`${action.type} · ${action.time / 1000} s · ${duration / 1000} s`}
                        style={{
                          left: x(action.time),
                          width: duration ? Math.max(6, x(duration)) : 16,
                          top: lane * 26 + 4,
                        }}
                        onClick={(event) => {
                          if (event.detail === 0)
                            document.selectAction(action.id, event.ctrlKey || event.metaKey || event.shiftKey);
                        }}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          if (event.ctrlKey || event.metaKey || event.shiftKey) {
                            document.selectAction(action.id, true);
                            return;
                          }
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
          <div data-guide-id={GUIDE_TARGETS.sceneCameraTracks}>
            <div className="scene-track-row scene-camera-group">
              <button type="button" className="scene-track-label" onClick={() => document.selectCamera()}>
                Camera
              </button>
              <span className="workspace-caption">Center and zoom · scene clock</span>
            </div>
            {CAMERA_PROPERTIES.map((property) => (
              <div className="scene-track-row" key={property} style={{ height: 32 }}>
                <button type="button" className="scene-track-label" onClick={() => document.selectCamera()}>
                  {property === 'zoom' ? 'Zoom' : property.toUpperCase()}
                </button>
                <div className="scene-track-lane" style={{ width }} aria-label={`Camera ${property} keys`}>
                  {(scene.cameraTracks?.[property] ?? []).map((key) => (
                    <button
                      key={key.id}
                      type="button"
                      className="scene-action marker scene-camera-key"
                      aria-label={`Camera ${property} key at ${key.time / 1000} s`}
                      aria-pressed={
                        document.selectedCameraKey?.property === property &&
                        document.selectedCameraKey.key.id === key.id
                      }
                      title={`${key.value} · ${key.time / 1000} s · ${key.curve?.mode ?? 'linear'}`}
                      style={{ left: x(key.time), width: 16, top: 4 }}
                      onClick={() => {
                        playback.pause();
                        document.selectCameraKey(property, key.id);
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        viewport.current?.focus();
                        playback.pause();
                        if (!document.beginCameraKeyDrag(property, key.id)) return;
                        viewport.current?.setPointerCapture(event.pointerId);
                        cameraGesture.current = {
                          pointer: event.pointerId,
                          x: event.clientX,
                          time: key.time,
                          property,
                          id: key.id,
                          width,
                          valid: true,
                        };
                      }}
                    >
                      ◆
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="scene-track-row" data-guide-id={GUIDE_TARGETS.sceneTransitions} style={{ height: 62 }}>
            <span className="scene-track-label">Transitions</span>
            <div className="scene-track-lane" style={{ width }} aria-label="Scene transitions">
              {(scene.transitions ?? []).map((effect) => (
                <button
                  type="button"
                  key={effect.id}
                  className="scene-action clip scene-transition"
                  aria-label={`${effect.type === 'fade-in' ? 'Fade in' : 'Fade out'} at ${effect.time / 1000} s`}
                  aria-pressed={document.selectedTransition?.id === effect.id}
                  title={`${effect.type} · ${effect.time / 1000} s · ${effect.duration / 1000} s · ${effect.color}`}
                  style={{ left: x(effect.time), width: Math.max(6, x(effect.duration)), top: 4 }}
                  onClick={() => {
                    playback.pause();
                    document.selectTransition(effect.id);
                  }}
                >
                  {effect.type === 'fade-in' ? 'Fade in' : 'Fade out'}
                </button>
              ))}
              {cuts.map((time) => (
                <button
                  type="button"
                  key={`cut-${time}`}
                  className="scene-action marker scene-camera-key"
                  aria-label={`Camera cut at ${time / 1000} s`}
                  title={`Cut · ${time / 1000} s`}
                  style={{ left: x(time), width: 16, top: 32 }}
                  onClick={() => {
                    playback.seek(time);
                    for (const property of CAMERA_PROPERTIES) {
                      const keys = scene.cameraTracks?.[property] ?? [];
                      const index = keys.findIndex((key) => key.time === time);
                      if (index > 0 && keys[index - 1]?.curve?.mode === 'stepped') {
                        document.selectCameraKey(property, keys[index]!.id);
                        break;
                      }
                    }
                  }}
                >
                  ◆
                </button>
              ))}
            </div>
          </div>
          <SceneDialogueTrack scene={scene} document={document} playback={playback} width={width} x={x} />
          <SceneAudioTracks
            scene={scene}
            document={document}
            width={width}
            x={x}
            beginDrag={(event, clip) => {
              if (event.button !== 0) return;
              event.preventDefault();
              viewport.current?.focus();
              playback.pause();
              if (!document.beginAudioDrag(clip.id)) return;
              viewport.current?.setPointerCapture(event.pointerId);
              const edge = (event.target as HTMLElement).dataset.audioEdge;
              audioGesture.current = {
                pointer: event.pointerId,
                x: event.clientX,
                clip: { ...clip },
                edge: edge === 'start' || edge === 'end' ? edge : 'move',
                width,
                valid: true,
              };
            }}
          />
          <ScenePlayhead playback={playback} duration={scene.duration} width={width} />
        </div>
      </div>
    </>
  );
}
