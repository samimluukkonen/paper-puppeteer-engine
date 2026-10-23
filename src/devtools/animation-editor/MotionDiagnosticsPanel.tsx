import { useEffect, useSyncExternalStore } from 'react';
import { GUIDE_TARGETS as targets } from '../shared/guides/anchors.js';
import type { MotionDiagnosticOptions } from './motionDiagnostics.js';
import type { MotionDiagnosticsController } from './MotionDiagnosticsController.js';

const controls: readonly [keyof MotionDiagnosticOptions, string][] = [
  ['rotationChange', 'Large rotation (rad)'],
  ['rotationSpeed', 'Rapid rotation (rad/s)'],
  ['positionChange', 'Large translation (units)'],
  ['positionSpeed', 'Rapid translation (units/s)'],
  ['speedRatio', 'Sudden speed ratio'],
  ['rotationTolerance', 'Rotation tolerance (rad)'],
  ['positionTolerance', 'Position tolerance (units)'],
  ['scaleTolerance', 'Scale tolerance'],
];
export function MotionDiagnosticsPanel({ controller }: { controller: MotionDiagnosticsController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => () => controller.cancel(), [controller]);
  return (
    <details
      id="animation-motion-panel"
      data-tool-panel
      className="animation-popover"
      onToggle={(event) => {
        if (!event.currentTarget.open) controller.cancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        controller.cancel();
        document.querySelector<HTMLElement>('#animation-authoring-tools > summary')?.focus();
      }}
    >
      <summary>Motion Diagnostics</summary>
      <section className="animation-popover-content animation-motion-panel" aria-label="Motion Diagnostics">
        <div className="animation-tool-heading">
          <h2>Motion Diagnostics</h2>
          <button type="button" data-close-panel aria-label="Close Motion Diagnostics">
            Close
          </button>
        </div>
        <p>Selected animation: {state.name || 'None'}</p>
        <p>Possible issues are suggestions. Fast attacks and stepped motion may be intentional.</p>
        <details data-guide-id={targets.animationMotionOptions}>
          <summary>Heuristics and tolerances</summary>
          <div className="animation-motion-options">
            {controls.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={Number.isFinite(state.options[key]) ? state.options[key] : ''}
                  onChange={(event) => controller.setOption(key, event.target.valueAsNumber)}
                />
              </label>
            ))}
          </div>
        </details>
        <button
          data-guide-id={targets.animationMotionRun}
          type="button"
          disabled={!!state.reason}
          onClick={() => controller.run()}
        >
          Run diagnostics
        </button>
        <p>{state.reason}</p>
        <div data-guide-id={targets.animationMotionResults}>
          {!state.report && <p>Run diagnostics to list possible issues and selectable cleanup candidates.</p>}
          {state.report && (
            <>
              {state.report.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
              <h3>Possible issues ({state.report.findings.length})</h3>
              {!state.report.findings.length && <p>No issues found with these heuristics.</p>}
              <ul className="animation-motion-list">
                {state.report.findings.map((finding, index) => (
                  <li key={index}>
                    <span>
                      {finding.kind === 'ik' ? 'IK ' : ''}
                      {finding.id}.{finding.property} at {finding.timeMs / 1000}s: {finding.message}
                    </span>
                    <button type="button" onClick={() => controller.inspect(finding)}>
                      Inspect
                    </button>
                  </li>
                ))}
              </ul>
              <h3>Potentially redundant property keys ({state.report.candidates.length})</h3>
              <ul className="animation-motion-list">
                {state.report.candidates.map((candidate, index) => (
                  <li key={index}>
                    <label className="animation-motion-candidate">
                      <input
                        type="checkbox"
                        checked={state.selected.has(index)}
                        onChange={() => controller.toggle(index)}
                      />
                      {candidate.boneId}.{candidate.property} at {candidate.timeMs / 1000}s
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        controller.inspect({
                          kind: 'bone',
                          id: candidate.boneId,
                          property: candidate.property,
                          timeMs: candidate.timeMs,
                          message: '',
                        })
                      }
                    >
                      Inspect
                    </button>
                  </li>
                ))}
              </ul>
              <p>
                Endpoints, event-time keys, nonlinear/stepped channels, IK chains and ancestors, IK targets, and baked
                rotations are protected.
              </p>
            </>
          )}
        </div>
        <button
          data-guide-id={targets.animationCleanupPreview}
          type="button"
          disabled={!!state.reason || !state.selected.size}
          onClick={() => controller.previewCleanup()}
        >
          Preview Cleanup
        </button>
        <div aria-label="Cleanup preview" data-guide-id={targets.animationCleanupCompare}>
          {!state.preview && <p>Preview selected cleanup to compare Before / After without changing authored keys.</p>}
          {state.preview && (
            <>
              <h3>Before / after comparison</h3>
              <p>
                {state.preview.candidates.length} property keys will be removed. Scrub and switch the canvas between the
                original and proposed motion.
              </p>
              <label>
                Comparison time (s)
                <input
                  type="range"
                  min="0"
                  max={state.duration / 1000}
                  step="any"
                  value={state.timeMs / 1000}
                  onChange={(event) => controller.compare(Number(event.target.value) * 1000, state.after)}
                />
                <output>{(state.timeMs / 1000).toFixed(3)}s</output>
              </label>
              <div className="animation-history">
                <button
                  type="button"
                  aria-pressed={!state.after}
                  onClick={() => controller.compare(state.timeMs, false)}
                >
                  Before
                </button>
                <button type="button" aria-pressed={state.after} onClick={() => controller.compare(state.timeMs, true)}>
                  After
                </button>
              </div>
              <ul>
                {Object.entries(state.preview.maxDeviation).map(([property, value]) => (
                  <li key={property}>
                    {property}: maximum local deviation {value.toPrecision(4)}
                  </li>
                ))}
              </ul>
              <p>
                Compared at every original key; rotation also checks 16 subdivisions per segment. Tolerances:{' '}
                {state.options.positionTolerance} units, {state.options.rotationTolerance} rad,{' '}
                {state.options.scaleTolerance} scale.
              </p>
            </>
          )}
        </div>
        <div className="animation-history" data-guide-id={targets.animationCleanupApply}>
          <button type="button" disabled={!state.preview} onClick={() => controller.cancel()}>
            Cancel preview
          </button>
          <button
            type="button"
            className="workspace-danger"
            disabled={!!state.reason || !state.preview}
            onClick={() => controller.apply()}
          >
            Apply Cleanup
          </button>
        </div>
        <p>
          Contact drift detection is deferred: foot markers do not define authored planted-contact intervals. Use the
          existing ground/contact tools for read-only measurements.
        </p>
        <p role="status">{state.feedback}</p>
      </section>
    </details>
  );
}
