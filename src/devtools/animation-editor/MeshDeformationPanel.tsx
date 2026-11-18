import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { ANIMATION_IDS } from './elementIds.js';

export function MeshDeformationPanel() {
  return (
    <div id={ANIMATION_IDS.meshDeformationPanel}>
      <label className="deformation-toggle" data-guide-id={GUIDE_TARGETS.animationDeformationMode}>
        <input id={ANIMATION_IDS.deformationEditMode} type="checkbox" />
        <span>Edit Mesh Deformation</span>
      </label>
      <p className="animation-field-help">
        Bind-space correction mode. Square handles edit attachment-local offsets before bone skinning. The main preview
        shows the final posed silhouette.
      </p>
      <label data-guide-id={GUIDE_TARGETS.animationDeformationMesh}>
        Mesh
        <select id={ANIMATION_IDS.deformationMesh} aria-label="Deformable mesh" />
      </label>
      <label className="deformation-toggle">
        <input id={ANIMATION_IDS.deformationDiagnostics} type="checkbox" />
        <span>Show mesh diagnostics</span>
      </label>
      <p id={ANIMATION_IDS.meshDiagnosticsStatus} hidden />
      <p id={ANIMATION_IDS.deformationEmpty} />
      <svg
        id={ANIMATION_IDS.deformationBindView}
        className="deformation-bind-view"
        aria-label="Bind-space mesh corrections"
      />
      <label data-guide-id={GUIDE_TARGETS.animationDeformationVertex}>
        Vertex
        <select id={ANIMATION_IDS.deformationVertex} aria-label="Mesh vertex" />
      </label>
      <form
        data-guide-id={GUIDE_TARGETS.animationDeformationOffsets}
        id={ANIMATION_IDS.deformationOffsetForm}
        className="root-motion-fields"
      >
        <label>
          Offset X
          <input id={ANIMATION_IDS.deformationX} type="number" step="any" required />
        </label>
        <label>
          Offset Y
          <input id={ANIMATION_IDS.deformationY} type="number" step="any" required />
        </label>
        <button type="submit" className="workspace-primary">
          Set vertex correction key
        </button>
      </form>
      <div data-guide-id={GUIDE_TARGETS.animationDeformationShapes} className="root-motion-actions">
        <button id={ANIMATION_IDS.deformationAddKey} className="workspace-primary" type="button">
          Add shape key
        </button>
        <button id={ANIMATION_IDS.deformationNeutral} type="button">
          Set neutral key
        </button>
      </div>
      <p className="animation-field-help">
        Missing vertices mean zero offset. Add neutral keys before and after a correction to return smoothly to ordinary
        skinning. Drag a square to edit a vertex; Shift-click selects more vertices. Escape cancels a drag.
      </p>
      <form
        data-guide-id={GUIDE_TARGETS.animationDeformationTiming}
        id={ANIMATION_IDS.deformationKeyForm}
        className="root-motion-fields"
      >
        <label>
          Key time (s)
          <input id={ANIMATION_IDS.deformationKeyTime} type="number" min="0" step="any" required />
        </label>
        <label>
          Outgoing interpolation
          <select id={ANIMATION_IDS.deformationCurve} defaultValue="linear">
            <option value="linear">Linear</option>
            <option value="stepped">Stepped</option>
          </select>
        </label>
        <button id={ANIMATION_IDS.deformationApplyKey} type="submit">
          Apply key
        </button>
      </form>
      <div className="root-motion-actions">
        <button id={ANIMATION_IDS.deformationDuplicateKey} type="button">
          Duplicate key
        </button>
        <button id={ANIMATION_IDS.deformationDeleteKey} type="button" className="workspace-danger">
          Delete key
        </button>
      </div>
      <p className="animation-field-help" data-guide-id={GUIDE_TARGETS.animationDeformationCompatibility}>
        Timeline keys support drag, arrow nudges, Delete, Copy/Paste and Duplicate. Bézier curves imported through JSON
        are preserved; editing interpolation here replaces them. Graph Editor displays bone, IK and root channels only.
        Mirroring and Pose Library change bones and preserve mesh corrections unchanged. Variations scale correction
        times; IK baking preserves corrections; Motion Diagnostics measures bones.
      </p>
      <p id={ANIMATION_IDS.deformationTopology} role="status" />
      <button id={ANIMATION_IDS.deformationRemoveIncompatible} className="workspace-danger" type="button" hidden>
        Remove incompatible tracks
      </button>
      <p id={ANIMATION_IDS.deformationStatus} role="status" />
    </div>
  );
}
