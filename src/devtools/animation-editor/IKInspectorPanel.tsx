import { useEffect, useSyncExternalStore } from 'react';
import { EditorMenu } from './EditorMenu.js';
import type { IKInspectorController } from './IKInspectorController.js';

const labels = { x: 'Target X', y: 'Target Y', mix: 'Influence (mix)' };

/** The editor's subscription is the only source of selection, playback time and evaluated values. */
export function IKInspectorPanel({ controller }: { controller: IKInspectorController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.cancel(), [controller]);
  return (
    <section id="animation-ik-inspector" aria-label="IK target keyframing" hidden={!state.constraintId}>
      <h2>IK target: {state.constraintId}</h2>
      <p>Absolute puppet-local coordinates, before facing and camera projection. Influence ranges from 0 to 1.</p>
      {state.disabledReason && <p role="status">{state.disabledReason}</p>}
      <button
        type="button"
        disabled={
          !state.ready || state.dragging || !!state.disabledReason || state.fields.some((field) => !field.valid)
        }
        onClick={() => controller.commitTarget()}
      >
        Set Target Key
      </button>
      <fieldset
        disabled={!state.ready}
        aria-label="Animated IK target"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            controller.cancel();
          }
        }}
      >
        {state.fields.map((field) => (
          <div className="animation-property" key={field.property}>
            <label>
              {labels[field.property]}
              <input
                type="number"
                step="any"
                required
                min={field.property === 'mix' ? 0 : undefined}
                max={field.property === 'mix' ? 1 : undefined}
                value={field.text}
                data-ik-property={field.property}
                data-temporary={String(field.temporary)}
                onFocus={() => controller.beginEdit()}
                onChange={(event) => controller.edit(field.property, event.target.value)}
              />
            </label>
            <span className="key-indicator editor-sr-only" data-keyed={String(field.keyed)}>
              {field.keyed ? '● keyed' : '○ no key'}
            </span>
            <button
              type="button"
              disabled={!field.valid}
              className="animation-key-button"
              data-keyed={String(field.keyed)}
              title={`${field.keyed ? 'Update' : 'Set'} ${labels[field.property]} key at the playhead`}
              aria-label={`Set IK ${field.property} key`}
              onClick={() => controller.commit(field.property)}
            >
              {field.keyed ? '◆' : '◇'}
            </button>
            <div className="animation-property-actions">
              <EditorMenu id={`ik-${field.property}-actions`} label={`${labels[field.property]} key actions`} compact>
                <button
                  type="button"
                  disabled={!field.keyed}
                  aria-label={`Delete IK ${field.property} key`}
                  onClick={() => controller.remove(field.property)}
                >
                  Delete Key
                </button>
              </EditorMenu>
            </div>
          </div>
        ))}
      </fieldset>
      <button
        type="button"
        disabled={!state.fields.some((field) => field.temporary)}
        onClick={() => controller.cancel()}
      >
        Cancel IK edits
      </button>
      <p className="animation-field-help">
        Drag a crosshair to preview a requested target. Release keeps a temporary value; Set Target Key commits X and Y
        together at the held playhead. Escape during dragging restores the previous preview. Circles at the limb show
        the solved contact position. Disable fixed IK preview to manipulate authored targets.
      </p>
    </section>
  );
}
