/** Static hosts reuse the Rig Editor's inspector, hierarchy, file actions and history controllers. */
export function RigTweakPanel({ active }: { active: boolean }) {
  return (
    <section className="rig-tweak-panel inspector" hidden={!active} inert={!active} aria-label="Rig Tweak tools">
      <h2>Rig Tweak</h2>
      <p>
        Editing rig data. Playback is paused at the current pose. Changes affect every animation sharing this rig;
        motion and IK may change. Use rig Undo/Redo to compare before and after.
      </p>
      <label>
        Edit{' '}
        <select id="tweak-edit-mode">
          <option value="joint">Joint Editing</option>
          <option value="sprite">Artwork Offset Editing</option>
          <option value="origin">Sprite Origin Editing</option>
          <option value="slot">Slot Transform Editing</option>
        </select>
      </label>
      <label>
        Grid{' '}
        <select id="tweak-grid-snap">
          {[0, 1, 2, 5, 10].map((value) => (
            <option key={value} value={value}>
              {value || 'Off'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Rotation snap{' '}
        <select id="tweak-rotation-snap">
          {[0, 1, 5, 15].map((value) => (
            <option key={value} value={value}>
              {value ? `${value}°` : 'Off'}
            </option>
          ))}
        </select>
      </label>
      <div className="action-grid">
        <button id="tweak-undo" type="button">
          Undo rig
        </button>
        <button id="tweak-redo" type="button">
          Redo rig
        </button>
      </div>
      <span id="tweak-dirty-status" role="status" />
      <div id="tweak-hierarchy" role="tree" aria-label="Rig hierarchy" />
      <div id="tweak-inspector" />
      <div className="action-grid">
        <button id="tweak-reset-selected" type="button">
          Reset Selected
        </button>
        <button id="tweak-reset-rig" type="button">
          Revert rig tweaks
        </button>
        <button id="tweak-download-json" type="button">
          Download rig JSON
        </button>
      </div>
      <details>
        <summary>Rig file tools</summary>
        <p>
          Import accepts alignment edits for this rig. Open another character to change hierarchy. Compatible rig files
          retain all clips and applied images.
        </p>
        <div className="action-grid">
          <button id="tweak-validate-rig" type="button">
            Validate rig
          </button>
          <button id="tweak-copy-json" type="button">
            Copy rig JSON
          </button>
          <button id="tweak-log-json" type="button">
            Log rig JSON
          </button>
          <button id="tweak-reload-exported" type="button">
            Reload exported rig
          </button>
          <button id="tweak-reload-original" type="button">
            Reload original rig
          </button>
        </div>
        <label>
          Load rig JSON <input id="tweak-load-json" type="file" accept=".json,application/json" />
        </label>
      </details>
      <div id="tweak-validation" role="status" />
      <div id="tweak-action-feedback" role="status" />
      <p id="tweak-rig-draft-status" role="status" />
      <button id="tweak-rig-download-retained-drafts" type="button" hidden>
        Download retained rig drafts
      </button>
      <details>
        <summary>Rig session</summary>
        <div id="tweak-session-status" />
      </details>
    </section>
  );
}
