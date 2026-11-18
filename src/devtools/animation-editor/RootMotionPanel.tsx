import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { ANIMATION_IDS } from './elementIds.js';

export function RootMotionPanel() {
  return (
    <div id={ANIMATION_IDS.rootMotionPanel} data-guide-id={GUIDE_TARGETS.animationRootMotion}>
      <p>
        Move the whole character independently of bones and IK. X points right; Y points down before facing and scale.
      </p>
      <label>
        <input id={ANIMATION_IDS.rootEditMode} type="checkbox" /> Edit Root Motion
      </label>
      <label>
        World displacement
        <select id={ANIMATION_IDS.rootDisplacementMode} aria-label="World displacement" defaultValue="authored">
          <option value="authored">Authored Root Motion</option>
          <option value="preview">Preview-Only Displacement</option>
          <option value="none">No World Displacement</option>
        </select>
      </label>
      <label>
        <input id={ANIMATION_IDS.rootShowTrajectory} type="checkbox" defaultChecked /> Show root trajectory
      </label>
      <label>
        Root loop behavior
        <select id={ANIMATION_IDS.rootLoopMode} aria-label="Root loop behavior" defaultValue="reset">
          <option value="reset">Reset each cycle</option>
          <option value="continuous">Continuous travel</option>
        </select>
      </label>
      <p className="workspace-caption">
        Authored travel uses the first root sample as its origin, transformed once by facing, scale and rotation.
        Continuous travel adds each cycle's end-minus-start displacement when Loop preview is enabled. Direct seeking
        starts in the first cycle. Editing the root shows that cycle and pauses camera follow. No World Displacement
        retains skeletal motion, including bone translation.
      </p>
      <form id={ANIMATION_IDS.rootPositionForm} className="root-motion-fields">
        <label>
          Position X<input id={ANIMATION_IDS.rootX} type="number" step="any" />
        </label>
        <label>
          Position Y<input id={ANIMATION_IDS.rootY} type="number" step="any" />
        </label>
        <button type="submit" className="workspace-primary">
          Set position key
        </button>
      </form>
      <button id={ANIMATION_IDS.rootAddKey} type="button" className="workspace-primary">
        Add root position key
      </button>
      <p>
        Select a Position X or Position Y timeline key to edit its time and value. Use Graph Editor for interpolation
        and tangents.
      </p>
      <form id={ANIMATION_IDS.rootKeyForm} className="root-motion-fields">
        <label>
          Key time (s)
          <input id={ANIMATION_IDS.rootKeyTime} type="number" min="0" step="any" />
        </label>
        <label>
          Key value
          <input id={ANIMATION_IDS.rootKeyValue} type="number" step="any" />
        </label>
        <button id={ANIMATION_IDS.rootApplyKey} type="submit">
          Apply key
        </button>
      </form>
      <div className="root-motion-actions">
        <button id={ANIMATION_IDS.rootDuplicateKey} type="button">
          Duplicate key
        </button>
        <button id={ANIMATION_IDS.rootDeleteKey} type="button" className="workspace-danger">
          Delete key
        </button>
      </div>
      <p>
        Drag the purple square at the character origin. Release commits both axes; Escape cancels. Middle drag pans;
        wheel zooms.
      </p>
      <p id={ANIMATION_IDS.rootMotionStatus} role="status" />
    </div>
  );
}
