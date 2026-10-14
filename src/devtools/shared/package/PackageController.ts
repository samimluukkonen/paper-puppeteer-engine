import { downloadBlob } from '../../../shared/downloadJson.js';
import { draftSource } from '../draftSource.js';
import { notifySubscribers } from '../subscriberNotifications.js';
import {
  buildCharacterPackage,
  capturePackage,
  type PackageFiles,
  type PackageSnapshot,
  validatePackage,
} from './characterPackage.js';
import { PACKAGE_MAX_BYTES } from './packageZip.js';
import { type PackageZipProcessor, packageZipWorker } from './packageZipWorkerClient.js';

export type PackageDomains = Readonly<Record<'Rig' | 'Skins' | 'Animations' | 'Assets', string>>;
const clean: PackageDomains = { Rig: '', Skins: '', Animations: '', Assets: '' };

/** Independent package checkpoints never mark source files or individual editor documents saved. */
export class PackageController {
  constructor(private readonly zip: PackageZipProcessor = packageZipWorker) {}

  private source: (() => PackageSnapshot) | undefined;
  private baseline: PackageDomains = clean;
  private domains: PackageDomains = clean;
  private readonly blobIds = new WeakMap<Blob, number>();
  private blobSerial = 0;
  private listeners = new Set<() => void>();
  private request: AbortController | undefined;
  private cachedInputs: unknown[] = [];
  private lastFiles: PackageFiles | null = null;
  private snapshot = {
    ready: false,
    busy: false,
    message: 'Load a character to export a package.',
    modified: [] as string[],
    preview: null as PackageFiles | null,
  };
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  get hasUnsavedChanges(): boolean {
    return this.snapshot.modified.length > 0;
  }

  private publish(update: Partial<typeof this.snapshot> = {}): void {
    this.snapshot = { ...this.snapshot, ...update };
    notifySubscribers(this.listeners, 'Package subscribers failed.');
  }
  bind(source: () => PackageSnapshot): void {
    this.request?.abort();
    this.request = undefined;
    this.source = source;
    const current = source();
    this.baseline = this.fingerprint({
      ...current,
      rig: structuredClone(current.definition.rigFile!),
      skins: current.definition.standaloneSkins,
      animations: current.definition.animations,
      replacements: [],
    });
    this.cachedInputs = [];
    this.lastFiles = null;
    this.refresh();
    this.publish({
      ready: true,
      busy: false,
      preview: null,
      message: 'Export includes all character files and images.',
    });
  }
  private fingerprint(snapshot: PackageSnapshot): PackageDomains {
    const { skins: embedded, ...rig } = snapshot.rig;
    return {
      Rig: draftSource(rig),
      Skins: draftSource([embedded, snapshot.skins]),
      Animations: draftSource(snapshot.animations.map((clip) => ({ ...clip, version: 1 }))),
      Assets: draftSource(
        snapshot.replacements.map((entry) => {
          let id = this.blobIds.get(entry.blob);
          if (!id) {
            id = ++this.blobSerial;
            this.blobIds.set(entry.blob, id);
          }
          return { ...entry, blob: id };
        }),
      ),
    };
  }
  refresh = (): void => {
    if (!this.source) return;
    try {
      const current = this.source();
      const { rig } = current;
      const inputs = [
        rig.name,
        rig.root,
        rig.bones,
        rig.slots,
        rig.attachments,
        rig.skins,
        rig.ik,
        ...current.skins,
        ...current.animations,
        ...current.replacements.flatMap((entry) => [
          entry.blob,
          entry.assetKey,
          entry.reference,
          entry.originScaleX,
          entry.originScaleY,
        ]),
      ];
      if (inputs.length === this.cachedInputs.length && inputs.every((entry, i) => entry === this.cachedInputs[i]))
        return;
      this.cachedInputs = inputs;
      this.domains = this.fingerprint(current);
      this.publish({
        modified: Object.keys(this.domains).filter(
          (key) => this.domains[key as keyof PackageDomains] !== this.baseline[key as keyof PackageDomains],
        ),
      });
    } catch {
      // An uncommitted artwork proposal blocks export but does not replace the last authored dirty state.
    }
  };
  async download(): Promise<void> {
    if (!this.source || this.snapshot.busy) return;
    const request = new AbortController();
    this.request?.abort();
    this.request = request;
    this.publish({ busy: true, message: 'Building and validating package…' });
    try {
      const captured = capturePackage(this.source());
      const checkpoint = this.fingerprint(captured);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
      const files = await buildCharacterPackage(captured, fetch, signal);
      const { bytes, files: exportedFiles } = await this.zip.encode(files, signal);
      signal.throwIfAborted();
      downloadBlob(
        new Blob([bytes], { type: 'application/zip' }),
        `${captured.definition.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`,
      );
      this.lastFiles = exportedFiles;
      this.baseline = checkpoint;
      this.cachedInputs = [];
      this.refresh();
      this.publish({
        message: 'Package download started. Checkpoint recorded for these bytes; source files were not overwritten.',
      });
    } catch (error) {
      if (!request.signal.aborted) this.publish({ message: String(error) });
    } finally {
      if (this.request === request) {
        this.request = undefined;
        this.publish({ busy: false });
      }
    }
  }
  previewExport(): void {
    if (!this.lastFiles) {
      this.publish({ message: 'Download a package first, then reload that exact snapshot.' });
      return;
    }
    this.publish({ preview: this.lastFiles });
  }
  async importPreview(file: File): Promise<void> {
    if (this.snapshot.busy) return;
    const request = new AbortController();
    this.request = request;
    this.publish({ busy: true, message: 'Validating imported package…' });
    try {
      if (file.size > PACKAGE_MAX_BYTES) throw new Error('Package exceeds 100 MiB.');
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
      const files = await this.zip.decode(new Uint8Array(await file.arrayBuffer()), signal);
      await validatePackage(files, signal);
      signal.throwIfAborted();
      this.publish({
        preview: files,
        message: 'Imported package validated. Runtime preview leaves your authored session intact.',
      });
    } catch (error) {
      if (!request.signal.aborted) this.publish({ message: String(error) });
    } finally {
      if (this.request === request) {
        this.request = undefined;
        this.publish({ busy: false });
      }
    }
  }
  closePreview = (): void => {
    this.publish({ preview: null });
  };
  unbind(): void {
    this.request?.abort();
    this.request = undefined;
    this.source = undefined;
    this.lastFiles = null;
    this.cachedInputs = [];
    this.publish({ ready: false, busy: false, preview: null, modified: [] });
  }
  dispose(): void {
    this.unbind();
    this.listeners.clear();
  }
}
