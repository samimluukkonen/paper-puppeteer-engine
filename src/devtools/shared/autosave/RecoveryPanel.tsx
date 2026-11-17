import ChevronDown from 'lucide-react/icons/chevron-down';
import CircleAlert from 'lucide-react/icons/circle-alert';
import CircleCheck from 'lucide-react/icons/circle-check';
import CircleDot from 'lucide-react/icons/circle-dot';
import History from 'lucide-react/icons/history';
import LoaderCircle from 'lucide-react/icons/loader-circle';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Trash2 from 'lucide-react/icons/trash-2';
import X from 'lucide-react/icons/x';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod';
import type { LocalAutosave } from './LocalAutosave.js';
import { type DraftInfo, LocalDraftStore, storageError } from './LocalDraftStore.js';
import { recoverDraft, type RestoreDraft } from './recoverDraft.js';

export const localDrafts = new LocalDraftStore();
// Rig/Animation view changes remount the control slot, but are not a new startup.
let offeredRecovery = false;
const RECOVERY_INTENT = 'paper-puppeteer:recovery-intent';
const recoveryIntentSchema = z.strictObject({ id: z.string(), key: z.string() });

export function LocalDraftControls({ autosave, onRecover }: { autosave?: LocalAutosave; onRecover?: RestoreDraft }) {
  return <RecoveryPanel {...(onRecover ? { onRecover } : {})} {...(autosave ? { autosave } : {})} />;
}

export function AutosaveStatus({
  autosave,
  recoveryControl,
}: {
  autosave: LocalAutosave;
  recoveryControl?: ReactNode;
}) {
  const message = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot);
  const menu = useRef<HTMLDetailsElement>(null);
  const failed = message.startsWith('Autosave failed');
  const paused = message.includes('autosave paused');
  const saved = message.startsWith('Local draft saved');
  const clean = message.startsWith('No unsaved changes');
  const saving = message.startsWith('Saving locally');
  const summary = saved
    ? `Local draft saved${message.includes('Explicitly exported') ? ' · Explicitly exported' : ''}`
    : clean
      ? 'No unsaved changes'
      : paused
        ? 'Local draft discarded · Autosave paused'
        : failed
          ? 'Local save failed'
          : message.startsWith('Explicitly exported')
            ? `Explicitly exported${message.includes('newer changes') ? ' · Newer changes unsaved' : ''}`
            : message;
  const Icon = failed ? CircleAlert : saving ? LoaderCircle : saved || clean ? CircleCheck : CircleDot;
  const closeMenu = () => {
    if (menu.current) {
      menu.current.open = false;
      menu.current.querySelector('summary')?.focus();
    }
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target))
        menu.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return (
    <div className="local-save-status local-recovery" aria-label="Local save status">
      <div className="local-draft-row">
        <span className={`local-save-summary${failed ? ' local-save-failed' : ''}`} aria-live="polite" title={message}>
          <Icon size={14} aria-hidden="true" />
          {summary}
        </span>
        <div className="local-draft-actions">
          {recoveryControl}
          <details
            ref={menu}
            className="local-draft-menu"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu();
              }
            }}
          >
            <summary>
              Draft actions <ChevronDown size={12} aria-hidden="true" />
            </summary>
            <div className="local-draft-menu-panel" role="group" aria-label="Draft actions">
              <button
                type="button"
                onClick={() => {
                  autosave.retry();
                  closeMenu();
                }}
              >
                <RotateCcw size={14} aria-hidden="true" />
                {paused ? 'Resume local saving' : 'Retry local saving'}
              </button>
              <button
                type="button"
                className="workspace-danger"
                onClick={() => {
                  void autosave.discard();
                  closeMenu();
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                Discard local draft
              </button>
              <p>Export a ZIP to keep a disk copy.</p>
            </div>
          </details>
        </div>
      </div>
      {failed && <p className="local-save-error">{message}</p>}
    </div>
  );
}

