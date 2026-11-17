/**
 * Let the browser confirm document navigation, refresh, or closing while edits are unsaved.
 * A host that retains the document owners (the project workspace) guards the whole collection itself.
 */
export function protectUnsavedChanges(
  hasUnsavedChanges: () => boolean,
  options: { hostGuarded?: boolean } = {},
): () => void {
  if (options.hostGuarded) return () => {};
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
