import { useRef, useState } from 'react';
import { browserCharacterDrafts } from '../devtools/animation-editor/characterDocuments.js';
import { suggestCharacterId } from '../devtools/shared/newCharacter.js';
import { characterCatalog } from '../shared/characterCatalog.js';

/** Available before the renderer or any character documents are ready. */
export function NewCharacterDialog({ root, guideTargetId }: { root: string; guideTargetId?: string | undefined }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [editedId, setEditedId] = useState(false);
  const [error, setError] = useState('');
  const suggest = (value: string): string =>
    suggestCharacterId(value, [
      ...characterCatalog.map((entry) => entry.id),
      ...browserCharacterDrafts()
        .choices()
        .map((entry) => entry.id),
    ]);
  return (
    <>
      <button
        type="button"
        className="workspace-primary"
        data-guide-id={guideTargetId}
        aria-haspopup="dialog"
        onClick={() => {
          setName('');
          setId('');
          setEditedId(false);
          setError('');
          dialog.current?.showModal();
        }}
      >
        + New Character
      </button>
      <dialog ref={dialog} className="workspace-dialog new-character-dialog" aria-label="Create new character">
        <h2>Create new character</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const draft = browserCharacterDrafts().create({ name, id });
              const url = new URL(`${root}rig-editor/`, window.location.href);
              url.searchParams.set('character', draft.identity.id);
              window.location.assign(url.href);
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure));
            }
          }}
        >
          <label>
            Character name
            <input
              autoFocus
              required
              maxLength={100}
              value={name}
              onChange={(event) => {
                const next = event.target.value;
                setName(next);
                if (!editedId) {
                  try {
                    setId(next.trim() ? suggest(next) : '');
                  } catch {
                    setError('Draft storage is unavailable. Allow session storage to create characters.');
                  }
                }
              }}
            />
          </label>
          <label>
            Character ID
            <input
              required
              maxLength={64}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={id}
              onChange={(event) => {
                setEditedId(true);
                setId(event.target.value);
              }}
            />
          </label>
          <p>Starts with one root bone, an empty default skin, and no artwork or animations.</p>
          <p>This unsaved draft stays in this browser tab. Download a character ZIP to keep your work.</p>
          {error && <p role="alert">{error}</p>}
          <div className="new-character-actions">
            <button type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="workspace-primary">
              Create Character
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
