import { downloadJson } from '../../shared/downloadJson.js';
import { DraftRecovery } from './DraftRecovery.js';

/** Shared recovery feedback and manual download for drafts incompatible with the current source. */
export class DraftRecoveryControls<Snapshot> {
  readonly recovery: DraftRecovery<Snapshot>;
  private readonly lifetime = new AbortController();

  constructor(status: HTMLElement, download: HTMLButtonElement) {
    this.recovery = new DraftRecovery<Snapshot>(
      (message) => {
        status.textContent = message;
      },
      (count) => {
        download.hidden = count === 0;
      },
    );
    download.addEventListener(
      'click',
      () => {
        const json = this.recovery.retainedDraftsJson();
        if (json) downloadJson(json, 'retained-editor-drafts.json');
      },
      { signal: this.lifetime.signal },
    );
  }

  dispose(): void {
    this.lifetime.abort();
    this.recovery.dispose();
  }
}
