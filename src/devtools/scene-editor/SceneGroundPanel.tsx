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
      <label className="ground-guide-toggle">
        <input
          type="checkbox"
          checked={document.showFootContacts}
          onChange={(event) => document.setFootContactsVisible(event.target.checked)}
        />
        Show selected Actor contacts
      </label>
      <label data-guide-id={GUIDE_TARGETS.sceneContactMarker}>
        Actor foot contact marker
        <select
          disabled={!document.selectedActorGroundContacts.length}
          value={document.selectedFootContactId}
          onChange={(event) => document.selectFootContact(event.target.value)}
        >
          <option value="">Choose a contact</option>
          {document.selectedActorGroundContacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name} ({contact.id})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-guide-id={GUIDE_TARGETS.sceneGroundAlign}
        title="Commit initial Actor Y using the selected evaluated contact, preserving X. Scene Undo/Redo restores this edit."
        disabled={!document.canAlignSelectedActorFeetToGround || !guide.enabled || previewing}
        onClick={() => {
          if (!playback.previewing) document.alignSelectedActorFeetToGround();
        }}
      >
        {document.selectedActorGroundContacts.length ? 'Snap Actor to Ground' : 'Align Feet to Ground'}
      </button>
      <p className="workspace-caption">
        {document.selectedActorGroundContacts.length
          ? 'Alignment and placement snapping use the explicitly selected marker in the evaluated initial pose, including facing and scale. Only Actor initial Y changes.'
          : 'Legacy fallback: alignment and placement snapping use the lowest authored attachment sole contact, not a rig foot marker.'}{' '}
        Stop playback to edit placement. Contacts follow the current pose during preview and scrubbing. Scene Undo/Redo
        restores alignment; animation keys and movement paths stay unchanged.
      </p>
      {document.selectedActorId && !document.canAlignSelectedActorFeetToGround && (
        <p className="workspace-caption">
          {document.selectedActorGroundContacts.length
            ? 'Select an available foot contact marker to align.'
            : 'No marker or legacy sole contact is available. Manual placement is required.'}
        </p>
      )}
    </GroundGuideControls>
  );
}
