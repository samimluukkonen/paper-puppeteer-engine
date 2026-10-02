/** Let the browser confirm document navigation, refresh, or closing while edits are unsaved. */
export function protectUnsavedChanges(hasUnsavedChanges: () => boolean): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
