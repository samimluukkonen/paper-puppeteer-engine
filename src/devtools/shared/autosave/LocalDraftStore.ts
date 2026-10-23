import { z } from 'zod';
import { validatePackageFiles } from '../../../engine/packageZip.js';
import type { PackageFiles } from '../package/characterPackage.js';

export const DRAFT_DATABASE = 'paper-puppeteer-recovery';
export const DRAFT_RETENTION = 2;
export const DRAFT_PROJECT_LIMIT = 10;
const LEASE_MS = 15_000;
const envelope = z.object({
  version: z.literal(1),
  id: z.string(),
  key: z.string(),
  name: z.string(),
  savedAt: z.number().min(0).max(8_640_000_000_000_000),
  revision: z.string(),
  files: z.array(z.object({ path: z.string(), blob: z.instanceof(Blob), digest: z.string() })),
});
export type DraftRecord = z.infer<typeof envelope>;
export interface DraftInfo {
  id: string;
  key: string;
  name: string;
  savedAt: number;
}
export interface DraftStorage {
  claim(key: string, owner: string): Promise<void>;
  release(key: string, owner: string): Promise<void>;
  save(key: string, owner: string, name: string, revision: string, files: PackageFiles): Promise<void>;
  discard(key: string, owner: string): Promise<void>;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed.'));
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Local draft transaction interrupted.'));
    transaction.onerror = () => {}; // onabort reports the transaction failure.
  });
}
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function storageError(error: unknown, operation = 'Autosave'): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return `${operation} failed: browser storage is full. Export your work, then discard obsolete local drafts and retry.`;
  return `${operation} failed: ${message} Export your work to keep a disk copy, then retry ${operation === 'Autosave' ? 'local saving' : 'recovery'}.`;
}

