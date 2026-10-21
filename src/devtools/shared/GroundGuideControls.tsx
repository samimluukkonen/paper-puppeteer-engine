import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { GroundGuideWorkspace } from './GroundGuideWorkspace.js';
import { GUIDE_TARGETS } from './guides/anchors.js';
import './groundGuide.css';

/** Shared collapsed inspector disclosure; commands keep guide history outside authored documents. */
export function GroundGuideControls({
  workspace,
  showSnapping = false,
  guideAnchors = true,
  children,
}: {
  workspace: GroundGuideWorkspace;
  showSnapping?: boolean;
  /** The character workspace mounts a second copy with independent rig tour anchors. */
  guideAnchors?: boolean | 'rig';
  children?: ReactNode;
}) {
  const { workspaceId, guide, persistenceMessage, canUndo, canRedo, dragging } = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
    workspace.getSnapshot,
  );
  const [text, setText] = useState(String(guide.y));
  const scene = workspace.space === 'scene-world';
  useEffect(() => setText(String(guide.y)), [workspaceId, guide.y]);
  const valid = text.trim() !== '' && Number.isFinite(Number(text));
  const commit = (): void => {
    if (valid) workspace.update({ y: Number(text) });
    else setText(String(guide.y));
  };
  return (
    <details className="ground-guide-controls">
      <summary title="Visual reference only; not a physics floor. Guide changes do not edit character or Actor transforms.">
        {scene ? 'Scene ground' : 'Ground reference'}
      </summary>
      <fieldset disabled={workspaceId === null || dragging}>
        <label
          className="ground-guide-toggle"
          data-guide-id={
            guideAnchors === 'rig'
              ? GUIDE_TARGETS.rigGroundVisible
              : guideAnchors
                ? scene
                  ? GUIDE_TARGETS.sceneGroundVisible
                  : GUIDE_TARGETS.animationGroundVisible
                : undefined
          }
          title="Show or hide the visual reference. This is not a physics floor."
        >
          <input
            type="checkbox"
            checked={guide.enabled}
            onChange={(event) => workspace.update({ enabled: event.target.checked })}
          />{' '}
          Show ground guide
        </label>
        <label
          data-guide-id={
            guideAnchors === 'rig'
              ? GUIDE_TARGETS.rigGroundY
              : guideAnchors
                ? scene
                  ? GUIDE_TARGETS.sceneGroundY
                  : GUIDE_TARGETS.animationGroundY
                : undefined
          }
        >
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
        <button
          type="button"
          data-guide-id={
            guideAnchors === 'rig'
              ? GUIDE_TARGETS.rigGroundReset
              : guideAnchors
                ? scene
                  ? GUIDE_TARGETS.sceneGroundReset
                  : GUIDE_TARGETS.animationGroundReset
                : undefined
          }
          title="Restore the guide's default Y without moving the character or Actors."
          onClick={() => workspace.resetY()}
        >
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
            ? ' Drag ↕ Ground on the stage to adjust the guide. Escape cancels. Snapping places feet on the ground during placement drags; hold Shift to move freely. Guide changes never move Actors or movement paths.'
            : ' Drag ↕ Ground in the preview to adjust the guide. Escape cancels. Snapping affects temporary IK target drags within 8 preview pixels; Set Target Key saves them.')}
      </p>
      {persistenceMessage && <p role="status">{persistenceMessage}</p>}
    </details>
  );
}
