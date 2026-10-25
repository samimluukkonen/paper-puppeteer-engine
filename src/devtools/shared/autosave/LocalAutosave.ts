import type { PackageFiles } from '../package/characterPackage.js';
import { notifySubscribers } from '../subscriberNotifications.js';
import { type DraftStorage, storageError } from './LocalDraftStore.js';

export interface AutosaveSource {
  revision: string;
  name: string;
  dirty: boolean;
  /** Must capture every authored domain synchronously before its first await. */
  build(signal: AbortSignal): Promise<PackageFiles>;
}

/** One owner per document; UI/playback notifications are filtered by authored fingerprints. */
export class LocalAutosave {
  readonly owner = crypto.randomUUID();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private saved: string | undefined;
  private exportedRevision: string | undefined;
  private observed: string | undefined;
  private saving = false;
  private buildRequest: AbortController | undefined;
  private stopped = false;
  private disabled = false;
  private suspended = false;
  private message = 'Unsaved changes';
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): string => this.message;
  constructor(
    readonly key: string,
    private readonly storage: DraftStorage,
    private readonly source: () => AutosaveSource | undefined,
    private readonly delay = 1000,
  ) {}
  private publish(message: string): void {
    if (message === this.message || this.stopped) return;
    this.message = message;
    notifySubscribers(this.listeners, 'Autosave subscribers failed.');
  }
  private savedMessage(revision: string): string {
    return `Local draft saved · export a ZIP for a disk copy${this.exportedRevision === revision ? ' · Explicitly exported' : ''}`;
  }
  start(): void {
    if (this.stopped) return;
    this.suspended = false;
    this.observed = undefined;
    this.heartbeat ??= setInterval(() => {
      if (!this.disabled)
        void this.storage.claim(this.key, this.owner).catch((error: unknown) => {
          this.publish(storageError(error));
        });
    }, 5000);
    this.update();
  }
  private capture(): AutosaveSource | undefined {
    try {
      return this.source();
    } catch (error) {
      this.publish(storageError(error));
      return undefined;
    }
  }
  update = (): void => {
    if (this.stopped || this.disabled || this.suspended) return;
    const source = this.capture();
    // undefined means an open gesture/import: never persist its intermediate state.
    if (!source) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.observed = undefined;
      return;
    }
    if (source.revision === this.observed) return;
    this.observed = source.revision;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (source.revision === this.saved) {
      this.publish(this.savedMessage(source.revision));
      return;
    }
    if (!source.dirty && this.saved === undefined) {
      this.publish('No unsaved changes in this session');
      return;
    }
    this.publish('Unsaved changes');
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.delay);
  };
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped || this.disabled || this.saving || this.suspended) return;
    const source = this.capture();
    if (!source || source.revision === this.saved || (!source.dirty && this.saved === undefined)) return;
    this.saving = true;
    const request = new AbortController();
    this.buildRequest = request;
    const timeout = setTimeout(
      () => request.abort(new DOMException('Local draft preparation timed out.', 'TimeoutError')),
      60_000,
    );
    this.publish('Saving locally…');
    try {
      // Start building now, before awaiting the lease; build() captures a consistent revision.
      const files = await abortable(source.build(request.signal), request.signal);
      request.signal.throwIfAborted();
      // Once dispatched, the atomic storage transaction must settle before discard.
      this.buildRequest = undefined;
      clearTimeout(timeout);
      if (this.stopped || this.disabled || this.suspended) return;
      await this.storage.save(this.key, this.owner, source.name, source.revision, files);
      this.saved = source.revision;
      this.publish(this.savedMessage(source.revision));
    } catch (error) {
      if (!this.stopped && !this.disabled && !this.suspended) this.publish(storageError(error));
    } finally {
      clearTimeout(timeout);
      if (this.buildRequest === request) this.buildRequest = undefined;
      this.saving = false;
      // save() hashes artwork before opening its transaction and can reacquire a lock
      // after suspend/dispose's prompt release. Release again once all its I/O settles.
      if (this.stopped || this.suspended) {
        void this.storage.release(this.key, this.owner).catch(() => {});
      } else {
        // A revision changed during I/O. Schedule its own capture, never label it saved.
        const latest = this.capture();
        if (latest && latest.revision !== source.revision) {
          this.observed = undefined;
          this.update();
        }
      }
    }
  }
  retry = (): void => {
    this.disabled = false;
    this.observed = undefined;
    this.update();
    void this.flush();
  };
  exported(): void {
    const source = this.capture();
    this.exportedRevision = source && !source.dirty ? source.revision : undefined;
    this.publish(`Explicitly exported · download started${source?.dirty ? ' · newer changes remain unsaved' : ''}`);
  }
  /** pagehide releases promptly; a crash without this event expires the lease after 15 seconds. */
  suspend(): void {
    this.suspended = true;
    this.buildRequest?.abort(new DOMException('Local saving suspended.', 'AbortError'));
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    clearTimeout(this.timer);
    void this.storage.release(this.key, this.owner).catch(() => {});
  }
  /** Explicit removal disables future writes until the user asks to resume. */
  async discard(): Promise<void> {
    this.disabled = true;
    this.buildRequest?.abort(new DOMException('Local draft discarded.', 'AbortError'));
    clearTimeout(this.timer);
    // Do not race an already dispatched transaction.
    while (this.saving) await new Promise((resolve) => setTimeout(resolve, 10));
    try {
      await this.storage.discard(this.key, this.owner);
      this.saved = undefined;
      this.publish('Local draft discarded · autosave paused; export or resume local saving');
    } catch (error) {
      this.publish(storageError(error));
    }
  }
  dispose(): void {
    this.stopped = true;
    this.buildRequest?.abort(new DOMException('Local saving disposed.', 'AbortError'));
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    this.listeners.clear();
    // Release promptly; flush's finally also releases if artwork hashing is still pending.
    void this.storage.release(this.key, this.owner).catch(() => {});
  }
}
import { abortable } from '../../../engine/abortable.js';
