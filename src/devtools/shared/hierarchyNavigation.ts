export interface HierarchyEntry {
  readonly button: Pick<HTMLButtonElement, 'focus' | 'click' | 'tabIndex'>;
  readonly level: number;
}

/** Consume hierarchy navigation before global shortcuts can author transforms or seek playback. */
export function navigateHierarchy(
  event: Pick<
    KeyboardEvent,
    'key' | 'defaultPrevented' | 'isComposing' | 'altKey' | 'ctrlKey' | 'metaKey' | 'preventDefault'
  >,
  button: HierarchyEntry['button'],
  entries: readonly HierarchyEntry[],
): void {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  const index = entries.findIndex((entry) => entry.button === button);
  if (index < 0) return;
  let next = index;
  switch (event.key) {
    case 'ArrowUp':
      next = Math.max(0, index - 1);
      break;
    case 'ArrowDown':
      next = Math.min(entries.length - 1, index + 1);
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = entries.length - 1;
      break;
    case 'ArrowLeft':
      for (let previous = index - 1; previous >= 0; previous--) {
        if (entries[previous]!.level < entries[index]!.level) {
          next = previous;
          break;
        }
      }
      break;
    case 'ArrowRight':
      if (index + 1 < entries.length && entries[index + 1]!.level > entries[index]!.level) next = index + 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  if (next !== index) {
    entries[next]!.button.focus({ preventScroll: true });
    entries[next]!.button.click();
  }
}

/** One hierarchy entry participates in Tab navigation; an empty selection falls back to the first entry. */
export function setHierarchyTabStop(entries: readonly HierarchyEntry[], selected?: HierarchyEntry['button']): void {
  const active = selected ?? entries[0]?.button;
  for (const { button } of entries) button.tabIndex = button === active ? 0 : -1;
}
