import { useEffect, useSyncExternalStore } from 'react';
import { GroundGuideControls } from '../shared/GroundGuideControls.js';
import type { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { FootContactGroundController } from './FootContactGroundController.js';
import { FootContactGroundPanel } from './FootContactGroundPanel.js';
import type { IKInspectorController } from './IKInspectorController.js';

export function AnimationGroundPanel({
  workspace,
  ikInspector,
  alignTarget,
  contacts,
}: {
  workspace: GroundGuideWorkspace;
  ikInspector: IKInspectorController;
  alignTarget: () => void;
  contacts?: FootContactGroundController;
}) {
  useEffect(() => () => workspace.cancelDrag(), [workspace]);
  const ik = useSyncExternalStore(ikInspector.subscribe, ikInspector.getSnapshot, ikInspector.getSnapshot);
  const { guide } = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  return (
    <GroundGuideControls workspace={workspace} showSnapping embedded>
      {contacts && <FootContactGroundPanel controller={contacts} workspace={workspace} />}
      <button
        type="button"
        data-guide-id={GUIDE_TARGETS.animationGroundAlign}
        title="Author IK target X/Y keys at the playhead. Animation Undo/Redo restores this edit."
        disabled={
          !guide.enabled || !ik.ready || ik.dragging || !!ik.disabledReason || ik.fields.some((field) => !field.valid)
        }
        onClick={alignTarget}
      >
        Align IK target Y to guide
      </button>
      <p className="workspace-caption">
        Select an authored IK target. Alignment sets X/Y keys at the playhead and preserves world X. No sole-contact
        marker is used by this legacy command: alignment and snapping place the requested IK target on the guide, not
        the bottom of the foot. Influence and solver reach can limit the result.
      </p>
      {ik.disabledReason && <p role="status">{ik.disabledReason}</p>}
    </GroundGuideControls>
  );
}
