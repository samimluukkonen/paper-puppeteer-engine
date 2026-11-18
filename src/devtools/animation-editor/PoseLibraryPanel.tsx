import { useEffect, useState, useSyncExternalStore } from 'react';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { ANIMATION_IDS } from './elementIds.js';
import type { PoseLibraryController } from './PoseLibraryController.js';

export function PoseLibraryPanel({ controller }: { controller: PoseLibraryController }) {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const state = controller.state;
  const library = state?.poseLibrary;
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('full');
  const [renaming, setRenaming] = useState(false);
  const [rename, setRename] = useState('');
  const [feedback, setFeedback] = useState('');
  const entry = library?.poses.find(({ id }) => id === selected);
  const reason = controller.reason || (entry ? library?.compatibility(entry.id, state?.rig) : 'Select a pose.');
  const poses =
    library?.poses.filter(({ pose }) => pose.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('dialog[open]') &&
        state?.previewedPose
      ) {
        event.preventDefault();
        state.cancelPosePreview();
      }
    };
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
      state?.cancelPosePreview();
    };
  }, [state]);
  const run = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <details
      id={ANIMATION_IDS.poseLibraryPanel}
      className="animation-popover animation-pose-library"
      data-tool-panel
      onToggle={(event) => {
        if (!event.currentTarget.open) state?.cancelPosePreview();
      }}
    >
      <summary>Pose Library</summary>
      <section
        aria-label="Pose Library"
        className="animation-popover-content animation-mirror-panel animation-pose-content"
      >
        <div className="animation-tool-heading">
          <h2>Pose Library</h2>
          <button type="button" data-close-panel>
            Close
          </button>
        </div>
        <form
          data-guide-id={GUIDE_TARGETS.animationPoseSave}
          onSubmit={(event) => {
            event.preventDefault();
            run(() => {
              if (!state) return;
              const id = state.saveCurrentPose(name, scope === 'selected' ? controller.selectedBoneIds : undefined);
              setSelected(id);
              setName('');
              setFeedback('Pose saved to the character library.');
            });
          }}
        >
          <label>
            Pose name <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Save scope{' '}
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="full">Full character</option>
              <option value="selected">Selected bones ({controller.selectedBoneIds.length})</option>
            </select>
          </label>
          <button
            type="submit"
            className="workspace-primary"
            disabled={
              !!controller.reason || !name.trim() || (scope === 'selected' && !controller.selectedBoneIds.length)
            }
          >
            Save Current Pose
          </button>
        </form>
        <p>
          Captures authored FK transforms at the playhead, before IK. IK targets and temporary edits are excluded.
          Select multiple bones through timeline keys.
        </p>
        <label data-guide-id={GUIDE_TARGETS.animationPoseBrowse}>
          Search poses <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <ul className="animation-pose-list" aria-label="Saved poses">
          {poses.map(({ id, pose }) => (
            <li key={id}>
              <button
                type="button"
                aria-pressed={selected === id}
                onClick={() => {
                  state?.cancelPosePreview();
                  setSelected(id);
                  setRenaming(false);
                  setFeedback('');
                }}
              >
                <span>{pose.name}</span>
                <small>{Object.keys(pose.bones).length} bones</small>
              </button>
            </li>
          ))}
        </ul>
        {!poses.length && <p>{library?.poses.length ? 'No poses match your search.' : 'No saved poses yet.'}</p>}
        <div className="animation-pose-actions" data-guide-id={GUIDE_TARGETS.animationPoseActions}>
          <button
            type="button"
            disabled={!!reason}
            onClick={() =>
              run(() => {
                if (state?.previewLibraryPose(selected))
                  setFeedback(
                    'Preview only. Apply Pose to create keys; Cancel preview or Escape restores the animation.',
                  );
              })
            }
          >
            Preview
          </button>
          <button
            type="button"
            disabled={!state?.previewedPose}
            onClick={() => {
              state?.cancelPosePreview();
              setFeedback('Preview cancelled.');
            }}
          >
            Cancel preview
          </button>
          <button
            type="button"
            data-guide-id={GUIDE_TARGETS.animationPoseApply}
            disabled={!!reason}
            onClick={() =>
              run(() => {
                if (state?.applyLibraryPose(selected))
                  setFeedback('Pose applied at the playhead as one animation edit.');
                else
                  setFeedback(
                    'No keys were applied. Choose a pose with stored FK values and check animation validation.',
                  );
              })
            }
          >
            Apply Pose
          </button>
          <button
            type="button"
            disabled={!entry}
            onClick={() => {
              setRename(entry?.pose.name ?? '');
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="workspace-danger"
            disabled={!entry}
            onClick={() =>
              run(() => {
                if (entry && window.confirm(`Delete pose "${entry.pose.name}"? You can undo this library edit.`)) {
                  library?.delete(entry.id);
                  setSelected('');
                  setRenaming(false);
                  setFeedback('Pose deleted.');
                }
              })
            }
          >
            Delete
          </button>
        </div>
        {reason && <p>{reason}</p>}
        {renaming && entry && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(() => {
                library?.rename(selected, rename);
                setRenaming(false);
                setFeedback('Pose renamed.');
              });
            }}
          >
            <label>
              New pose name <input value={rename} onChange={(event) => setRename(event.target.value)} />
            </label>
            <button type="submit" disabled={!rename.trim()}>
              Save name
            </button>
            <button type="button" onClick={() => setRenaming(false)}>
              Cancel rename
            </button>
          </form>
        )}
        <div className="animation-pose-actions" data-guide-id={GUIDE_TARGETS.animationPoseHistory}>
          <button
            type="button"
            disabled={!library?.canUndo}
            onClick={() =>
              run(() => {
                library?.undo();
                setFeedback('Library edit undone.');
              })
            }
          >
            Undo library edit
          </button>
          <button
            type="button"
            disabled={!library?.canRedo}
            onClick={() =>
              run(() => {
                library?.redo();
                setFeedback('Library edit redone.');
              })
            }
          >
            Redo library edit
          </button>
        </div>
        <p>
          Library edits have separate history. Character/project ZIPs and local autosave include saved poses. Applied
          poses use Animation Undo/Redo. Normal IK and mirror tools still operate on the resulting keys.
        </p>
        <p role="status">{feedback}</p>
      </section>
    </details>
  );
}
