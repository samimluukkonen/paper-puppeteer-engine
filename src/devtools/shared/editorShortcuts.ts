/** Form controls and inherited content-editable regions retain their native keyboard behavior. */
export function isEditorTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return /^(INPUT|SELECT|TEXTAREA)$/.test(element?.tagName ?? '') || element?.isContentEditable === true;
}
