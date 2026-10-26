import { useSyncExternalStore } from 'react';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { MotionPreviewController } from './MotionPreviewController.js';
import { toMilliseconds, toSeconds } from './timeUnits.js';

export function MotionPreviewPanel({ controller }: { controller: MotionPreviewController }) {
  const { settings, ready, clipId, message, copying } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  return (
    <div className="motion-preview-panel">
      <fieldset disabled={!ready}>
        <label data-guide-id={GUIDE_TARGETS.animationDisplacementEnable}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => controller.update({ enabled: event.target.checked })}
          />{' '}
          Use Preview-Only Displacement
        </label>
        <p className="workspace-caption">
          Select Authored Root Motion, Preview-Only Displacement or No World Displacement in Root Motion. Preview-only
          travel replaces authored root translation in the preview; skeletal and IK tracks still play.
        </p>
        <p className="workspace-caption">
          X moves right, Y down in world pixels, independent of facing and scale. Times are animation seconds; stepped
          playback holds the same pose and displacement sample. Points and Loop preview belong to this clip’s editor
          preferences and survive local recovery and project ZIPs.
        </p>
        <label data-guide-id={GUIDE_TARGETS.animationDisplacementInterpolation}>
          Trajectory interpolation
          <select
            aria-label="Trajectory interpolation"
            value={settings.interpolation}
            onChange={(event) => controller.update({ interpolation: event.target.value as 'linear' | 'stepped' })}
          >
            <option value="linear">Linear</option>
            <option value="stepped">Stepped</option>
          </select>
        </label>
        <label data-guide-id={GUIDE_TARGETS.animationDisplacementTrajectory}>
          <input
            type="checkbox"
            checked={settings.showTrajectory}
            onChange={(event) => controller.update({ showTrajectory: event.target.checked })}
          />{' '}
          Show preview trajectory
        </label>
        <div
          className="motion-preview-points"
          aria-label="Preview position points"
          data-guide-id={GUIDE_TARGETS.animationDisplacementPoints}
        >
          {!settings.positionKeys.length && (
            <p className="workspace-caption">No preview points. Add a position point to define a trajectory.</p>
          )}
          {settings.positionKeys.map((point, index) => (
            <form
              key={`${clipId}:${index}:${point.time}:${point.offsetX}:${point.offsetY}`}
              aria-label={`Preview point ${index + 1}`}
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                controller.editPoint(index, {
                  time: toMilliseconds(Number(values.get('time'))),
                  offsetX: Number(values.get('x')),
                  offsetY: Number(values.get('y')),
                });
              }}
            >
              <label>
                Time (s)
                <input name="time" type="number" min="0" step="any" required defaultValue={toSeconds(point.time)} />
              </label>
              <label>
                Offset X<input name="x" type="number" step="any" required defaultValue={point.offsetX} />
              </label>
              <label>
                Offset Y<input name="y" type="number" step="any" required defaultValue={point.offsetY} />
              </label>
              <div className="animation-history">
                <button type="submit">Apply point {index + 1}</button>
                <button
                  type="button"
                  className="workspace-danger"
                  aria-label={`Remove preview point ${index + 1}`}
                  onClick={() => controller.removePoint(index)}
                >
                  Remove
                </button>
              </div>
            </form>
          ))}
        </div>
        <div className="animation-history">
          <button
            type="button"
            className="workspace-primary"
            data-guide-id={GUIDE_TARGETS.animationDisplacementAdd}
            onClick={() => controller.addPoint()}
          >
            Add position point
          </button>
          <button
            type="button"
            data-guide-id={GUIDE_TARGETS.animationDisplacementReset}
            onClick={() => controller.reset()}
          >
            Reset trajectory
          </button>
        </div>
        <p className="workspace-caption">
          Copy Preview Trajectory to Root Motion converts world pixels through the current facing, rotation and scale.
          Start the trajectory at X 0, Y 0. Preview first; applying replaces existing root keys and retains these
          points.
        </p>
        <div className="animation-history">
          <button type="button" disabled={!settings.positionKeys.length} onClick={() => controller.previewCopy()}>
            Preview Copy to Root Motion
          </button>
          <button type="button" disabled={!copying} onClick={() => controller.commitCopy()}>
            Apply Copy — Replace Root Keys
          </button>
          <button type="button" disabled={!copying} onClick={() => controller.cancelCopy()}>
            Cancel copy preview
          </button>
        </div>
      </fieldset>
      {!clipId && <p className="workspace-caption">Select an animation to edit its preview trajectory.</p>}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
