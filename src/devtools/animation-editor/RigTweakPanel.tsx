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
        <select id="edit-mode">
          <option value="joint">Joint Editing</option>
          <option value="sprite">Artwork Offset Editing</option>
          <option value="origin">Sprite Origin Editing</option>
          <option value="slot">Slot Transform Editing</option>
        </select>
      </label>
      <label>
        Grid{' '}
        <select id="grid-snap">
          {[0, 1, 2, 5, 10].map((value) => (
            <option key={value} value={value}>
              {value || 'Off'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Rotation snap{' '}
        <select id="rotation-snap">
          {[0, 1, 5, 15].map((value) => (
            <option key={value} value={value}>
              {value ? `${value}°` : 'Off'}
            </option>
          ))}
        </select>
      </label>
      <div className="action-grid">
        <button id="undo" type="button">
          Undo rig
        </button>
        <button id="redo" type="button">
          Redo rig
        </button>
      </div>
      <span id="dirty-status" role="status" />
      <div id="hierarchy" role="tree" aria-label="Rig hierarchy" />
      <div id="inspector" />
      <div className="action-grid">
        <button id="reset-selected" type="button">
          Reset Selected
        </button>
        <button id="reset-rig" type="button">
          Revert rig tweaks
        </button>
        <button id="download-json" type="button">
          Download rig JSON
        </button>
      </div>
      <details>
        <summary>Rig file tools</summary>
        <p>Import accepts alignment edits for this rig. Use the Rig Editor for a different hierarchy or artwork.</p>
        <div className="action-grid">
          <button id="validate-rig" type="button">
            Validate rig
          </button>
          <button id="copy-json" type="button">
            Copy rig JSON
          </button>
          <button id="log-json" type="button">
            Log rig JSON
          </button>
          <button id="reload-exported" type="button">
            Reload exported rig
          </button>
          <button id="reload-original" type="button">
            Reload original rig
          </button>
        </div>
        <label>
          Load rig JSON <input id="load-json" type="file" accept=".json,application/json" />
        </label>
      </details>
      <div id="validation" role="status" />
      <div id="action-feedback" role="status" />
      <p id="rig-draft-status" role="status" />
      <button id="rig-download-retained-drafts" type="button" hidden>
        Download retained rig drafts
      </button>
      <details>
        <summary>Rig session</summary>
        <div id="session-status" />
      </details>
    </section>
  );
}
