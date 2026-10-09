import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

const narrowQuery = '(max-width: 900px)';
function subscribeNarrow(listener: () => void): () => void {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
const isNarrow = (): boolean => window.matchMedia(narrowQuery).matches;

/** Layout state belongs to React and never modifies the authored document. */
export function useWorkspaceInspector() {
  const [open, setOpen] = useState(false);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia(narrowQuery);
    const reset = (): void => setOpen(false);
    media.addEventListener('change', reset);
    return () => media.removeEventListener('change', reset);
  }, []);
  const close = useCallback((): void => {
    setOpen(false);
    toggle.current?.focus({ preventScroll: true });
  }, []);
  const reset = useCallback((): void => {
    if (panel.current) panel.current.scrollTop = 0;
    close();
  }, [close]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.key !== 'Escape' ||
        !narrow ||
        !open ||
        (event.target instanceof Element && event.target.closest('dialog'))
      )
        return;
      event.preventDefault();
      setOpen(false);
      toggle.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [narrow, open]);
  useEffect(() => {
    const reveal = (): void => {
      if (isNarrow()) setOpen(true);
    };
    const host = panel.current?.closest('.workspace-shell');
    host?.addEventListener('workspace:reveal-inspector', reveal);
    host?.addEventListener('workspace:reset-inspector', reset);
    return () => {
      host?.removeEventListener('workspace:reveal-inspector', reveal);
      host?.removeEventListener('workspace:reset-inspector', reset);
    };
  }, [reset]);
  return { open, narrow, toggle, panel, close, reset, toggleOpen: () => setOpen((held) => !held) };
}

/** Native dialogs provide Escape, focus containment, and restoration to the opening button. */
export function WorkspaceDialog({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <dialog id={id} className="workspace-dialog" aria-labelledby={`${id}-title`}>
      <div className="workspace-panel-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <form method="dialog">
          <button type="submit">Close</button>
        </form>
      </div>
      {children}
    </dialog>
  );
}

export function openWorkspaceDialog(id: string): void {
  document.querySelector<HTMLDialogElement>(`#${id}`)?.showModal();
}
