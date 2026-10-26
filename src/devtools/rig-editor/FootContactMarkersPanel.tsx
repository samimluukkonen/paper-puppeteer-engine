import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FootContactMarker } from '../../engine/types.js';
import { InspectorSection } from '../../ui/InspectorSection.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { InspectorNumberField } from '../shared/InspectorNumberField.js';
import type { AttachmentController } from './AttachmentController.js';
import './attachments.css';

function MarkerName({ marker, controller }: { marker: FootContactMarker; controller: AttachmentController }) {
  const [text, setText] = useState(marker.name);
  useEffect(() => setText(marker.name), [marker.name]);
  return (
    <label>
      Name
      <input
        aria-label="Contact name"
        value={text}
        aria-invalid={!text.trim()}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text.trim() && text.trim() !== marker.name)
            controller.updateFootContactMarker(marker.id, { name: text.trim() });
          else setText(marker.name);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setText(marker.name);
          }
        }}
      />
    </label>
  );
}

/** React owns only input drafts; selection, coordinates and history belong to the rig document. */
export function FootContactMarkersPanel({
  controller,
  embedded = false,
}: {
  controller: AttachmentController;
  embedded?: boolean;
}) {
  const { editor, message } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [newBone, setNewBone] = useState('');
  useEffect(() => setNewBone(''), [editor]);
  if (!editor) return null;
  const state = editor.state;
  const rig = state.workingCopy;
  const markers = rig.footContactMarkers ?? [];
  const selected = markers.find((entry) => entry.id === state.selectedFootContactMarkerId);
  const suggestedBone =
    state.selection?.type === 'bone'
      ? state.selection.id
      : state.selection?.type === 'slot'
        ? state.getSlot(state.selection.id).bone
        : (selected?.boneId ?? rig.root);
  const boneId = rig.bones.some((bone) => bone.id === newBone) ? newBone : suggestedBone;
  const dependencies = selected ? state.footContactMarkerDependencies(selected.id) : [];
  const boneOptions = rig.bones.map((bone) => (
    <option key={bone.id} value={bone.id}>
      {bone.id}
    </option>
  ));
  return (
    <InspectorSection
      embedded={embedded}
      className="attachment-panel rig-ik-panel foot-contact-panel"
      summary="Foot Contact Markers"
    >
      <section className="rig-ik-content" aria-label="Foot contact markers">
        {!markers.length && <p>No contact markers. Choose any bone and add a contact point.</p>}
        <div className="action-grid">
          {markers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              aria-pressed={marker.id === selected?.id}
              title={marker.id}
              onClick={() => controller.selectFootContactMarker(marker.id)}
            >
              {marker.name}
            </button>
          ))}
        </div>
        <label data-guide-id={GUIDE_TARGETS.rigContactBone}>
          New contact bone
          <select aria-label="New contact bone" value={boneId} onChange={(event) => setNewBone(event.target.value)}>
            {boneOptions}
          </select>
        </label>
        <button
          type="button"
          data-guide-id={GUIDE_TARGETS.rigContactCreate}
          onClick={() => controller.createFootContactMarker(boneId)}
        >
          + Add Contact Marker
        </button>
        <p data-guide-id={GUIDE_TARGETS.rigContactPosition}>
          Drag the square crosshair to the contact point. Coordinates are local to its bone. Escape cancels a drag.
        </p>
        <p>
          Artwork replacement and skin switching retain these bone-local points. If the sole position changes, manually
          realign the markers for the new proportions.
        </p>
        {selected && (
          <fieldset key={selected.id}>
            <legend>Selected: {selected.name}</legend>
            <small>ID: {selected.id} (stable). Changing the name preserves references to this ID.</small>
            <MarkerName marker={selected} controller={controller} />
            <label>
              Bone
              <select
                aria-label="Contact bone"
                value={selected.boneId}
                onChange={(event) => controller.updateFootContactMarker(selected.id, { boneId: event.target.value })}
              >
                {boneOptions}
              </select>
            </label>
            <p>Changing the bone retains local X/Y. Place the marker again if needed.</p>
            <InspectorNumberField
              label="Local X"
              value={selected.localX}
              onCommit={(localX) => controller.updateFootContactMarker(selected.id, { localX })}
            />
            <InspectorNumberField
              label="Local Y"
              value={selected.localY}
              onCommit={(localY) => controller.updateFootContactMarker(selected.id, { localY })}
            />
            {!!dependencies.length && (
              <p role="status">Used by {dependencies.join(', ')}. Resolve these references before deleting.</p>
            )}
            <button
              type="button"
              disabled={!!dependencies.length}
              onClick={() => controller.removeFootContactMarker(selected.id)}
            >
              Delete Marker
            </button>
          </fieldset>
        )}
        <p role="status">{message}</p>
      </section>
    </InspectorSection>
  );
}
