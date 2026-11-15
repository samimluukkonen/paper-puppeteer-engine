import { z } from 'zod';
import { validatePackageFiles } from '../../../engine/core.js';
import type { PackageFiles } from '../package/characterPackage.js';
import { notifySubscribers } from '../subscriberNotifications.js';

export const DRAFT_DATABASE = 'paper-puppeteer-recovery';
export const DRAFT_RETENTION = 2;
export const DRAFT_PROJECT_LIMIT = 10;
const LEASE_MS = 15_000;
const savedAt = z.number().min(0).max(8_640_000_000_000_000);
const legacyEnvelope = z.object({
  version: z.literal(1),
  id: z.string(),
  key: z.string(),
  name: z.string(),
  savedAt,
  revision: z.string(),
  files: z.array(z.object({ path: z.string(), blob: z.instanceof(Blob), digest: z.string() })),
});
const revisionEnvelope = legacyEnvelope.extend({
  version: z.literal(2),
  files: z.array(z.object({ path: z.string(), digest: z.string() })),
});
export type DraftRecord = z.infer<typeof revisionEnvelope>;
const legacyInfo = z.object({ legacy: z.literal(true), compatible: z.boolean() });
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
function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;
  for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) return false;
  return true;
}
function info(value: unknown): DraftInfo {
  const parsed = z
    .object({
      id: z.string(),
      key: z.string().catch(''),
      name: z.string().catch('Unreadable local draft'),
      savedAt: savedAt.catch(0),
    })
    .parse(value);
  return { ...parsed, key: parsed.key || `corrupt:${parsed.id}` };
}

/** Count distinct project keys without reading any revision values. */
function projectCount(index: IDBIndex): Promise<number> {
  return new Promise((resolve, reject) => {
    let count = 0;
    const cursor = index.openKeyCursor(null, 'nextunique');
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      if (!cursor.result) return resolve(count);
      count++;
      cursor.result.continue();
    };
  });
}
export function storageError(error: unknown, operation = 'Autosave'): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return `${operation} failed: browser storage is full. Export your work, then discard obsolete local drafts and retry.`;
  return `${operation} failed: ${message} Export your work to keep a disk copy, then retry ${operation === 'Autosave' ? 'local saving' : 'recovery'}.`;
}

/** Revision metadata, shared binaries and their references commit/prune atomically. */
export class LocalDraftStore implements DraftStorage {
  private database: Promise<IDBDatabase> | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly resources = new WeakMap<
    Uint8Array<ArrayBuffer>,
    {
      bytes: Uint8Array<ArrayBuffer>;
      digest: Promise<string>;
    }
  >();