/** All routes discover the same complete drafts. Without a restoring owner, recovery navigates to the project view. */
export function RecoveryPanel({ onRecover, autosave }: { onRecover?: RestoreDraft; autosave?: LocalAutosave }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const descriptionId = useId();
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = useRef(crypto.randomUUID());
  const mounted = useRef(true);
  const recover = useCallback(
    async (candidate: DraftInfo): Promise<boolean> => {
      if (!onRecover) {
        const url = new URL('../project/', location.href);
        url.searchParams.set('recover', candidate.key);
        try {
          sessionStorage.setItem(RECOVERY_INTENT, JSON.stringify({ id: candidate.id, key: candidate.key }));
          location.assign(url.href);
          return true;
        } catch (error) {
          setStatus(storageError(error, 'Recovery'));
          return false;
        }
      }
      setBusy(true);
      try {
        await recoverDraft(localDrafts, owner.current, candidate, onRecover);
        dialog.current?.close();
        setStatus('Draft recovered as a working copy. Export a project ZIP for a disk copy.');
        return true;
      } catch (error) {
        setStatus(storageError(error, 'Recovery'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onRecover],
  );
  const refresh = useCallback(
    async (open = true): Promise<void> => {
      try {
        const entries = await localDrafts.list();
        if (!mounted.current) return;
        setDrafts(entries);
        setSelected((current) =>
          entries.some((entry) => entry.id === current)
            ? current
            : (entries.find((entry) => entry.key === new URLSearchParams(location.search).get('recover'))?.id ??
              entries[0]?.id ??
              ''),
        );
        if (open && onRecover) {
          const intent = sessionStorage.getItem(RECOVERY_INTENT);
          if (intent) {
            // Consume before awaiting validation: refresh/retry must not replay a confirmation.
            sessionStorage.removeItem(RECOVERY_INTENT);
            let value: unknown;
            try {
              value = JSON.parse(intent) as unknown;
            } catch {
              /* Invalid navigation hints fall back to ordinary recovery. */
            }
            const parsed = recoveryIntentSchema.safeParse(value);
            const candidate =
              parsed.success && entries.find((entry) => entry.id === parsed.data.id && entry.key === parsed.data.key);
            if (candidate && candidate.key === new URLSearchParams(location.search).get('recover')) {
              if (!(await recover(candidate))) dialog.current?.showModal();
              return;
            }
          }
        }
        if (open && entries.length) dialog.current?.showModal();
        if (open && !entries.length) dialog.current?.close();
      } catch (error) {
        if (mounted.current) setStatus(storageError(error, 'Recovery'));
      }
    },
    [onRecover, recover],
  );
  useEffect(() => {
    mounted.current = true;
    const offer = !offeredRecovery;
    offeredRecovery = true;
    void refresh(offer);
    const changed = () => {
      void refresh(false);
    };
    const release = localDrafts.subscribe(changed);
    window.addEventListener('focus', changed);
    return () => {
      mounted.current = false;
      release();
      window.removeEventListener('focus', changed);
    };
  }, [refresh]);
  const draft = drafts.find((entry) => entry.id === selected);

  const failed = status.startsWith('Recovery failed');
  const recoveryControl =
    drafts.length > 0 ? (
      <button
        type="button"
        className="local-recovery-button"
        title={failed ? status : 'Restore a saved local project'}
        onClick={() => {
          void refresh();
        }}
      >
        <History size={14} aria-hidden="true" />
        Recovery drafts
        <span className="local-draft-count" aria-hidden="true">
          {drafts.length}
        </span>
      </button>
    ) : undefined;
  return (
    <div className="local-draft-bar" hidden={!autosave && !drafts.length && !failed}>
      {autosave ? <AutosaveStatus autosave={autosave} recoveryControl={recoveryControl} /> : recoveryControl}
      {!drafts.length && failed && (
        <p className="local-save-error" role="alert">
          {status}
        </p>
      )}
      {createPortal(
        <div className="local-recovery">
          <dialog
            ref={dialog}
            className="workspace-dialog recovery-dialog"
            aria-label="Recover unsaved work?"
            aria-describedby={descriptionId}
          >
            <div className="workspace-dialog-header">
              <h2>Recover unsaved work?</h2>
              <button
                type="button"
                className="workspace-icon-button"
                aria-label="Close recovery"
                disabled={busy}
                onClick={() => dialog.current?.close()}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="workspace-dialog-body">
              <p id={descriptionId} className="recovery-description">
                A saved local draft is available. Choose a revision to restore.
              </p>
              <label className="recovery-revision">
                Project / revision
                <select value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
                  {drafts.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} · {new Date(entry.savedAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
              {draft && (
                <div className="recovery-summary">
                  <History size={20} aria-hidden="true" />
                  <div>
                    <strong>{draft.name}</strong>
                    <span>
                      Last saved{' '}
                      <time dateTime={new Date(draft.savedAt).toISOString()}>
                        {new Date(draft.savedAt).toLocaleString()}
                      </time>
                    </span>
                  </div>
                </div>
              )}
              <p className="recovery-help">
                Recovery opens a separate project. Export a ZIP afterwards to keep a disk copy.
              </p>
              {status && (
                <p className="recovery-feedback" role="alert">
                  {status}
                </p>
              )}
            </div>
            <div className="workspace-dialog-footer">
              <button
                className="workspace-danger workspace-button-with-icon"
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
                <Trash2 size={16} aria-hidden="true" />
                Discard Draft
              </button>
              <div className="workspace-dialog-actions">
                <button disabled={busy} onClick={() => dialog.current?.close()}>
                  Cancel
                </button>
                <button
                  className="workspace-primary"
                  disabled={busy || !draft}
                  onClick={() => {
                    if (draft) void recover(draft);
                  }}
                >
                  Recover Draft
                </button>
              </div>
            </div>
          </dialog>
        </div>,
        document.body,
      )}
    </div>
  );
}
