import { useSyncExternalStore } from 'react';
import type { PropertyCurve } from '../../engine/animationCurves.js';
import {
  CINEMATIC_CAMERA_MAX_ZOOM,
  CINEMATIC_CAMERA_MIN_ZOOM,
  DEFAULT_CINEMATIC_CAMERA,
} from '../../engine/cinematicCamera.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';

/** Disclosure state belongs to React/DOM; camera values use scene history. */
export function SceneCameraPanel({
  document,
  playback,
}: {
  document: SceneEditorDocument;
  playback: SceneEditorPlayback;
}) {
  useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getSnapshot);
  const camera = document.cameraKeyEditing
    ? document.cinematicCamera
    : (document.workingScene?.camera ?? DEFAULT_CINEMATIC_CAMERA);
  return (
    <details className="scene-camera">
      <summary>Cinematic Camera</summary>
      <div className="scene-artwork-commands">
        <label className="scene-artwork-visibility" data-guide-id={GUIDE_TARGETS.sceneCameraKeyMode}>
          <input
            type="checkbox"
            checked={document.cameraKeyEditing}
            onChange={(event) => {
              playback.pause();
              document.setCameraKeyEditing(event.target.checked);
            }}
          />
          Camera Key Edit mode
        </label>
        <button
          type="button"
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
          data-guide-id={GUIDE_TARGETS.sceneCameraSelect}
          aria-pressed={document.cameraSelected}
          onClick={() => document.selectCamera(!document.cameraSelected)}
        >
          Select Cinematic Camera
        </button>
      </div>
      <form
        data-guide-id={GUIDE_TARGETS.sceneCameraKeyValues}
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          playback.pause();
          document.updateCamera({
            x: Number(values.get('x')),
            y: Number(values.get('y')),
            zoom: Number(values.get('zoom')),
          });
        }}
      >
        {(
          [
            ['Center X', 'x'],
            ['Center Y', 'y'],
            ['Camera zoom', 'zoom'],
          ] as const
        ).map(([label, field]) => (
          <label
            key={`${document.selectedSceneId}-${field}-${camera[field]}`}
            data-guide-id={
              field === 'x'
                ? GUIDE_TARGETS.sceneCameraCenter
                : field === 'zoom'
                  ? GUIDE_TARGETS.sceneCameraZoom
                  : undefined
            }
          >
            {label}
            <input
              type="number"
              name={field}
              onFocus={() => playback.pause()}
              step="any"
              required
              defaultValue={camera[field]}
              {...(field === 'zoom' ? { min: CINEMATIC_CAMERA_MIN_ZOOM, max: CINEMATIC_CAMERA_MAX_ZOOM } : {})}
            />
          </label>
        ))}
        <button type="submit" disabled={document.hasActiveGesture}>
          {document.cameraKeyEditing ? 'Apply camera key' : 'Apply camera'}
        </button>
      </form>
      <div className="scene-artwork-commands">
        <button
          type="button"
          disabled={document.hasActiveGesture}
          onClick={() => {
            playback.pause();
            document.resetCamera();
          }}
        >
          Reset Camera
        </button>
        <button
          type="button"
          data-guide-id={GUIDE_TARGETS.sceneCameraFrameActor}
          disabled={!document.selectedActorId || document.hasActiveGesture}
          onClick={() => {
            playback.pause();
            document.frameSelectedActor();
          }}
        >
          Frame Selected Actor
        </button>
        <button
          type="button"
          aria-pressed={document.cameraPreviewing}
          onClick={() => document.setCameraPreview(!document.cameraPreviewing)}
        >
          {document.cameraPreviewing ? 'Exit Camera Preview' : 'Preview Through Camera'}
        </button>
      </div>
      <p className="workspace-caption">
        1000 × 700 · 10:7 output. Center coordinates use scene pixels. Select the camera and drag its center or frame
        edge. Frame Selected Actor fits current rendered bounds with 20% space; unavailable bounds use the initial Actor
        origin and retain zoom. In Camera Key Edit mode, Apply, Reset, framing and frame dragging author keys at{' '}
        {playback.time / 1000} s. Otherwise controls edit initial settings; animated frames require Key Edit mode to
        drag. Set Camera Key explicitly captures all three channels. View navigation never creates keys. Camera edits
        use scene Undo/Redo.
      </p>
      <CameraKeyInspector document={document} playback={playback} />
    </details>
  );
}

