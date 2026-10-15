import { characterCatalog, defaultCharacterId } from '../shared/characterCatalog.js';

export const characterChoices = characterCatalog;

export function selectedCharacterId(): string {
  const id = new URLSearchParams(globalThis.location?.search ?? '').get('character');
  return characterChoices.find((character) => character.id === id)?.id ?? defaultCharacterId;
}

/** Navigate through the normal page lifecycle, including the rig editor's unsaved-change guard. */
export function bindCharacterSelection(app: HTMLElement, selector = '#character-selection'): () => void {
  const lifetime = new AbortController();
  app.addEventListener(
    'change',
    (event) => {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement) || !select.matches(selector)) return;
      const url = new URL(window.location.href);
      if (select.value === defaultCharacterId) url.searchParams.delete('character');
      else url.searchParams.set('character', select.value);
      // Restore the displayed selection if navigation is canceled because of unsaved edits.
      select.value = selectedCharacterId();
      window.location.assign(url.href);
    },
    { signal: lifetime.signal },
  );
  return () => lifetime.abort();
}
