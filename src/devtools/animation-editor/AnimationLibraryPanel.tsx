import Library from 'lucide-react/icons/library';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimationLibrary } from '../shared/AnimationLibrary.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { AnimationLibraryController } from './AnimationLibraryController.js';

export function AnimationLibraryPanel({ controller }: { controller: AnimationLibraryController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    setDisplayName(snapshot.source?.library?.displayName ?? '');
    setDescription(snapshot.source?.library?.description ?? '');
    setTags(snapshot.source?.library?.tags?.join(', ') ?? '');
  }, [snapshot.source]);
  const select = (name: string, preview = false, copy = false): void => {
    if (copy ? controller.copy(name) : controller.select(name, preview)) dialog.current?.close();
    else setMessage('Could not select this animation. Check editor validation feedback.');
  };
  return (
    <>
      <button
        data-guide-id={GUIDE_TARGETS.animationLibrary}
        type="button"
        disabled={!!snapshot.reason}
        title={snapshot.reason}
        onClick={() => {
          setMessage('');
          dialog.current?.showModal();
        }}
      >
        <Library size={16} aria-hidden="true" />
        Animation Library
      </button>
      <dialog ref={dialog} className="workspace-dialog animation-library-preview" aria-label="Animation Library">
        <h2>Animation Library</h2>
        <p>
          Preview uses the editor canvas, including Environment Preview. Use its Play/Pause, Restart and Loop controls.
          Library browsing preserves authored edits.
        </p>
        <AnimationLibrary
          entries={snapshot.entries}
          targetRig={snapshot.entries[0]?.rigIdentity}
          disabled={!!snapshot.reason}
          onPreview={(entry) => select(entry.clip.name, true)}
          onUse={(entry) => select(entry.clip.name)}
          onCopy={(entry) => select(entry.clip.name, false, true)}
          onLocate={(entry) => select(entry.clip.name)}
        />
        <details>
          <summary>Library metadata · {snapshot.source?.name ?? 'No animation'}</summary>
          <form
            className="animation-library-metadata"
            onSubmit={(event) => {
              event.preventDefault();
              const success = controller.metadata({
                ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
                ...(description ? { description } : {}),
                tags: [
                  ...new Set(
                    tags
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  ),
                ],
              });
              setMessage(
                success
                  ? 'Library metadata updated. Undo restores the previous labels.'
                  : 'Could not update metadata. Check the editor validation feedback.',
              );
            }}
          >
            <label>
              Display name
              <input maxLength={200} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label>
              Description
              <textarea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label>
              Tags (comma separated, optional)
              <input value={tags} onChange={(event) => setTags(event.target.value)} />
            </label>
            <button type="submit" disabled={!!snapshot.reason || !snapshot.source}>
              Save library metadata
            </button>
          </form>
        </details>
        <p role="status">{message || snapshot.reason}</p>
        <button type="button" onClick={() => dialog.current?.close()}>
          Close library
        </button>
      </dialog>
    </>
  );
}
