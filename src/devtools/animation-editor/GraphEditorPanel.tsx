import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { ANIMATION_IDS } from './elementIds.js';

/** React owns stable controls; GraphEditorController owns SVG children and transient gestures. */
export function GraphEditorPanel() {
  return (
    <section id={ANIMATION_IDS.graphEditor} className="graph-editor" aria-label="Graph Editor" hidden data-tool-panel>
      <div className="graph-controls" data-guide-id={GUIDE_TARGETS.animationGraphNavigation}>
        <span id={ANIMATION_IDS.graphTarget} />
        <label>
          Property{' '}
          <select
            id={ANIMATION_IDS.graphProperty}
            aria-label="Graph property"
            data-guide-id={GUIDE_TARGETS.animationGraphProperty}
          />
        </label>
        <button id={ANIMATION_IDS.graphFit} type="button" title="Fit all keys without changing authored data">
          Fit graph
        </button>
        <button id={ANIMATION_IDS.graphZoomIn} type="button" aria-label="Zoom graph in">
          +
        </button>
        <button id={ANIMATION_IDS.graphZoomOut} type="button" aria-label="Zoom graph out">
          −
        </button>
      </div>
      <svg
        id={ANIMATION_IDS.graphCanvas}
        data-guide-id={GUIDE_TARGETS.animationGraphCanvas}
        role="group"
        aria-label="Property curve. Wheel to zoom, middle drag to pan, click the plot to scrub."
        tabIndex={0}
      >
        <g id={ANIMATION_IDS.graphDrawing} />
        <line id={ANIMATION_IDS.graphPlayhead} className="graph-playhead" aria-label="Current playhead" />
      </svg>
      <form
        id={ANIMATION_IDS.graphKeyForm}
        className="graph-controls"
        aria-label="Graph key precision editing"
        data-guide-id={GUIDE_TARGETS.animationGraphKeys}
      >
        <label>
          Key time (s) <input id={ANIMATION_IDS.graphKeyTime} type="number" min="0" step="any" required />
        </label>
        <label>
          Value <input id={ANIMATION_IDS.graphKeyValue} type="number" step="any" required />
        </label>
        <button id={ANIMATION_IDS.graphApply} type="submit">
          Apply key
        </button>
        <label title="Outgoing segment only. Auto inherits the clip's linear default; Stepped holds the value until the next key.">
          Interpolation
          <select
            id={ANIMATION_IDS.graphInterpolation}
            aria-label="Graph interpolation"
            data-guide-id={GUIDE_TARGETS.animationGraphInterpolation}
          >
            <option value="auto">Auto (clip default)</option>
            <option value="linear">Linear</option>
            <option value="stepped">Stepped</option>
            <option value="bezier">Bézier</option>
          </select>
        </label>
        <button
          id={ANIMATION_IDS.graphResetHandles}
          type="button"
          title="Reset to horizontal endpoint tangents at one third and two thirds of the segment"
        >
          Reset handles
        </button>
      </form>
      <details className="graph-tangent-details">
        <summary>Tangent precision</summary>
        <form
          id={ANIMATION_IDS.graphHandleForm}
          className="graph-controls"
          aria-label="Tangent precision editing"
          data-guide-id={GUIDE_TARGETS.animationGraphTangents}
        >
          {(['control1', 'control2'] as const).flatMap((handle, index) =>
            (['x', 'y'] as const).map((axis) => (
              <label key={`${handle}-${axis}`}>
                {index === 0 ? 'Outgoing' : 'Incoming'} {axis === 'x' ? 'time' : 'progress'}
                <input id={`graph-${handle}-${axis}`} type="number" min="0" max="1" step="any" required />
              </label>
            )),
          )}
          <button id={ANIMATION_IDS.graphApplyHandles} type="submit">
            Apply handles
          </button>
        </form>
      </details>
      <p id={ANIMATION_IDS.graphStatus} className="workspace-caption" role="status" />
      <p className="workspace-caption graph-help">
        Drag keys to edit time/value; Shift bypasses frame snapping. Tangents control normalized segment time/progress
        (0–1). Wheel zooms, middle drag pans, F fits. Delete removes shared selected keys; Escape cancels a drag.
      </p>
    </section>
  );
}
