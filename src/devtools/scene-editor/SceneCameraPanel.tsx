import { CINEMATIC_CAMERA_MAX_ZOOM, CINEMATIC_CAMERA_MIN_ZOOM } from '../../engine/cinematicCamera.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';

/** Disclosure state belongs to React/DOM; camera values use scene history. */
export function SceneCameraPanel({ document }: { document: SceneEditorDocument }) {
  const camera = document.cinematicCamera;
  return (
    <details className="scene-camera">
      <summary>Cinematic Camera</summary>
      <div className="scene-artwork-commands">
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
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
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
              step="any"
              required
              defaultValue={camera[field]}
              {...(field === 'zoom' ? { min: CINEMATIC_CAMERA_MIN_ZOOM, max: CINEMATIC_CAMERA_MAX_ZOOM } : {})}
            />
          </label>
        ))}
        <button type="submit" disabled={document.hasActiveGesture}>
          Apply camera
        </button>
      </form>
      <div className="scene-artwork-commands">
        <button type="button" disabled={document.hasActiveGesture} onClick={() => document.resetCamera()}>
          Reset Camera
        </button>
        <button
          type="button"
          data-guide-id={GUIDE_TARGETS.sceneCameraFrameActor}
          disabled={!document.selectedActorId || document.hasActiveGesture}
          onClick={() => document.frameSelectedActor()}
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
        origin and retain zoom. Camera edits use scene Undo/Redo. View navigation is independent.
      </p>
    </details>
  );
}
