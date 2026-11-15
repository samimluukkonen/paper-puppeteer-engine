import { readJsonFile } from '../../engine/core.js';
import { setText } from '../../shared/domUpdates.js';
import { downloadJson } from '../../shared/downloadJson.js';
import { SessionActionGuard } from '../shared/SessionActionGuard.js';
import type { AnimationImportOptions } from './AnimationEditorDocument.js';
import type { AnimationEditorState } from './AnimationEditorState.js';

/** Owns animation file controls, request lifetimes, replacement confirmation and export checkpoints. */
export class AnimationFileController {
  private readonly abort = new AbortController();
  private readonly requests = new SessionActionGuard(this.abort.signal);
  private readonly download: HTMLButtonElement;
  private readonly copyJson: HTMLButtonElement;
  private readonly logJson: HTMLButtonElement;
  private readonly exportFeedback: HTMLElement;
  private readonly importPanel: HTMLElement;
  private readonly importText: HTMLTextAreaElement;
  private readonly importFile: HTMLInputElement;
  private readonly importFeedback: HTMLElement;
  private readonly reloadExport: HTMLButtonElement;
  private readonly revert: HTMLButtonElement;

  constructor(
    private readonly app: HTMLElement,
    private readonly getState: () => AnimationEditorState,
    private readonly onReplace: () => void,
  ) {
    this.download = this.element<HTMLButtonElement>('#animation-download');
    this.copyJson = this.element<HTMLButtonElement>('#animation-copy-json');
    this.logJson = this.element<HTMLButtonElement>('#animation-log-json');
    this.exportFeedback = this.element('#animation-export-feedback');
    this.importPanel = this.element('#animation-import-panel');
    this.importText = this.element<HTMLTextAreaElement>('#animation-import-text');
    this.importFile = this.element<HTMLInputElement>('#animation-import-file');
    this.importFeedback = this.element('#animation-import-feedback');
    this.reloadExport = this.element<HTMLButtonElement>('#animation-reload-export');
    this.revert = this.element<HTMLButtonElement>('#animation-revert');
    const options = { signal: this.abort.signal };
    // Keep invalid inspector drafts from moving the reload button between down/up.
    for (const button of [this.reloadExport, this.revert])
      button.addEventListener(
        'pointerdown',
        (event) => {
          if (event.button === 0) event.preventDefault();
        },
        options,
      );
    this.element('#animation-import-paste').addEventListener(
      'click',
      () => {
        this.importPanel.hidden = false;
        this.importText.focus();
      },
      options,
    );
    this.element('#animation-import-cancel').addEventListener(
      'click',
      () => {
        this.requests.cancelImports();
        this.importPanel.hidden = true;
        this.importText.value = '';
        this.setImportFeedback('');
      },
      options,
    );
    this.element('#animation-import-submit').addEventListener(
      'click',
      () => {
        this.requests.cancelImports();
        this.replaceSession((options) => this.state.importJson(this.importText.value, options));
      },
      options,
    );
    this.importFile.addEventListener(
      'change',
      () => {
        void this.importLocalFile();
      },
      options,
    );
    this.reloadExport.addEventListener(
      'click',
      () => {
        this.requests.cancelImports();
        this.replaceSession((options) => this.state.reloadCurrentExport(options));
      },
      options,
    );
    this.revert.addEventListener(
      'click',
      () => {
        if (this.state.dirty && !window.confirm('Discard unsaved animation changes and revert to the session source?'))
          return;
        if (this.state.revertAnimation({ discardChanges: true })) {
          this.requests.invalidate();
          this.setImportFeedback('');
          this.setExportFeedback('Animation reverted to its loaded/imported source. Clean session; history reset.');
          this.onReplace();
        }
      },
      options,
    );
    this.download.addEventListener(
      'click',
      () => {
        void this.exportTo('download');
      },
      options,
    );
    this.copyJson.addEventListener(
      'click',
      () => {
        void this.exportTo('clipboard');
      },
      options,
    );
    this.logJson.addEventListener(
      'click',
      () => {
        void this.exportTo('console');
      },
      options,
    );
  }

  private setImportFeedback(message: string): void {
    setText(this.importFeedback, message);
    setText(this.element('#animation-file-import-feedback'), message);
  }

  private setExportFeedback(message: string): void {
    setText(this.exportFeedback, message);
    setText(this.element('#animation-file-export-feedback'), message);
  }

  private get state(): AnimationEditorState {
    return this.getState();
  }

