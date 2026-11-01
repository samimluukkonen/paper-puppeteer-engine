import { isTypingTarget } from '../engine/keyboardTarget.js';

export { isTypingTarget } from '../engine/keyboardTarget.js';

/** Dialog controls keep their keyboard behavior without changing the background workspace. */
export function isDialogTarget(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.('dialog');
}

/** Global commands never reach through a modal, guide, native field, or consumed event. */
export function blocksEditorShortcut(event: KeyboardEvent): boolean {
  const doc = (event.target as Node | null)?.ownerDocument;
  return (
    event.defaultPrevented ||
    event.isComposing ||
    isTypingTarget(event.target) ||
    isDialogTarget(event.target) ||
    !!doc?.querySelector('dialog[open], .guide-spotlight')
  );
}

export function historyShortcut(event: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return key === 'y' && !event.shiftKey ? 'redo' : null;
}

/** Save means access to the existing explicit export; it never writes back to an imported file. */
export function bindExportShortcut(host: HTMLElement, exportDocument: () => void): () => void {
  const keydown = (event: KeyboardEvent): void => {
    if (
      host.closest('[hidden], [inert]') ||
      blocksEditorShortcut(event) ||
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== 's'
    )
      return;
    event.preventDefault();
    if (!event.repeat) exportDocument();
  };
  window.addEventListener('keydown', keydown);
  return () => window.removeEventListener('keydown', keydown);
}
