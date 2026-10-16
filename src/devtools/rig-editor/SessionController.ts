import { type RigJsonDefinition, validateRigDefinition } from '../../engine/externalData.js';
import { readJsonFile } from '../../engine/jsonInput.js';
import { JsonWorkloadBudget, type JsonWorkloadLimitOptions } from '../../engine/jsonWorkloadLimits.js';
import { downloadJson } from '../../shared/downloadJson.js';
import { SessionActionGuard } from '../shared/SessionActionGuard.js';
import type { RigEditor } from './RigEditor.js';
import { serializeRigJson } from './rigSerialization.js';

/** Scene capabilities used by either rig view; document ownership stays with the shared workspace. */
export interface RigSessionHost {
  readonly characterId: string;
  readonly rigFilename: string;
  readonly rigSessionRevision?: number;
  readonly rigExportCheckpoint?: {
    rig?: RigJsonDefinition;
    filename?: string;
    requestSequence?: number;
    committedSequence?: number;
  };
  reloadRig(file: RigJsonDefinition, filename?: string, reason?: 'import' | 'reload-export'): void;
  reloadOriginal(): void;
}

/** Session status, history actions, validation, export completion, and rig reload/import. */
export function createSessionController(
  app: HTMLElement,
  getScene: () => RigSessionHost,
  onStateChange: (editor: RigEditor) => void = () => {},
  inputLimits: JsonWorkloadLimitOptions = {},
  presentation: {
    idPrefix?: string;
    stageSelector?: string;
    dirtyLabel?: string;
    sessionFormat?: 'text' | 'table';
    hasPendingChanges?: () => boolean;
  } = {},
) {
  const lifetime = new AbortController();
  const prefix = presentation.idPrefix ?? '';
  let editor: RigEditor | undefined;
  let rigRevision: number | undefined;
  const dirty = app.querySelector<HTMLElement>(`#${prefix}dirty-status`)!;
  const session = app.querySelector<HTMLElement>(`#${prefix}session-status`)!;
  let sessionCells: HTMLTableCellElement[] | undefined;
  const validation = app.querySelector<HTMLElement>(`#${prefix}validation`)!;
  const feedback = app.querySelector<HTMLElement>(`#${prefix}action-feedback`)!;
  let lastExport: RigJsonDefinition | undefined;
  let lastExportFilename: string | undefined;
  const requests = new SessionActionGuard(lifetime.signal);
  function updateStatus(current: RigEditor): void {
    if (lifetime.signal.aborted) return;
    const nextRevision = getScene().rigSessionRevision;
    if (editor !== current || rigRevision !== nextRevision) requests.invalidate();
    rigRevision = nextRevision;
    editor = current;
    if (current.actionError) feedback.textContent = current.actionError;
    onStateChange(current);
    const isDirty = current.state.rigDirty;
    dirty.textContent = presentation.dirtyLabel
      ? `${presentation.dirtyLabel}: ${isDirty ? 'Modified' : 'Clean'}`
      : isDirty
        ? 'Unsaved changes *'
        : 'No changes';
    app
      .querySelector(presentation.stageSelector ?? '#editor-stage')!
      .classList.toggle('grid-active', current.state.gridSnap !== 0);
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
    const sessionRows = [
      ['Character', getScene().characterId],
      ['Rig', getScene().rigFilename],
      ['Mode', current.state.editMode],
      ['Selected', current.state.selection?.id ?? 'none'],
      ['Grid', current.state.gridSnap || 'Off'],
      ['Rotation snap', current.state.rotationSnap ? `${current.state.rotationSnap}°` : 'Off'],
      ['Modified', isDirty ? 'Yes' : 'No'],
      ['Validation', validationStatus],
    ] as const;
    if (presentation.sessionFormat === 'table') {
      if (!sessionCells) {
        const table = document.createElement('table');
        table.setAttribute('aria-label', 'Rig session details');
        const body = document.createElement('tbody');
        sessionCells = sessionRows.map(([label]) => {
          const row = document.createElement('tr');
          const heading = document.createElement('th');
          heading.scope = 'row';
          heading.textContent = label;
          const cell = document.createElement('td');
          row.append(heading, cell);
          body.append(row);
          return cell;
        });
        table.append(body);
        session.replaceChildren(table);
      }
      sessionRows.forEach(([, value], index) => {
        sessionCells![index]!.textContent = String(value);
      });
    } else {
      session.textContent = sessionRows.map(([label, value]) => `${label}: ${value}`).join('\n');
    }
    app.querySelector<HTMLButtonElement>(`#${prefix}undo`)!.disabled = !current.state.canUndo;
    app.querySelector<HTMLButtonElement>(`#${prefix}redo`)!.disabled = !current.state.canRedo;
    app.querySelector<HTMLButtonElement>(`#${prefix}reset-selected`)!.disabled = !current.state.selection;
  }

  const action = (id: string, run: () => void | Promise<void>): void => {
    app.querySelector<HTMLButtonElement>(`#${prefix}${id}`)!.addEventListener(
      'click',
      () => {
        try {
          const result = run();
          if (result instanceof Promise)
            void result.catch((error) => {
              if (!lifetime.signal.aborted) feedback.textContent = String(error);
            });
        } catch (error) {
          if (!lifetime.signal.aborted) feedback.textContent = String(error);
        }
      },
      { signal: lifetime.signal },
    );
  };
  action('undo', () => editor?.undo());
  action('redo', () => editor?.redo());
  action('reset-selected', () => editor?.resetSelected());
  action('reset-rig', () => {
    if (!confirmReplacement('Reset rig edits to the session start?')) return;
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
  const prepareExport = () => {
    if (!editor) throw new Error('No rig is loaded.');
    const rig = editor.exportRig(false);
    const json = serializeRigJson(rig);
    const warnings = editor.state.validationIssues().filter((issue) => issue.severity === 'warning');
    feedback.textContent = warnings.length
      ? `Ready with warnings: ${warnings.map((issue) => issue.message).join(' · ')}`
      : 'Rig JSON ready.';
    const exportingEditor = editor;
    const exportingRevision = getScene().rigSessionRevision;
    const shared = getScene().rigExportCheckpoint;
    const sequence = shared ? (shared.requestSequence = (shared.requestSequence ?? 0) + 1) : 0;
    return {
      editor,
      json,
      rig,
      filename: getScene().rigFilename,
      snapshot: editor.state.workingSnapshot,
      sequence,
      request: requests.beginExport(
        () => editor === exportingEditor && getScene().rigSessionRevision === exportingRevision,
      ),
    };
  };
  const commitExport = (prepared: ReturnType<typeof prepareExport>): boolean => {
    // A delayed copy must not replace a newer successful export or another session.
    const shared = getScene().rigExportCheckpoint;
    if (shared && prepared.sequence < (shared.committedSequence ?? 0)) return false;
    if (!prepared.request.commit()) return false;
    lastExport = prepared.rig;
    lastExportFilename = prepared.filename;
    if (shared) {
      shared.committedSequence = prepared.sequence;
      shared.rig = prepared.rig;
      shared.filename = prepared.filename;
    }
    prepared.editor.state.markSaved(prepared.snapshot);
    updateStatus(prepared.editor);
    return true;
  };
  action('copy-json', async () => {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable. Use Download or Log rig JSON.');
    if (!editor) throw new Error('No rig is loaded.');
    const prepared = prepareExport();
    try {
      await navigator.clipboard.writeText(prepared.json);
    } catch (error) {
      // Failed requests must not overwrite feedback from a replacement session or newer export.
      if (prepared.request.isLatest()) throw error;
      return;
    }
    if (commitExport(prepared) && prepared.request.isLatest()) feedback.textContent = 'Rig JSON copied.';
  });
  action('download-json', () => {
    const prepared = prepareExport();
    downloadJson(prepared.json, prepared.filename);
    commitExport(prepared);
    feedback.textContent = 'Rig JSON download started.';
  });
  action('log-json', () => {
    const prepared = prepareExport();
    console.log(prepared.json);
    commitExport(prepared);
    feedback.textContent = 'Rig JSON logged to the console.';
  });
  const confirmReplacement = (message: string): boolean => {
    const proposal = presentation.hasPendingChanges?.() ?? false;
    return (
      !(editor?.state.dirty || proposal) ||
      window.confirm(proposal ? `${message} Pending artwork proposals will also be discarded.` : message)
    );
  };
  action('reload-exported', () => {
    const shared = getScene().rigExportCheckpoint;
    const exported = shared?.rig ?? lastExport;
    if (!exported) throw new Error('Export the rig first.');
    if (!confirmReplacement('Discard edits made since the last export?')) return;
    requests.cancelImports();
    getScene().reloadRig(exported, shared?.filename ?? lastExportFilename, 'reload-export');
    feedback.textContent = 'Exported rig reloaded and validated.';
  });
  action('reload-original', () => {
    if (!confirmReplacement('Discard unsaved rig edits and reload the original?')) return;
    requests.cancelImports();
    getScene().reloadOriginal();
    feedback.textContent = 'Original rig reloaded.';
  });
  const importRig = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // Capture the file before clearing so selecting it again starts a new request.
    input.value = '';
    const sessionEditor = editor;
    const importingRevision = getScene().rigSessionRevision;
    const request = requests.beginImport(
      () => editor === sessionEditor && getScene().rigSessionRevision === importingRevision,
    );
    try {
      const text = await readJsonFile(file);
      if (!request.isCurrent()) return;
      const json = JSON.parse(text) as RigJsonDefinition;
      new JsonWorkloadBudget(inputLimits).checkRig(json);
      const issues = validateRigDefinition(json);
      if (issues.some((issue) => issue.severity === 'error'))
        throw new Error(issues.map((issue) => `${issue.path ?? 'rig'}: ${issue.message}`).join('\n'));
      if (!confirmReplacement('Discard unsaved rig edits and load this file?')) {
        return;
      }
      getScene().reloadRig(json, file.name);
      feedback.textContent = `${file.name} loaded and validated.`;
    } catch (error) {
      if (request.isCurrent()) feedback.textContent = `Could not load rig: ${String(error)}`;
    }
  };
  app.querySelector<HTMLInputElement>(`#${prefix}load-json`)!.addEventListener(
    'change',
    (event) => {
      void importRig(event);
    },
    { signal: lifetime.signal },
  );

  return {
    updateStatus,
    hasUnsavedChanges: () => editor?.state.dirty ?? false,
    dispose(): void {
      lifetime.abort();
      editor = undefined;
      lastExport = undefined;
      lastExportFilename = undefined;
    },
  };
}
