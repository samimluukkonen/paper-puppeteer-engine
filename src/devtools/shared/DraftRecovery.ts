import { z } from 'zod';

const draftSchema = z.strictObject({ version: z.literal(1), source: z.string(), data: z.unknown() });

export interface DraftSession<Snapshot> {
  readonly key: string;
  readonly source: string;
  readonly label: string;
  snapshot(this: void): Snapshot;
  dirty(this: void): boolean;
  data(this: void, snapshot: Snapshot): unknown;
  validate(this: void, data: unknown): boolean;
  restore(this: void, data: unknown): boolean;
}

/** Recover authored snapshots only; playback, selection, temporary fields and history stay in memory. */
export class DraftRecovery<Snapshot> {
  private session: DraftSession<Snapshot> | undefined;
  private snapshot: Snapshot | undefined;
  private dirty: boolean | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly lifetime = new AbortController();

  constructor(private readonly status: (message: string) => void) {
    const options = { signal: this.lifetime.signal };
    window.addEventListener('pagehide', () => this.flush(), options);
    window.addEventListener('beforeunload', () => this.flush(), options);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') this.flush();
      },
      options,
    );
  }

  private storageKey(session: DraftSession<Snapshot>): string {
    return `paper-puppeteer:draft:${session.key}`;
  }

  bind(session: DraftSession<Snapshot>): void {
    this.flush();
    this.session = session;
    this.snapshot = undefined;
    this.dirty = undefined;
    this.status('');
    try {
      const key = this.storageKey(session);
      const text = window.localStorage.getItem(key);
      if (text !== null) {
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          data = undefined;
        }
        const parsed = draftSchema.safeParse(data);
        if (!parsed.success || parsed.data.source !== session.source || !session.validate(parsed.data.data)) {
          window.localStorage.removeItem(key);
          this.status('An older draft could not be restored and was discarded.');
        } else if (window.confirm(`Restore unsaved ${session.label} edits from this browser?`)) {
          if (session.restore(parsed.data.data)) this.status('Draft restored. Download JSON to save your work.');
          else {
            window.localStorage.removeItem(key);
            this.status('The draft could not be restored.');
          }
        } else window.localStorage.removeItem(key);
      }
    } catch {
      this.status('Browser draft recovery is unavailable. Download JSON to save your work.');
    }
    this.update();
  }

  /** Snapshot identity keeps playback notifications from serializing unchanged documents. */
  update(): void {
    const session = this.session;
    if (!session || this.lifetime.signal.aborted) return;
    const snapshot = session.snapshot();
    const dirty = session.dirty();
    if (snapshot === this.snapshot && dirty === this.dirty) return;
    this.snapshot = snapshot;
    this.dirty = dirty;
    this.cancelTimer();
    if (!dirty) this.flush();
    else this.timer = setTimeout(() => this.flush(), 300);
  }

  /** Flush on navigation as well as debounce so the final authored edit survives reloads. */
  flush(): void {
    this.cancelTimer();
    const session = this.session;
    if (!session || this.dirty === undefined) return;
    try {
      const key = this.storageKey(session);
      if (!this.dirty) window.localStorage.removeItem(key);
      else {
        const data = session.data(this.snapshot!);
        // Keep the last valid draft while an authored edit is temporarily invalid.
        if (!session.validate(data)) return;
        window.localStorage.setItem(key, JSON.stringify({ version: 1, source: session.source, data }));
      }
    } catch {
      this.status('Could not save a browser draft. Download JSON to save your work.');
    }
  }

  unbind(): void {
    this.flush();
    this.session = undefined;
    this.snapshot = undefined;
    this.dirty = undefined;
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.flush();
    this.lifetime.abort();
    this.session = undefined;
  }
}