  private resource(bytes: Uint8Array<ArrayBuffer>) {
    const previous = this.resources.get(bytes);
    // Package serializers reuse bytes, but public callers may mutate them. Verify
    // against an owned snapshot before reusing its hash; capture before any I/O.
    if (previous && sameBytes(bytes, previous.bytes)) return previous;
    const snapshot = bytes.slice();
    const resource = { bytes: snapshot, digest: digest(snapshot) };
    this.resources.set(bytes, resource);
    void resource.digest.catch(() => {
      if (this.resources.get(bytes) === resource) this.resources.delete(bytes);
    });
    return resource;
  }
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private changed(): void {
    notifySubscribers(this.listeners, 'Local draft subscribers failed.');
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
      const opening = factory.open(DRAFT_DATABASE, 2);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'id' }).createIndex('key', 'key');
          db.createObjectStore('leases', { keyPath: 'key' });
        }
        const revisions = db.createObjectStore('revisions', { keyPath: 'id' });
        revisions.createIndex('key', 'key');
        db.createObjectStore('binaries');
        db.createObjectStore('references', { keyPath: 'id' }).createIndex('digest', 'digests', { multiEntry: true });
        // Existing envelopes stay in place until retention/discard removes them.
        // Upgrade copies only metadata, preserving corrupt/future envelopes too.
        const cursor = opening.transaction!.objectStore('drafts').openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          revisions.add({
            ...info(entry.value),
            legacy: true,
            compatible: legacyEnvelope.safeParse(entry.value).success,
          });
          entry.continue();
        };
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
  private async remove(tx: IDBTransaction, id: IDBValidKey): Promise<string[]> {
    const references = tx.objectStore('references');
    const value = z.object({ digests: z.array(z.string()) }).safeParse(await request(references.get(id)));
    await request(references.delete(id));
    await request(tx.objectStore('revisions').delete(id));
    await request(tx.objectStore('drafts').delete(id));
    return value.success ? value.data.digests : [];
  }

  private async collect(tx: IDBTransaction, digests: Set<string>): Promise<void> {
    const index = tx.objectStore('references').index('digest');
    for (const digest of digests) {
      if ((await request(index.count(digest))) === 0) await request(tx.objectStore('binaries').delete(digest));
    }
  }

  async save(key: string, owner: string, name: string, revision: string, files: PackageFiles): Promise<void> {
    validatePackageFiles(files);
    const prepared = [...files].map(([path, bytes]) => ({ path, ...this.resource(bytes) }));
    const resources = new Map<string, Uint8Array<ArrayBuffer>>();
    const entries = await Promise.all(
      prepared.map(async ({ path, bytes, digest }) => {
        const hash = await digest;
        resources.set(hash, bytes);
        return { path, digest: hash };
      }),
    );
    const record: DraftRecord = {
      version: 2,
      id: crypto.randomUUID(),
      key,
      name,
      revision,
      savedAt: Date.now(),
      files: entries,
    };
    const exclusive = await this.lock(key, owner);
    await this.transaction(['revisions', 'references', 'binaries', 'drafts', 'leases'], 'readwrite', async (tx) => {
      await this.lease(tx, key, owner, exclusive);
      const store = tx.objectStore('revisions');
      const index = store.index('key');
      const values: unknown[] = await request(index.getAll(key));
      if (!values.length && (await projectCount(index)) >= DRAFT_PROJECT_LIMIT)
        throw new Error('Local recovery holds 10 projects. Discard an obsolete draft before retrying.');
      // Never prune incompatible envelopes automatically: a newer application may own them.
      const existing = values
        .filter((value) => {
          const legacy = legacyInfo.safeParse(value);
          return legacy.success ? legacy.data.compatible : revisionEnvelope.safeParse(value).success;
        })
        .map(info)
        .sort((a, b) => b.savedAt - a.savedAt);
      record.savedAt = Math.max(Date.now(), ...existing.map((entry) => entry.savedAt + 1));
      await request(store.add(record));
      await request(tx.objectStore('references').add({ id: record.id, digests: [...resources.keys()] }));
      for (const [digest, bytes] of resources) {
        // Key-only existence checks never deserialize/rewrite an existing Blob.
        const binaries = tx.objectStore('binaries');
        if ((await request(binaries.count(digest))) === 0) await request(binaries.add(new Blob([bytes]), digest));
      }
      const obsolete = new Set<string>();
      for (const entry of existing.slice(DRAFT_RETENTION - 1))
        for (const digest of await this.remove(tx, entry.id)) obsolete.add(digest);
      await this.collect(tx, obsolete);
    });
    this.changed();
  }

  async list(): Promise<DraftInfo[]> {
    return this.transaction(['revisions'], 'readonly', async (tx) => {
      const all: unknown[] = await request(tx.objectStore('revisions').getAll());
      return all.map(info).sort((a, b) => b.savedAt - a.savedAt);
    });
  }

  async read(id: string): Promise<PackageFiles> {
    const entries = await this.transaction(['revisions', 'drafts', 'binaries'], 'readonly', async (tx) => {
      const metadata: unknown = await request(tx.objectStore('revisions').get(id));
      const legacy = legacyInfo.safeParse(metadata);
      const value: unknown = legacy.success ? await request(tx.objectStore('drafts').get(id)) : metadata;
      const version = legacy.success ? 1 : 2;
      if (typeof value === 'object' && value !== null && 'version' in value && value.version !== version)
        throw new Error('Unsupported local snapshot version. Open this draft with a compatible application.');
      if (legacy.success) {
        const parsed = legacyEnvelope.safeParse(value);
        if (!parsed.success)
          throw new Error('Corrupt local snapshot or missing binary assets. Try the previous revision.');
        return parsed.data.files;
      }
      const parsed = revisionEnvelope.safeParse(value);
      if (!parsed.success)
        throw new Error('Corrupt local snapshot or missing binary assets. Try the previous revision.');
      const blobs = new Map<string, Blob>();
      for (const { digest } of parsed.data.files) {
        if (blobs.has(digest)) continue;
        const blob: unknown = await request(tx.objectStore('binaries').get(digest));
        if (!(blob instanceof Blob))
          throw new Error('Corrupt local snapshot or missing binary assets. Try the previous revision.');
        blobs.set(digest, blob);
      }
      return parsed.data.files.map((entry) => ({ ...entry, blob: blobs.get(entry.digest)! }));
    });
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const entry of entries) {
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
      await this.transaction(['revisions', 'references', 'binaries', 'drafts', 'leases'], 'readwrite', async (tx) => {
        await this.lease(tx, key, owner, exclusive);
        const ids = await request(tx.objectStore('revisions').index('key').getAllKeys(key));
        const obsolete = new Set<string>();
        for (const id of ids) for (const digest of await this.remove(tx, id)) obsolete.add(digest);
        await this.collect(tx, obsolete);
        await request(tx.objectStore('leases').delete(key));
      });
    } finally {
      await this.release(key, owner);
    }
    this.changed();
  }
}
