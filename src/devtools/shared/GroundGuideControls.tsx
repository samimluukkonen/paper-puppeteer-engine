import { useEffect, useState, useSyncExternalStore } from 'react';
import type { GroundGuideWorkspace } from './GroundGuideWorkspace.js';
import './groundGuide.css';

/** Shared inspector disclosure. Animation-specific placement and snapping commands are separate work. */
export function GroundGuideControls({
  workspace,
  showSnapping = false,
}: {
  workspace: GroundGuideWorkspace;
  showSnapping?: boolean;
}) {
  const { workspaceId, guide, persistenceMessage } = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
    workspace.getSnapshot,
  );
  const [text, setText] = useState(String(guide.y));
  useEffect(() => setText(String(guide.y)), [workspaceId, guide.y]);
  const valid = text.trim() !== '' && Number.isFinite(Number(text));
  const commit = (): void => {
    if (valid) workspace.update({ y: Number(text) });
    else setText(String(guide.y));
  };
  return (
    <details className="ground-guide-controls">
      <summary>Ground reference</summary>
      <fieldset disabled={workspaceId === null}>
        <label className="ground-guide-toggle">
          <input
            type="checkbox"
            checked={guide.enabled}
            onChange={(event) => workspace.update({ enabled: event.target.checked })}
          />{' '}
          Show ground guide
        </label>
        <label>
          Ground Y
          <input
            type="number"
            step="any"
            required
            value={text}
            aria-invalid={!valid}
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setText(String(guide.y));
              }
            }}
          />
        </label>
        <button type="button" onClick={() => workspace.resetY()}>
          Reset Ground Y
        </button>
        {showSnapping && (
          <label className="ground-guide-toggle">
            <input
              type="checkbox"
              checked={guide.snapEnabled}
              onChange={(event) => workspace.update({ snapEnabled: event.target.checked })}
            />{' '}
            Enable ground snapping preference
          </label>
        )}
      </fieldset>
      <p className="workspace-caption">
        {workspace.space === 'scene-world' ? 'Scene-world Y.' : 'Fixed preview-world Y.'} Saved in this browser for this
        workspace. Visual reference only.
        {showSnapping && ' Snapping is reserved for a later integration.'}
      </p>
      {persistenceMessage && <p role="status">{persistenceMessage}</p>}
    </details>
  );
}
