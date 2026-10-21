import { projectEditorContext } from '../project/projectBridge.js';

/** Let the browser confirm document navigation, refresh, or closing while edits are unsaved. */
export function protectUnsavedChanges(hasUnsavedChanges: () => boolean): () => void {
  // The project host retains document owners and guards the entire project collection.
  if (projectEditorContext()) return () => {};
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
