import { useSyncExternalStore } from 'react';
import { GroundGuideControls } from '../shared/GroundGuideControls.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';

export function SceneGroundPanel({
  document,
  playback,
}: {
  document: SceneEditorDocument;
  playback: SceneEditorPlayback;
}) {
  useSyncExternalStore(document.subscribe, document.getSnapshot, document.getSnapshot);
  const previewing = useSyncExternalStore(
    playback.subscribe,
    () => playback.previewing,
    () => playback.previewing,
  );
  const { guide } = useSyncExternalStore(
    document.groundGuide.subscribe,
    document.groundGuide.getSnapshot,
    document.groundGuide.getSnapshot,
  );
  return (
    <GroundGuideControls workspace={document.groundGuide} showSnapping>
      <button
        type="button"
        data-guide-id={GUIDE_TARGETS.sceneGroundAlign}
        title="Place the lowest sole contact on the guide, preserving initial X. Scene Undo/Redo restores this edit."
        disabled={!document.canAlignSelectedActorFeetToGround || !guide.enabled || previewing}
        onClick={() => {
          if (!playback.previewing) document.alignSelectedActorFeetToGround();
        }}
      >
        Align Feet to Ground
      </button>
      <p className="workspace-caption">
        Alignment and snapping place the lowest sole contact on the guide in the Actor’s initial pose. Stop playback to
        edit placement. Scene Undo/Redo restores alignment.
      </p>
      {document.selectedActorId && !document.canAlignSelectedActorFeetToGround && (
        <p className="workspace-caption">
          Feet alignment requires loaded foot artwork with authored ground contact points.
        </p>
      )}
    </GroundGuideControls>
  );
}
