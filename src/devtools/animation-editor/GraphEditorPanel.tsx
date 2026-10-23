import { GUIDE_TARGETS } from '../shared/guides/anchors.js';

/** React owns stable controls; GraphEditorController owns SVG children and transient gestures. */
export function GraphEditorPanel() {
  return (
    <section id="graph-editor" className="graph-editor" aria-label="Graph Editor" hidden data-tool-panel>
      <div className="graph-controls" data-guide-id={GUIDE_TARGETS.animationGraphNavigation}>
        <span id="graph-target" />
        <label>
          Property{' '}
          <select
            id="graph-property"
            aria-label="Graph property"
            data-guide-id={GUIDE_TARGETS.animationGraphProperty}
          />
        </label>
        <button id="graph-fit" type="button" title="Fit all keys without changing authored data">
          Fit graph
        </button>
        <button id="graph-zoom-in" type="button" aria-label="Zoom graph in">
          +
        </button>
        <button id="graph-zoom-out" type="button" aria-label="Zoom graph out">
          −
        </button>
      </div>
      <svg
        id="graph-canvas"
        data-guide-id={GUIDE_TARGETS.animationGraphCanvas}
        role="group"
        aria-label="Property curve. Wheel to zoom, middle drag to pan, click the plot to scrub."
        tabIndex={0}
      >
        <g id="graph-drawing" />
        <line id="graph-playhead" className="graph-playhead" aria-label="Current playhead" />
      </svg>
      <form
        id="graph-key-form"
        className="graph-controls"
        aria-label="Graph key precision editing"
        data-guide-id={GUIDE_TARGETS.animationGraphKeys}
      >
        <label>
          Key time (s) <input id="graph-key-time" type="number" min="0" step="any" required />
        </label>
        <label>
          Value <input id="graph-key-value" type="number" step="any" required />
        </label>
        <button id="graph-apply" type="submit">
          Apply key
        </button>
        <label title="Outgoing segment only. Auto inherits the clip's linear default; Stepped holds the value until the next key.">
          Interpolation
          <select
            id="graph-interpolation"
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
          id="graph-reset-handles"
          type="button"
          title="Reset to horizontal endpoint tangents at one third and two thirds of the segment"
        >
          Reset handles
        </button>
      </form>
      <details className="graph-tangent-details">
        <summary>Tangent precision</summary>
        <form
          id="graph-handle-form"
          className="graph-controls"
          aria-label="Tangent precision editing"
          data-guide-id={GUIDE_TARGETS.animationGraphTangents}
        >
          {(['control1', 'control2'] as const).flatMap((handle, index) =>
            (['x', 'y'] as const).map((axis) => (
              <label key={`${handle}-${axis}`}>
                {index === 0 ? 'Outgoing' : 'Incoming'} {axis === 'x' ? 'time' : 'progress'}
                <input
                  id={`graph-${handle}-${axis}`}
                  aria-label={`${handle} ${axis}`}
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  required
                />
              </label>
            )),
          )}
          <button id="graph-apply-handles" type="submit">
            Apply handles
          </button>
        </form>
      </details>
      <p id="graph-status" className="workspace-caption" role="status" />
      <p className="workspace-caption graph-help">
        Drag keys to edit time/value; Shift bypasses frame snapping. Tangents control normalized segment time/progress
        (0–1). Wheel zooms, middle drag pans, F fits. Delete removes shared selected keys; Escape cancels a drag.
      </p>
    </section>
  );
}
