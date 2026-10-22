import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { importProjectPackage } from '../../project/projectPackage.js';
import type { ProjectWorkspace } from '../../project/ProjectWorkspace.js';
import type { LocalAutosave } from './LocalAutosave.js';
import { type DraftInfo, LocalDraftStore, storageError } from './LocalDraftStore.js';

export const localDrafts = new LocalDraftStore();

export function LocalDraftControls({
  autosave,
  onRecover,
}: {
  autosave?: LocalAutosave;
  onRecover?: (workspace: ProjectWorkspace) => void;
}) {
  return (
    <div className="workspace-command-bar local-draft-bar">
      <RecoveryPanel {...(onRecover ? { onRecover } : {})} />
      {autosave && <AutosaveStatus autosave={autosave} />}
    </div>
  );
}

export function AutosaveStatus({ autosave }: { autosave: LocalAutosave }) {
  const message = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot);
  return (
    <div className="workspace-command-bar local-recovery" aria-label="Local save status">
      <span aria-live="polite">{message}</span>
      <button onClick={autosave.retry}>Retry / Resume local saving</button>
      <button
        className="workspace-danger"
        onClick={() => {
          void autosave.discard();
        }}
      >
        Discard local draft
      </button>
    </div>
  );
}

/** All routes discover the same complete drafts. Restoration always installs a detached project owner. */
export function RecoveryPanel({ onRecover }: { onRecover?: (workspace: ProjectWorkspace) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = useRef(crypto.randomUUID());
  const refresh = async (): Promise<void> => {
    try {
      const entries = await localDrafts.list();
      setDrafts(entries);
      setSelected(
        entries.find((entry) => entry.key === new URLSearchParams(location.search).get('recover'))?.id ??
          entries[0]?.id ??
          '',
      );
      if (entries.length) dialog.current?.showModal();
    } catch (error) {
      setStatus(storageError(error, 'Recovery'));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const draft = drafts.find((entry) => entry.id === selected);
  const recover = async (): Promise<void> => {
    if (!draft) return;
    if (!onRecover) {
      const url = new URL('../project/', location.href);
      url.searchParams.set('recover', draft.key);
      location.assign(url.href);
      return;
    }
    setBusy(true);
    try {
      // No lease is held while the user inspects the dialog. Claim only on explicit recovery.
      await localDrafts.claim(draft.key, owner.current);
      try {
        const restored = await importProjectPackage(await localDrafts.read(draft.id));
        restored.markRecovered(draft.key);
        onRecover(restored);
        dialog.current?.close();
        setStatus('Draft recovered as a working copy. Export a project ZIP for a disk copy.');
      } finally {
        await localDrafts.release(draft.key, owner.current);
      }
    } catch (error) {
      setStatus(storageError(error, 'Recovery'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="local-recovery">
      <div className="workspace-caption">
        <button
          onClick={() => {
            void refresh();
          }}
        >
          Recovery drafts
        </button>
        {status && <span aria-live="polite"> {status}</span>}
      </div>
      <dialog ref={dialog} className="workspace-dialog" aria-label="Recover unsaved work?">
        <h2>Recover unsaved work?</h2>
        <p>A local recovery draft is available.</p>
        <label>
          Project / revision{' '}
          <select value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
            {drafts.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} · {new Date(entry.savedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        {draft && (
          <>
            <p>Project: {draft.name}</p>
            <p>
              Last saved:{' '}
              <time dateTime={new Date(draft.savedAt).toISOString()}>{new Date(draft.savedAt).toLocaleString()}</time>
            </p>
          </>
        )}
        <p>
          Recovery opens a separate project working copy. Local drafts are stored in this browser; export a ZIP to save
          files to disk.
        </p>
        {status && <p role="alert">{status}</p>}
        <div className="project-dialog-actions">
          <button disabled={busy} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button
            className="workspace-danger"
            disabled={busy || !draft}
            onClick={() => {
              if (!draft) return;
              setBusy(true);
              void localDrafts
                .discard(draft.key, owner.current)
                .then(async () => {
                  dialog.current?.close();
                  setStatus('Local recovery data discarded.');
                  await refresh();
                })
                .catch((error: unknown) => setStatus(storageError(error, 'Recovery')))
                .finally(() => setBusy(false));
            }}
          >
            Discard Draft
          </button>
          <button
            className="workspace-primary"
            disabled={busy || !draft}
            onClick={() => {
              void recover();
            }}
          >
            Recover Draft
          </button>
        </div>
      </dialog>
    </div>
  );
}
