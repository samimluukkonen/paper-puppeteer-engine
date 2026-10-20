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
        title="Set the selected Actor's initial origin Y. Scene Undo/Redo restores this edit; no foot contact is inferred."
        disabled={!document.selectedActorId || !guide.enabled || previewing}
        onClick={() => {
          if (!playback.previewing) document.alignSelectedActorOriginToGround();
        }}
      >
        Align Actor Origin to Ground
      </button>
      <p className="workspace-caption">
        Rigs have no shared foot-contact marker. Alignment places the selected Actor’s origin on the guide, not its
        feet. Stop playback to edit initial placement. Scene Undo/Redo restores alignment.
      </p>
    </GroundGuideControls>
  );
}
