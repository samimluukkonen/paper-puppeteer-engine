import { downloadJson } from '../../shared/downloadJson.js';
import { DraftRecovery } from './DraftRecovery.js';

/** Shared recovery feedback and manual download for drafts incompatible with the current source. */
export class DraftRecoveryControls<Snapshot> {
  readonly recovery: DraftRecovery<Snapshot>;
  private readonly lifetime = new AbortController();

  constructor(
    status: HTMLElement | readonly HTMLElement[],
    download: HTMLButtonElement | readonly HTMLButtonElement[],
  ) {
    const statuses: readonly HTMLElement[] = Array.isArray(status) ? status : [status as HTMLElement];
    const downloads: readonly HTMLButtonElement[] = Array.isArray(download)
      ? download
      : [download as HTMLButtonElement];
    this.recovery = new DraftRecovery<Snapshot>(
      (message) => {
        for (const target of statuses) target.textContent = message;
      },
      (count) => {
        for (const target of downloads) target.hidden = count === 0;
      },
    );
    for (const target of downloads)
      target.addEventListener(
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