/** Complete packages and their Blob bytes share one transaction. Failed writes retain both previous revisions. */
export class LocalDraftStore implements DraftStorage {
  private database: Promise<IDBDatabase> | undefined;
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private changed(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
  private readonly locks = new Map<
    string,
    { owner: string; ready: Promise<void>; finished: Promise<void>; release: () => void }
  >();
  constructor(private readonly factory?: IDBFactory) {}

  /** Browser-held locks disappear synchronously with a closed/crashed document. */
  private async lock(key: string, owner: string): Promise<boolean> {
    if (!globalThis.navigator?.locks) return false;
    const held = this.locks.get(key);
    if (held) {
      if (held.owner !== owner)
        throw new Error('Another tab or editor session is editing this local project. Close it and retry.');
      await held.ready;
      return true;
    }
    let release = (): void => {};
    const lifetime = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accept = (): void => {};
    let decline = (_error: unknown): void => {};
    const ready = new Promise<void>((resolve, reject) => {
      accept = resolve;
      decline = reject;
    });
    const finished = navigator.locks
      .request(`paper-puppeteer:draft:${key}`, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('Another tab or editor session is editing this local project. Close it and retry.');
        accept();
        await lifetime;
      })
      .catch((error: unknown) => {
        this.locks.delete(key);
        decline(error);
      });
    this.locks.set(key, { owner, ready, finished, release });
    await ready;
    return true;
  }

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const factory = this.factory ?? globalThis.indexedDB;
      if (!factory) return reject(new Error('Browser storage is unavailable.'));
      const opening = factory.open(DRAFT_DATABASE, 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore('drafts', { keyPath: 'id' }).createIndex('key', 'key');
        opening.result.createObjectStore('leases', { keyPath: 'key' });
      };
      opening.onsuccess = () => {
        const db = opening.result;
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
      opening.onerror = () => reject(opening.error ?? new Error('Browser storage is unavailable.'));
      opening.onblocked = () => reject(new Error('Close other editor tabs to upgrade local recovery storage.'));
    }).catch((error: unknown) => {
      this.database = undefined;
      throw error;
    });
    return this.database;
  }

  private async transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    action: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(stores, mode);
    const done = completed(tx);
    try {
      const result = await action(tx);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already aborted or complete. */
      }
      await done.catch(() => {});
      throw error;
    }
  }
  private async lease(tx: IDBTransaction, key: string, owner: string, exclusive: boolean): Promise<void> {
    const store = tx.objectStore('leases');
    const value: unknown = await request(store.get(key));
    const held = z.object({ owner: z.string(), expires: z.number() }).safeParse(value);
    if (!exclusive && held.success && held.data.owner !== owner && held.data.expires > Date.now())
      throw new Error(
        'Another tab or editor session is editing this local project. Close it and retry; its draft was kept.',
      );
    await request(store.put({ key, owner, expires: Date.now() + LEASE_MS }));
  }
  async claim(key: string, owner: string): Promise<void> {
    const exclusive = await this.lock(key, owner);
    await this.transaction(['leases'], 'readwrite', (tx) => this.lease(tx, key, owner, exclusive));
  }
  async release(key: string, owner: string): Promise<void> {
    try {
      await this.transaction(['leases'], 'readwrite', async (tx) => {
        const store = tx.objectStore('leases');
        const held = z.object({ owner: z.string() }).safeParse(await request(store.get(key)));
        if (held.success && held.data.owner === owner) await request(store.delete(key));
      });
    } finally {
      const held = this.locks.get(key);
      if (held?.owner === owner) {
        held.release();
        await held.finished;
        this.locks.delete(key);
      }
    }
  }
  async save(key: string, owner: string, name: string, revision: string, files: PackageFiles): Promise<void> {
    validatePackageFiles(files);
    const record: DraftRecord = {
      version: 1,
      id: crypto.randomUUID(),
      key,
      name,
      revision,
      savedAt: Date.now(),
      files: await Promise.all(
        [...files].map(async ([path, bytes]) => ({
          path,
          blob: new Blob([bytes]),
          digest: await digest(bytes),
        })),
      ),
    };
    const exclusive = await this.lock(key, owner);
    await this.transaction(['drafts', 'leases'], 'readwrite', async (tx) => {
      await this.lease(tx, key, owner, exclusive);
      const store = tx.objectStore('drafts');
      const all = await request<unknown[]>(store.getAll());
      const infos = all.map((value) => this.info(value));
      const keys = new Set(infos.map((info) => info.key));
      if (!keys.has(key) && keys.size >= DRAFT_PROJECT_LIMIT)
        throw new Error('Local recovery holds 10 projects. Discard an obsolete draft before retrying.');
      // Never prune incompatible envelopes automatically: a newer application may own them.
      const existing = all
        .flatMap((value) => {
          const parsed = envelope.safeParse(value);
          return parsed.success && parsed.data.key === key ? [parsed.data] : [];
        })
        .sort((a, b) => b.savedAt - a.savedAt);
      record.savedAt = Math.max(Date.now(), ...existing.map((entry) => entry.savedAt + 1));
      await request(store.add(record));
      for (const obsolete of existing.slice(DRAFT_RETENTION - 1)) await request(store.delete(obsolete.id));
    });
    this.changed();
  }
  private info(value: unknown): DraftInfo {
    const parsed = z
      .object({
        id: z.string(),
        key: z.string().catch(''),
        name: z.string().catch('Unreadable local draft'),
        savedAt: z.number().min(0).max(8_640_000_000_000_000).catch(0),
      })
      .parse(value);
    return { ...parsed, key: parsed.key || `corrupt:${parsed.id}` };
  }
  async list(): Promise<DraftInfo[]> {
    return this.transaction(['drafts'], 'readonly', async (tx) => {
      const all = await request<unknown[]>(tx.objectStore('drafts').getAll());
      return all.map((value) => this.info(value)).sort((a, b) => b.savedAt - a.savedAt);
    });
  }
  async read(id: string): Promise<PackageFiles> {
    const value: unknown = await this.transaction(['drafts'], 'readonly', (tx) =>
      request(tx.objectStore('drafts').get(id)),
    );
    if (typeof value === 'object' && value !== null && 'version' in value && value.version !== 1)
      throw new Error('Unsupported local snapshot version. Open this draft with a compatible application.');
    const result = envelope.safeParse(value);
    if (!result.success) throw new Error('Corrupt local snapshot or missing binary assets. Try the previous revision.');
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const entry of result.data.files) {
      const bytes = new Uint8Array(await entry.blob.arrayBuffer());
      if (files.has(entry.path) || (await digest(bytes)) !== entry.digest)
        throw new Error(`Corrupt local resource "${entry.path}". Try the previous revision.`);
      files.set(entry.path, bytes);
    }
    validatePackageFiles(files);
    return files;
  }
  async discard(key: string, owner: string): Promise<void> {
    const exclusive = await this.lock(key, owner);
    try {
      await this.transaction(['drafts', 'leases'], 'readwrite', async (tx) => {
        await this.lease(tx, key, owner, exclusive);
        const store = tx.objectStore('drafts');
        const values = await request<unknown[]>(store.getAll());
        for (const value of values) {
          const info = this.info(value);
          if (info.key === key) await request(store.delete(info.id));
        }
        await request(tx.objectStore('leases').delete(key));
      });
    } finally {
      await this.release(key, owner);
    }
    this.changed();
  }
}
