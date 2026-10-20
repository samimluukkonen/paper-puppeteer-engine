import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { GroundGuideWorkspace } from './GroundGuideWorkspace.js';
import './groundGuide.css';

/** Shared collapsed inspector disclosure; commands keep guide history outside authored documents. */
export function GroundGuideControls({
  workspace,
  showSnapping = false,
  children,
}: {
  workspace: GroundGuideWorkspace;
  showSnapping?: boolean;
  children?: ReactNode;
}) {
  const { workspaceId, guide, persistenceMessage, canUndo, canRedo, dragging } = useSyncExternalStore(
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
      <summary>{workspace.space === 'scene-world' ? 'Scene ground' : 'Ground reference'}</summary>
      <fieldset disabled={workspaceId === null || dragging}>
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
            {workspace.space === 'scene-world' ? 'Snap to Ground' : 'Enable ground snapping'}
          </label>
        )}
        {workspace.historyEnabled && (
          <div className="ground-guide-history">
            <button type="button" disabled={!canUndo} onClick={() => workspace.undo()}>
              Undo ground change
            </button>
            <button type="button" disabled={!canRedo} onClick={() => workspace.redo()}>
              Redo ground change
            </button>
          </div>
        )}
        {children}
      </fieldset>
      <p className="workspace-caption">
        {workspace.space === 'scene-world' ? 'Scene-world Y.' : 'Fixed preview-world Y.'} Saved in this browser for this
        workspace. Visual reference only.
        {showSnapping &&
          (workspace.space === 'scene-world'
            ? ' Drag ↕ Ground on the stage to adjust the guide. Escape cancels. Snapping constrains Actor origins during placement drags; hold Shift to move freely. Guide changes never move Actors or movement paths.'
            : ' Drag ↕ Ground in the preview to adjust the guide. Escape cancels. Snapping affects temporary IK target drags within 8 preview pixels; Set Target Key saves them.')}
      </p>
      {persistenceMessage && <p role="status">{persistenceMessage}</p>}
    </details>
  );
}
