import { GUIDE_TARGETS } from '../shared/guides/anchors.js';

export function MeshDeformationPanel() {
  return (
    <div id="mesh-deformation-panel">
      <label className="deformation-toggle" data-guide-id={GUIDE_TARGETS.animationDeformationMode}>
        <input id="deformation-edit-mode" type="checkbox" />
        <span>Edit Mesh Deformation</span>
      </label>
      <p className="animation-field-help">
        Bind-space correction mode. Square handles edit attachment-local offsets before bone skinning. The main preview
        shows the final posed silhouette.
      </p>
      <label data-guide-id={GUIDE_TARGETS.animationDeformationMesh}>
        Mesh
        <select id="deformation-mesh" aria-label="Deformable mesh" />
      </label>
      <label className="deformation-toggle">
        <input id="deformation-diagnostics" type="checkbox" />
        <span>Show mesh diagnostics</span>
      </label>
      <p id="animation-mesh-diagnostics-status" hidden />
      <p id="deformation-empty" />
      <svg id="deformation-bind-view" className="deformation-bind-view" aria-label="Bind-space mesh corrections" />
      <label data-guide-id={GUIDE_TARGETS.animationDeformationVertex}>
        Vertex
        <select id="deformation-vertex" aria-label="Mesh vertex" />
      </label>
      <form
        data-guide-id={GUIDE_TARGETS.animationDeformationOffsets}
        id="deformation-offset-form"
        className="root-motion-fields"
      >
        <label>
          Offset X<input id="deformation-x" type="number" step="any" required />
        </label>
        <label>
          Offset Y<input id="deformation-y" type="number" step="any" required />
        </label>
        <button type="submit" className="workspace-primary">
          Set vertex correction key
        </button>
      </form>
      <div data-guide-id={GUIDE_TARGETS.animationDeformationShapes} className="root-motion-actions">
        <button id="deformation-add-key" className="workspace-primary" type="button">
          Add shape key
        </button>
        <button id="deformation-neutral" type="button">
          Set neutral key
        </button>
      </div>
      <p className="animation-field-help">
        Missing vertices mean zero offset. Add neutral keys before and after a correction to return smoothly to ordinary
        skinning. Drag a square to edit a vertex; Shift-click selects more vertices. Escape cancels a drag.
      </p>
      <form
        data-guide-id={GUIDE_TARGETS.animationDeformationTiming}
        id="deformation-key-form"
        className="root-motion-fields"
      >
        <label>
          Key time (s)
          <input id="deformation-key-time" type="number" min="0" step="any" required />
        </label>
        <label>
          Outgoing interpolation
          <select id="deformation-curve" defaultValue="linear">
            <option value="linear">Linear</option>
            <option value="stepped">Stepped</option>
          </select>
        </label>
        <button id="deformation-apply-key" type="submit">
          Apply key
        </button>
      </form>
      <div className="root-motion-actions">
        <button id="deformation-duplicate-key" type="button">
          Duplicate key
        </button>
        <button id="deformation-delete-key" type="button" className="workspace-danger">
          Delete key
        </button>
      </div>
      <p className="animation-field-help" data-guide-id={GUIDE_TARGETS.animationDeformationCompatibility}>
        Timeline keys support drag, arrow nudges, Delete, Copy/Paste and Duplicate. Bézier curves imported through JSON
        are preserved; editing interpolation here replaces them. Graph Editor displays bone, IK and root channels only.
        Mirroring and Pose Library change bones and preserve mesh corrections unchanged. Variations scale correction
        times; IK baking preserves corrections; Motion Diagnostics measures bones.
      </p>
      <p id="deformation-topology" role="status" />
      <button id="deformation-remove-incompatible" className="workspace-danger" type="button" hidden>
        Remove incompatible tracks
      </button>
      <p id="deformation-status" role="status" />
    </div>
  );
}
