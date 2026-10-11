/** Form controls and inherited content-editable regions retain their native keyboard behavior. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return /^(INPUT|SELECT|TEXTAREA)$/.test(element?.tagName ?? '') || element?.isContentEditable === true;
}

/** Dialog controls keep their keyboard behavior without changing the background workspace. */
export function isDialogTarget(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.('dialog');
}
