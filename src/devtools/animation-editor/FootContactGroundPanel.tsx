import { useSyncExternalStore } from 'react';
import { contactGroundDistance } from '../shared/footContactGround.js';
import type { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import type { FootContactGroundController } from './FootContactGroundController.js';

export function FootContactGroundPanel({
  controller,
  workspace,
}: {
  controller: FootContactGroundController;
  workspace: GroundGuideWorkspace;
}) {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { guide } = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  return (
    <>
      <label className="ground-guide-toggle">
        <input
          type="checkbox"
          checked={controller.visible}
          onChange={(event) => controller.setVisible(event.target.checked)}
        />
        Show foot contact markers
      </label>
      <label>
        Foot contact marker
        <select value={controller.markerId} onChange={(event) => controller.selectMarker(event.target.value)}>
          <option value="">Choose a contact</option>
          {controller.markers.map((marker) => (
            <option key={marker.id} value={marker.id}>
              {marker.name} ({marker.id})
            </option>
          ))}
        </select>
      </label>
      <label>
        Foot IK constraint
        <select value={controller.constraintId} onChange={(event) => controller.selectConstraint(event.target.value)}>
          <option value="">Confirm a constraint</option>
          {controller.constraints.map((constraint) => (
            <option key={constraint.name} value={constraint.name}>
              {constraint.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Contact tolerance (world units)
        <input
          type="number"
          min="0.001"
          step="0.1"
          value={controller.tolerance}
          onChange={(event) => controller.setTolerance(event.target.valueAsNumber)}
        />
      </label>
      {controller.visible && (
        <ul className="workspace-caption" aria-label="Contact ground distances">
          {controller.contacts.map((contact) => {
            const distance = contactGroundDistance(contact.world, guide.y, controller.tolerance);
            return (
              <li key={contact.id}>
                {contact.name} ({contact.id}): {distance.distance.toFixed(3)} · {distance.relation}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" disabled={!!controller.disabledReason} onClick={() => controller.preview()}>
        Align Selected Foot Contact to Ground
      </button>
      <button
        type="button"
        disabled={!controller.plan?.success || !!controller.disabledReason}
        onClick={() => controller.apply()}
      >
        Apply IK target keys
      </button>
      <button type="button" disabled={!controller.plan} onClick={() => controller.cancel()}>
        Cancel alignment preview
      </button>
      <p className="workspace-caption">
        Alignment previews a tinted pose and contact. Apply saves X/Y target keys at the playhead as one animation
        Undo/Redo edit. Positive distance is below ground; negative is above (Y grows downward). Target world X stays
        fixed. Limited alignments cannot be applied.
      </p>
      {(controller.feedback || controller.disabledReason) && (
        <p role="status">{controller.feedback || controller.disabledReason}</p>
      )}
    </>
  );
}
