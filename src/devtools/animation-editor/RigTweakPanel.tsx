import { ANIMATION_IDS, RIG_TWEAK_SESSION_IDS } from './elementIds.js';
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
        <select id={ANIMATION_IDS.tweakEditMode}>
          <option value="joint">Joint Editing</option>
          <option value="sprite">Artwork Offset Editing</option>
          <option value="origin">Sprite Origin Editing</option>
          <option value="slot">Slot Transform Editing</option>
        </select>
      </label>
      <label>
        Grid{' '}
        <select id={ANIMATION_IDS.tweakGridSnap}>
          {[0, 1, 2, 5, 10].map((value) => (
            <option key={value} value={value}>
              {value || 'Off'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Rotation snap{' '}
        <select id={ANIMATION_IDS.tweakRotationSnap}>
          {[0, 1, 5, 15].map((value) => (
            <option key={value} value={value}>
              {value ? `${value}°` : 'Off'}
            </option>
          ))}
        </select>
      </label>
      <div className="action-grid">
        <button id={RIG_TWEAK_SESSION_IDS.undo} type="button">
          Undo rig
        </button>
        <button id={RIG_TWEAK_SESSION_IDS.redo} type="button">
          Redo rig
        </button>
      </div>
      <span id={RIG_TWEAK_SESSION_IDS.dirtyStatus} role="status" />
      <div id={ANIMATION_IDS.tweakHierarchy} role="tree" aria-label="Rig hierarchy" />
      <div id={ANIMATION_IDS.tweakInspector} />
      <div className="action-grid">
        <button id={RIG_TWEAK_SESSION_IDS.resetSelected} type="button">
          Reset Selected
        </button>
        <button id={RIG_TWEAK_SESSION_IDS.resetRig} type="button">
          Revert rig tweaks
        </button>
        <button id={RIG_TWEAK_SESSION_IDS.downloadJson} type="button">
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
          <button id={RIG_TWEAK_SESSION_IDS.validateRig} type="button">
            Validate rig
          </button>
          <button id={RIG_TWEAK_SESSION_IDS.copyJson} type="button">
            Copy rig JSON
          </button>
          <button id={RIG_TWEAK_SESSION_IDS.logJson} type="button">
            Log rig JSON
          </button>
          <button id={RIG_TWEAK_SESSION_IDS.reloadExported} type="button">
            Reload exported rig
          </button>
          <button id={RIG_TWEAK_SESSION_IDS.reloadOriginal} type="button">
            Reload original rig
          </button>
        </div>
        <label>
          Load rig JSON <input id={RIG_TWEAK_SESSION_IDS.loadJson} type="file" accept=".json,application/json" />
        </label>
      </details>
      <div id={RIG_TWEAK_SESSION_IDS.validation} role="status" />
      <div id={RIG_TWEAK_SESSION_IDS.actionFeedback} role="status" />
      <p id={ANIMATION_IDS.tweakRigDraftStatus} role="status" />
      <button id={ANIMATION_IDS.tweakRigDownloadRetainedDrafts} className="workspace-primary" type="button" hidden>
        Download retained rig drafts
      </button>
      <button
        id={ANIMATION_IDS.tweakRigClearRetainedDrafts}
        className="workspace-danger"
        type="button"
        title="Permanently delete retained browser drafts for this rig"
        hidden
      >
        Clear retained rig drafts
      </button>
      <details>
        <summary>Rig session</summary>
        <div id={RIG_TWEAK_SESSION_IDS.sessionStatus} />
      </details>
    </section>
  );
}
