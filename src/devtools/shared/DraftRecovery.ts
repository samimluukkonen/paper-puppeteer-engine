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
  private readonly retained: { text: string }[] = [];

  constructor(
    private readonly status: (message: string) => void,
    private readonly retainedDraftsChanged: (count: number) => void = () => {},
  ) {
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

  private reportStatus(message: string): void {
    const retained = this.retained.length
      ? `${this.retained.length} older draft(s) could not be restored and were retained. Download retained drafts to recover their JSON manually.`
      : '';
    this.status([message, retained].filter(Boolean).join(' '));
  }

  /** Preserve original envelopes and authored data; downloading never changes storage or the saved baseline. */
  retainedDraftsJson(): string | undefined {
    if (!this.retained.length) return undefined;
    return `{\n  "version": 1,\n  "drafts": [\n${this.retained.map(({ text }) => text).join(',\n')}\n  ]\n}\n`;
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

  private recoveryCandidates(session: DraftSession<Snapshot>) {
    const candidates = this.draftKeys(session).flatMap((key) => {
      const text = window.localStorage.getItem(key);
      if (text === null) return [];
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined;
      }
      const parsed = draftSchema.safeParse(data);
      if (!parsed.success) {
        this.removeDraft(key, text);
        this.reportStatus('An invalid draft was discarded.');
        return [];
      }
      if (!sameDraftSource(parsed.data.source, session.source) || !session.validate(parsed.data.data)) {
        this.retained.push({ text });
        return [];
      }
      const timestamp = Date.parse(parsed.data.savedAt ?? '');
      return [{ key, text, draft: parsed.data, timestamp: Number.isFinite(timestamp) ? timestamp : -Infinity }];
    });
    // Storage enumeration has no chronological meaning. Stable ties retain the
    // existing order for legacy drafts with missing or invalid timestamps.
    return candidates.sort((left, right) =>
      left.timestamp === right.timestamp ? 0 : right.timestamp - left.timestamp,
    );
  }

  /** Explicit imported baselines can skip restoration while retaining normal persistence afterward. */
  bind(session: DraftSession<Snapshot>, options: { recover?: boolean } = {}): void {
    this.flush();
    this.session = session;
    // A replacement source must not overwrite an incompatible draft from this same controller.
    this.owner = undefined;
    this.snapshot = undefined;
    this.dirty = undefined;
    this.persisted = null;
    this.recovered = undefined;
    this.pendingFlush = false;
    this.retained.length = 0;
    this.retainedDraftsChanged(0);
    this.reportStatus('');
    try {
      const candidates = options.recover === false ? [] : this.recoveryCandidates(session);
      for (const [index, { key, text, draft }] of candidates.entries()) {
        if (
          window.confirm(
            `Restore unsaved ${session.label} edits from this browser?${candidates.length > 1 ? ` Draft ${index + 1} of ${candidates.length}.` : ''}${draft.savedAt ? ` Saved ${draft.savedAt}.` : ''}`,
          )
        ) {
          if (session.restore(draft.data)) {
            this.recovered = { key, text };
            this.reportStatus('Draft restored. Download JSON to save your work.');
            break;
          } else {
            this.retained.push({ text });
            this.reportStatus('The draft could not be restored.');
          }
        } else this.removeDraft(key, text);
      }
      if (this.retained.length && !this.recovered) this.reportStatus('');
    } catch {
      this.reportStatus('Browser draft recovery is unavailable. Download JSON to save your work.');
    }
    this.retainedDraftsChanged(this.retained.length);
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
      this.reportStatus('Could not save a browser draft. Download JSON to save your work.');
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
    this.retained.length = 0;
    this.retainedDraftsChanged(0);
    this.reportStatus('');
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.flush();
    this.lifetime.abort();
    this.session = undefined;
    this.retained.length = 0;
  }
}
