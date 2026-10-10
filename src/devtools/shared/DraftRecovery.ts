import { z } from 'zod';
import { sameDraftSource } from './draftSource.js';

const draftSchema = z.strictObject({
  version: z.literal(1),
  source: z.string(),
  data: z.unknown(),
  revision: z.string().optional(),
  savedAt: z.string().optional(),
});

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
  private persisted: string | null = null;
  private owner: string | undefined;
  private recovered: { key: string; text: string } | undefined;
  private pendingFlush = false;
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

  private ownedKey(session: DraftSession<Snapshot>): string {
    this.owner ??= crypto.getRandomValues(new Uint32Array(4)).join('-');
    return `${this.storageKey(session)}:session:${this.owner}`;
  }

  private draftKeys(session: DraftSession<Snapshot>): string[] {
    const base = this.storageKey(session);
    const storage = window.localStorage;
    // Earlier releases stored one shared draft per document.
    const keys = storage.getItem(base) === null ? [] : [base];
    for (let index = 0; index < storage.length; ++index) {
      const key = storage.key(index);
      if (key?.startsWith(`${base}:session:`)) keys.push(key);
    }
    return keys;
  }

  /** Another tab may have replaced the shared draft since this session read or wrote it. */
  private removeDraft(key: string, expected: string | null): void {
    if (expected !== null && window.localStorage.getItem(key) === expected) window.localStorage.removeItem(key);
  }

  /** Explicit imported baselines can skip restoration while retaining normal persistence afterward. */
  bind(session: DraftSession<Snapshot>, options: { recover?: boolean } = {}): void {
    this.flush();
    this.session = session;
    this.snapshot = undefined;
    this.dirty = undefined;
    this.persisted = null;
    this.recovered = undefined;
    this.pendingFlush = false;
    this.status('');
    try {
      const keys = options.recover === false ? [] : this.draftKeys(session);
      for (const [index, key] of keys.entries()) {
        const text = window.localStorage.getItem(key);
        if (text === null) continue;
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          data = undefined;
        }
        const parsed = draftSchema.safeParse(data);
        if (
          !parsed.success ||
          !sameDraftSource(parsed.data.source, session.source) ||
          !session.validate(parsed.data.data)
        ) {
          this.removeDraft(key, text);
          this.status('An older draft could not be restored and was discarded.');
        } else if (
          window.confirm(
            `Restore unsaved ${session.label} edits from this browser?${keys.length > 1 ? ` Draft ${index + 1} of ${keys.length}.` : ''}${parsed.data.savedAt ? ` Saved ${parsed.data.savedAt}.` : ''}`,
          )
        ) {
          if (session.restore(parsed.data.data)) {
            this.recovered = { key, text };
            this.status('Draft restored. Download JSON to save your work.');
            break;
          } else {
            this.removeDraft(key, text);
            this.status('The draft could not be restored.');
          }
        } else this.removeDraft(key, text);
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
    this.pendingFlush = true;
    this.cancelTimer();
    if (!dirty) this.flush();
    else this.timer = setTimeout(() => this.flush(), 300);
  }

  /** Flush on navigation as well as debounce so the final authored edit survives reloads. */
  flush(): void {
    this.cancelTimer();
    const session = this.session;
    if (!session || this.dirty === undefined || !this.pendingFlush) return;
    try {
      const key = this.ownedKey(session);
      if (!this.dirty) {
        this.removeDraft(key, this.persisted);
        this.persisted = null;
      } else {
        const data = session.data(this.snapshot!);
        // Keep the last valid draft while an authored edit is temporarily invalid.
        if (!session.validate(data)) return;
        // getRandomValues is also available on HTTP development hosts, unlike randomUUID.
        const revision = crypto.getRandomValues(new Uint32Array(4)).join('-');
        const text = JSON.stringify({
          version: 1,
          source: session.source,
          data,
          revision,
          savedAt: new Date().toISOString(),
        });
        window.localStorage.setItem(key, text);
        this.persisted = text;
      }
      // Transfer a restored draft only after its replacement is durable. Other
      // sessions always write their own keys, even when edits happen concurrently.
      if (this.recovered) {
        if (this.recovered.key !== key || !this.dirty) this.removeDraft(this.recovered.key, this.recovered.text);
        this.recovered = undefined;
      }
      this.pendingFlush = false;
    } catch {
      this.status('Could not save a browser draft. Download JSON to save your work.');
    }
  }

  unbind(): void {
    this.flush();
    this.session = undefined;
    this.snapshot = undefined;
    this.dirty = undefined;
    this.persisted = null;
    this.recovered = undefined;
    this.pendingFlush = false;
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
