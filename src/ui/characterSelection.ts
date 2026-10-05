import { demoCharacterProfiles } from '../demo/demoCharacterProfiles.js';

export const characterChoices = demoCharacterProfiles.map(({ id, label }) => ({ id, label }));

export function selectedCharacterId(): string {
  const id = new URLSearchParams(globalThis.location?.search ?? '').get('character');
  return characterChoices.find((character) => character.id === id)?.id ?? 'demo-puppet';
}

/** Navigate through the normal page lifecycle, including the rig editor's unsaved-change guard. */
export function bindCharacterSelection(app: HTMLElement): () => void {
  const select = app.querySelector<HTMLSelectElement>('#character-selection')!;
  const lifetime = new AbortController();
  select.addEventListener(
    'change',
    () => {
      const url = new URL(window.location.href);
      if (select.value === 'demo-puppet') url.searchParams.delete('character');
      else url.searchParams.set('character', select.value);
      // Restore the displayed selection if navigation is canceled because of unsaved edits.
      select.value = selectedCharacterId();
      window.location.assign(url.href);
    },
    { signal: lifetime.signal },
  );
  return () => lifetime.abort();
}
