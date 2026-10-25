import { GUIDE_TARGETS } from '../shared/guides/anchors.js';

export function RootMotionPanel() {
  return (
    <details id="root-motion-panel" data-guide-id={GUIDE_TARGETS.animationRootMotion}>
      <summary>Root Motion</summary>
      <p>
        Move the whole character independently of bones and IK. X points right; Y points down before facing and scale.
      </p>
      <label>
        <input id="root-edit-mode" type="checkbox" /> Edit Root Motion
      </label>
      <label>
        <input id="root-show-motion" type="checkbox" defaultChecked /> Show authored root motion
      </label>
      <label>
        <input id="root-show-trajectory" type="checkbox" defaultChecked /> Show root trajectory
      </label>
      <form id="root-position-form" className="root-motion-fields">
        <label>
          Position X<input id="root-x" type="number" step="any" />
        </label>
        <label>
          Position Y<input id="root-y" type="number" step="any" />
        </label>
        <button type="submit" className="workspace-primary">
          Set position key
        </button>
      </form>
      <button id="root-add-key" type="button" className="workspace-primary">
        Add root position key
      </button>
      <p>
        Select a Position X or Position Y timeline key to edit its time and value. Use Graph Editor for interpolation
        and tangents.
      </p>
      <form id="root-key-form" className="root-motion-fields">
        <label>
          Key time (s)
          <input id="root-key-time" type="number" min="0" step="any" />
        </label>
        <label>
          Key value
          <input id="root-key-value" type="number" step="any" />
        </label>
        <button id="root-apply-key" type="submit">
          Apply key
        </button>
      </form>
      <div className="root-motion-actions">
        <button id="root-duplicate-key" type="button">
          Duplicate key
        </button>
        <button id="root-delete-key" type="button" className="workspace-danger">
          Delete key
        </button>
      </div>
      <p>
        Drag the purple square at the character origin. Release commits both axes; Escape cancels. Middle drag pans;
        wheel zooms.
      </p>
      <p id="root-motion-status" role="status" />
    </details>
  );
}