  private replaceSession(run: (options: AnimationImportOptions) => boolean): void {
    let cancelled = false;
    const imported = run({
      confirmDiscard: () => {
        cancelled = !window.confirm(
          'Import or reload this animation? Pending edits to a clip with the imported name will be replaced. Other clips will be kept.',
        );
        return !cancelled;
      },
    });
    if (cancelled) this.setImportFeedback('Replacement cancelled. Current animation retained.');
    else this.finishImport(imported);
  }

  private finishImport(imported: boolean): void {
    if (!imported) {
      this.setImportFeedback(
        this.state.validationIssues.map((issue) => `${issue.path ?? 'animation'}: ${issue.message}`).join('\n'),
      );
      return;
    }
    this.requests.invalidate();
    this.importPanel.hidden = true;
    this.importText.value = '';
    this.setExportFeedback('');
    this.setImportFeedback(`Imported "${this.state.selectedAnimationId}". Clean session; playback paused at zero.`);
    this.onReplace();
  }

  private async importLocalFile(): Promise<void> {
    const file = this.importFile.files?.[0];
    this.importFile.value = '';
    if (!file) return;
    const state = this.state;
    const animation = state.workingAnimation;
    const revision = state.sessionRevision;
    const request = this.requests.beginImport(() => this.state === state && state.sessionRevision === revision);
    try {
      const json = await readJsonFile(file);
      if (!request.isCurrent()) return;
      if (state.workingAnimation !== animation) {
        this.setImportFeedback('Animation changed while reading the file. Choose the file again to import.');
        return;
      }
      this.replaceSession((options) => state.importJson(json, options));
    } catch (error) {
      if (request.isCurrent())
        this.setImportFeedback(
          `Could not read animation file: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }

  private async exportTo(destination: 'download' | 'clipboard' | 'console'): Promise<void> {
    const state = this.state;
    const id = state.selectedAnimationId;
    const source = state.sourceAnimation;
    const revision = state.sessionRevision;
    const request = this.requests.beginExport(
      () =>
        this.state === state &&
        state.sessionRevision === revision &&
        state.selectedAnimationId === id &&
        state.sourceAnimation === source,
    );
    try {
      const result = state.exportAnimation();
      if (!result.success)
        throw new Error(result.issues.map((issue) => `${issue.path ?? 'animation'}: ${issue.message}`).join('\n'));
      const snapshot = state.workingAnimation;
      const filename = state.selectedAnimationFilename ?? 'animation.json';
      let message: string;
      if (destination === 'clipboard') {
        if (!navigator.clipboard?.writeText)
          throw new Error('Clipboard API is unavailable. Use Download animation.json or Log Animation JSON.');
        try {
          await navigator.clipboard.writeText(result.json);
        } catch (error) {
          throw new Error('Clipboard access failed. Use Download animation.json or Log Animation JSON.', {
            cause: error,
          });
        }
        message = 'Animation JSON copied.';
      } else if (destination === 'download') {
        downloadJson(result.json, filename);
        message = `Animation JSON download started: ${filename}`;
      } else {
        console.log(result.json);
        message = 'Animation JSON logged to the console.';
      }
      if (!request.commit()) return;
      // Clipboard writes can finish after further edits: save only the exported snapshot.
      state.markSaved(snapshot);
      if (request.isLatest()) this.setExportFeedback(message);
    } catch (error) {
      if (request.isLatest())
        this.setExportFeedback(`Could not export animation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private element<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.app.querySelector<T>(selector);
    if (!element) throw new Error(`Missing animation editor element ${selector}.`);
    return element;
  }

  /** Selection/discard replaces pending requests while preserving any open import text. */
  invalidateSession(message = ''): void {
    this.requests.invalidate();
    this.setExportFeedback(message);
  }

  /** Binding a character also releases the import panel and its feedback. */
  reset(): void {
    this.invalidateSession();
    this.setImportFeedback('');
    this.importPanel.hidden = true;
    this.importText.value = '';
  }

  render(): void {
    const state = this.state;
    const animation = state.workingAnimation;
    if (this.download.disabled !== !animation) this.download.disabled = !animation;
    if (this.copyJson.disabled !== !animation) this.copyJson.disabled = !animation;
    if (this.logJson.disabled !== !animation) this.logJson.disabled = !animation;
    this.reloadExport.disabled = !animation;
    this.revert.disabled = !animation;
    this.importFile.disabled = !state.rig;
    this.element<HTMLButtonElement>('#animation-import-paste').disabled = !state.rig;
  }

  dispose(): void {
    this.abort.abort();
  }
}
