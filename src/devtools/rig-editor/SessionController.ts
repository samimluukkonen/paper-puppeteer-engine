import { type RigJsonDefinition, validateRigDefinition } from '../../engine/externalData.js';
import type { RigEditor } from './RigEditor.js';
import type { RigEditorScene } from './RigEditorScene.js';

/** Session status, history actions, validation, export completion, and rig reload/import. */
export function createSessionController(
  app: HTMLElement,
  getScene: () => Pick<RigEditorScene, 'characterId' | 'rigFilename' | 'reloadRig' | 'reloadOriginal'>,
) {
  let editor: RigEditor | undefined;
  const dirty = app.querySelector<HTMLElement>('#dirty-status')!;
  const session = app.querySelector<HTMLElement>('#session-status')!;
  const validation = app.querySelector<HTMLElement>('#validation')!;
  const feedback = app.querySelector<HTMLElement>('#action-feedback')!;
  let lastExport: RigJsonDefinition | undefined;
  let lastExportFilename: string | undefined;
  function updateStatus(current: RigEditor): void {
    editor = current;
    const isDirty = current.state.dirty;
    dirty.textContent = isDirty ? 'Unsaved changes *' : 'No changes';
    app.querySelector('#editor-stage')!.classList.toggle('grid-active', current.state.gridSnap !== 0);
    const issues = current.state.validationIssues();
    const validationStatus = current.state.validationPending
      ? 'Pending'
      : issues.some((issue) => issue.severity === 'error')
        ? 'Errors'
        : 'OK';
    validation.textContent = current.state.validationPending
      ? 'Validation: pending until editing finishes.'
      : issues.length
        ? issues.map((issue) => `${issue.severity}: ${issue.path ?? 'rig'}: ${issue.message}`).join('\n')
        : 'Validation: OK';
    session.textContent = `Character: ${getScene().characterId}\nRig: ${getScene().rigFilename}\nMode: ${current.state.editMode}\nSelected: ${current.state.selection?.id ?? 'none'}\nGrid: ${current.state.gridSnap || 'Off'}\nRotation snap: ${current.state.rotationSnap ? `${current.state.rotationSnap}°` : 'Off'}\nModified: ${isDirty ? 'Yes' : 'No'}\nValidation: ${validationStatus}`;
    app.querySelector<HTMLButtonElement>('#undo')!.disabled = !current.state.canUndo;
    app.querySelector<HTMLButtonElement>('#redo')!.disabled = !current.state.canRedo;
    app.querySelector<HTMLButtonElement>('#reset-selected')!.disabled = !current.state.selection;
  }

  const action = (id: string, run: () => void | Promise<void>): void => {
    app.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener('click', () => {
      try {
        const result = run();
        if (result instanceof Promise)
          void result.catch((error) => {
            feedback.textContent = String(error);
          });
      } catch (error) {
        feedback.textContent = String(error);
      }
    });
  };
  action('undo', () => editor?.undo());
  action('redo', () => editor?.redo());
  action('reset-selected', () => editor?.resetSelected());
  action('reset-rig', () => {
    editor?.resetRig();
    feedback.textContent = 'Rig reset to session start.';
  });
  action('validate-rig', () => {
    if (!editor) return;
    editor.state.validate();
    const issues = editor.state.validationIssues();
    updateStatus(editor);
    feedback.textContent = issues.length ? `${issues.length} validation issue(s).` : 'Rig validation passed.';
  });
  const prepareJson = (): string => {
    if (!editor) throw new Error('No rig is loaded.');
    const json = editor.exportJson(false);
    lastExport = JSON.parse(json) as RigJsonDefinition;
    lastExportFilename = getScene().rigFilename;
    const warnings = editor.state.validationIssues().filter((issue) => issue.severity === 'warning');
    feedback.textContent = warnings.length
      ? `Exported with warnings: ${warnings.map((issue) => issue.message).join(' · ')}`
      : 'Rig JSON ready.';
    return json;
  };
  const markExported = (): void => {
    if (!editor) return;
    editor.state.markSaved();
    updateStatus(editor);
  };
  action('copy-json', async () => {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable. Use Download or Log rig JSON.');
    if (!editor) throw new Error('No rig is loaded.');
    const exportingEditor = editor;
    const json = prepareJson();
    const savedSnapshot = exportingEditor.state.workingSnapshot;
    await navigator.clipboard.writeText(json);
    if (editor !== exportingEditor) return;
    exportingEditor.state.markSaved(savedSnapshot);
    updateStatus(exportingEditor);
    feedback.textContent = 'Rig JSON copied.';
  });
  action('download-json', () => {
    const json = prepareJson();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = getScene().rigFilename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    markExported();
    feedback.textContent = 'Rig JSON download started.';
  });
  action('log-json', () => {
    const json = prepareJson();
    console.log(json);
    markExported();
    feedback.textContent = 'Rig JSON logged to the console.';
  });
  action('reload-exported', () => {
    if (!lastExport) throw new Error('Export the rig first.');
    if (editor?.state.dirty && !window.confirm('Discard edits made since the last export?')) return;
    getScene().reloadRig(lastExport, lastExportFilename);
    feedback.textContent = 'Exported rig reloaded and validated.';
  });
  action('reload-original', () => {
    if (editor?.state.dirty && !window.confirm('Discard unsaved rig edits and reload the original?')) return;
    getScene().reloadOriginal();
    feedback.textContent = 'Original rig reloaded.';
  });
  app.querySelector<HTMLInputElement>('#load-json')!.addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text()) as RigJsonDefinition;
      const issues = validateRigDefinition(json);
      if (issues.some((issue) => issue.severity === 'error'))
        throw new Error(issues.map((issue) => `${issue.path ?? 'rig'}: ${issue.message}`).join('\n'));
      if (editor?.state.dirty && !window.confirm('Discard unsaved rig edits and load this file?')) {
        input.value = '';
        return;
      }
      getScene().reloadRig(json, file.name);
      feedback.textContent = `${file.name} loaded and validated.`;
    } catch (error) {
      feedback.textContent = `Could not load rig: ${String(error)}`;
    }
    input.value = '';
  });

  return { updateStatus };
}
