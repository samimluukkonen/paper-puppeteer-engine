import { useEffect, useSyncExternalStore } from 'react';
import type { KeyframeRetimingController } from './KeyframeRetimingController.js';

export function KeyframeRetimingPanel({ controller }: { controller: KeyframeRetimingController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.hidePreview(), [controller]);
  return (
    <details
      id="animation-retime-panel"
      data-tool-panel
      className="animation-popover animation-retime-tools"
      onToggle={(event) => {
        if (!event.currentTarget.open) controller.hidePreview();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.currentTarget.open = false;
        controller.hidePreview();
        document.querySelector<HTMLElement>('#animation-authoring-tools > summary')?.focus();
      }}
    >
      <summary>Retime selected keys</summary>
      <section className="animation-popover-content animation-retime-panel" aria-label="Retime selected keys">
        <div className="animation-tool-heading">
          <h2>Retime selected keys</h2>
          <button type="button" data-close-panel aria-label="Close Retime selected keys">
            Close
          </button>
        </div>
        <p>Selected keys: {state.count}</p>
        <label>
          Time scale (×)
          <input
            type="number"
            min="0"
            step="any"
            value={state.scale}
            aria-describedby="animation-retime-reason"
            onChange={(event) => controller.setScale(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Anchor</legend>
          <label>
            <input
              type="radio"
              name="animation-retime-anchor"
              checked={state.anchor === 'earliest'}
              onChange={() => controller.setAnchor('earliest')}
            />{' '}
            First selected time
          </label>
          <label>
            <input
              type="radio"
              name="animation-retime-anchor"
              checked={state.anchor === 'playhead'}
              onChange={() => controller.setAnchor('playhead')}
            />{' '}
            Playhead
          </label>
        </fieldset>
        <p>
          Timing stays proportional without snapping. Duration and FPS stay unchanged. Animation events are unaffected.
        </p>
        <p>Unselected destination keys on the same property are replaced, like group movement.</p>
        <div className="animation-history">
          <button type="button" disabled={!!state.reason} onClick={() => controller.previewRetiming()}>
            Preview
          </button>
          <button type="button" disabled={!!state.reason} onClick={() => controller.apply()}>
            Apply
          </button>
        </div>
        <p id="animation-retime-reason">{state.reason}</p>
        {state.preview && (
          <div className="animation-retime-preview" aria-label="Proposed key times">
            <p>
              Anchor: {state.preview.anchorTimeMs / 1000}s. Replaced destination keys: {state.preview.replacedKeys}.
              Preview changes no authored data or history.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Track / property</th>
                  <th>Before (s)</th>
                  <th>After (s)</th>
                </tr>
              </thead>
              <tbody>
                {state.preview.changes.map(({ before, beforeTimeMs, afterTimeMs }, index) => (
                  <tr key={index}>
                    <td>
                      {'kind' in before ? `IK ${before.constraintId}` : before.boneId}.{before.property}
                    </td>
                    <td>{beforeTimeMs / 1000}</td>
                    <td>{afterTimeMs / 1000}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p role="status">{state.feedback}</p>
      </section>
    </details>
  );
}