function CameraKeyInspector({ document, playback }: { document: SceneEditorDocument; playback: SceneEditorPlayback }) {
  const selected = document.selectedCameraKey;
  const key = selected?.key;
  const curve = key?.curve;
  const changeCurve = (mode: string): void => {
    if (!selected) return;
    playback.pause();
    const next: PropertyCurve =
      mode === 'smooth' || mode === 'bezier'
        ? { mode: 'bezier', control1: { x: 0.42, y: 0 }, control2: { x: 0.58, y: 1 } }
        : { mode: mode === 'stepped' ? 'stepped' : 'linear' };
    document.updateCameraKey(selected.property, selected.key.id, { curve: next });
  };
  return (
    <details className="scene-camera-key-inspector" data-guide-id={GUIDE_TARGETS.sceneCameraKeyProperties}>
      <summary>Selected camera key</summary>
      {selected && key ? (
        <>
          <p className="workspace-caption">
            {selected.property.toUpperCase()} · {key.id}. Interpolation controls the outgoing segment. Duplicate times
            in one channel are rejected.
          </p>
          <form
            key={`${selected.property}-${key.id}-${key.time}-${key.value}-${JSON.stringify(curve)}`}
            onSubmit={(event) => {
              event.preventDefault();
              playback.pause();
              const values = new FormData(event.currentTarget);
              document.updateCameraKey(selected.property, key.id, {
                time: Number(values.get('time')) * 1000,
                value: Number(values.get('value')),
                ...(curve?.mode === 'bezier'
                  ? {
                      curve: {
                        mode: 'bezier' as const,
                        control1: { x: Number(values.get('c1x')), y: Number(values.get('c1y')) },
                        control2: { x: Number(values.get('c2x')), y: Number(values.get('c2y')) },
                      },
                    }
                  : {}),
              });
            }}
          >
            <label>
              Camera key time (s)
              <input
                name="time"
                type="number"
                step="any"
                min="0"
                max={(document.workingScene?.duration ?? 0) / 1000}
                defaultValue={key.time / 1000}
                required
              />
            </label>
            <label>
              Camera key value
              <input
                name="value"
                type="number"
                step="any"
                defaultValue={key.value}
                required
                {...(selected.property === 'zoom'
                  ? { min: CINEMATIC_CAMERA_MIN_ZOOM, max: CINEMATIC_CAMERA_MAX_ZOOM }
                  : {})}
              />
            </label>
            {curve?.mode === 'bezier' &&
              (['control1', 'control2'] as const).flatMap((control, index) =>
                (['x', 'y'] as const).map((axis) => (
                  <label key={`${control}-${axis}`}>
                    Camera Bézier {index + 1} {axis.toUpperCase()}
                    <input
                      name={`c${index + 1}${axis}`}
                      type="number"
                      min="0"
                      max="1"
                      step="any"
                      defaultValue={curve[control][axis]}
                      required
                    />
                  </label>
                )),
              )}
            <button type="submit" disabled={document.hasActiveGesture}>
              Apply selected camera key
            </button>
          </form>
          <label data-guide-id={GUIDE_TARGETS.sceneCameraKeyCurves}>
            Camera key interpolation
            <select
              aria-label="Camera key interpolation"
              value={curve?.mode ?? 'linear'}
              disabled={document.hasActiveGesture}
              onChange={(event) => changeCurve(event.target.value)}
            >
              <option value="linear">Linear</option>
              <option value="stepped">Stepped</option>
              <option value="smooth">Smooth / eased preset</option>
              <option value="bezier">Bézier</option>
            </select>
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              playback.pause();
              document.duplicateCameraKey(
                selected.property,
                key.id,
                Number(new FormData(event.currentTarget).get('duplicateTime')) * 1000,
              );
            }}
          >
            <label>
              Duplicate camera key at (s)
              <input
                name="duplicateTime"
                type="number"
                min="0"
                max={(document.workingScene?.duration ?? 0) / 1000}
                step="any"
                defaultValue={Math.min(key.time + 1000, document.workingScene?.duration ?? 0) / 1000}
                required
              />
            </label>
            <button type="submit" disabled={document.hasActiveGesture}>
              Duplicate camera key
            </button>
          </form>
          <button
            type="button"
            className="workspace-danger"
            disabled={document.hasActiveGesture}
            onClick={() => {
              playback.pause();
              document.removeCameraKey(selected.property, key.id);
            }}
          >
            Delete camera key
          </button>
        </>
      ) : (
        <div data-guide-id={GUIDE_TARGETS.sceneCameraKeyCurves}>
          <p className="workspace-caption">
            Select a camera key in the timeline to inspect its time, value and outgoing curve. Then choose Linear,
            Stepped, Smooth / eased preset or Bézier; Bézier exposes normalized handle coordinates. No keys yet? Use Set
            Camera Key at the playhead after exiting the guide.
          </p>
        </div>
      )}
    </details>
  );
}
