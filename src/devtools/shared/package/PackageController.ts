import { downloadBlob } from '../../../shared/downloadJson.js';
import { notifySubscribers } from '../subscriberNotifications.js';
import {
  buildCharacterPackage,
  capturePackage,
  type PackageFiles,
  type PackageSnapshot,
  validatePackage,
} from './characterPackage.js';
import { packageDraftWarnings } from './packageDraftWarnings.js';
import { PackageFingerprints, type PackageDomains } from './PackageFingerprints.js';
import { PACKAGE_MAX_BYTES } from './packageZip.js';
import { type PackageZipProcessor, packageZipWorker } from './packageZipWorkerClient.js';

export type { PackageDomains } from './PackageFingerprints.js';
const clean: PackageDomains = { Rig: '', Skins: '', Animations: '', Assets: '' };

/** Independent package checkpoints never mark source files or individual editor documents saved. */
export class PackageController {
  constructor(
    private readonly zip: PackageZipProcessor = packageZipWorker,
    private readonly fetcher?: typeof fetch,
  ) {}

  private source: (() => PackageSnapshot) | undefined;
  private baseline: PackageDomains = clean;
  private assessed: PackageDomains | undefined;
  private readonly fingerprints = new PackageFingerprints();
  private listeners = new Set<() => void>();
  private request: AbortController | undefined;
  private lastFiles: PackageFiles | null = null;
  private snapshot = {
    ready: false,
    busy: false,
    unsavedCharacter: false,
    message: 'Load a character to export a package.',
    modified: [] as string[],
    draftWarnings: [] as string[],
    preview: null as PackageFiles | null,
  };
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  get hasUnsavedChanges(): boolean {
    return this.snapshot.unsavedCharacter || this.snapshot.modified.length > 0;
  }
  get hasUnsavedCharacter(): boolean {
    return this.snapshot.unsavedCharacter;
  }

  private publish(update: Partial<typeof this.snapshot> = {}): void {
    this.snapshot = { ...this.snapshot, ...update };
    notifySubscribers(this.listeners, 'Package subscribers failed.');
  }
  bind(source: () => PackageSnapshot, unsavedCharacter = false): void {
    this.request?.abort();
    this.request = undefined;
    this.source = source;
    this.assessed = undefined;
    const current = source();
    this.baseline = this.fingerprints.compute({
      ...current,
      rig: structuredClone(current.definition.rigFile!),
      skins: current.definition.standaloneSkins,
      animations: current.definition.animations,
      replacements: [],
    });
    this.lastFiles = null;
    this.refresh();
    this.publish({
      ready: true,
      busy: false,
      preview: null,
      unsavedCharacter,
      message: unsavedCharacter
        ? 'New / Unsaved character. Download a character ZIP to save the complete draft.'
        : 'Export includes all character files and images.',
    });
  }
  refresh = (): void => {
    if (!this.source) return;
    try {
      const source = this.source();
      const domains = this.fingerprints.compute(source);
      // Playback notifications must not re-assess or re-render authored content.
      if (
        this.assessed &&
        (Object.keys(domains) as (keyof PackageDomains)[]).every((key) => domains[key] === this.assessed![key])
      )
        return;
      this.assessed = domains;
      const modified = (Object.keys(domains) as (keyof PackageDomains)[]).filter(
        (key) => domains[key] !== this.baseline[key],
      );
      const draftWarnings = packageDraftWarnings(source);
      if (
        modified.length === this.snapshot.modified.length &&
        modified.every((domain, index) => domain === this.snapshot.modified[index]) &&
        draftWarnings.length === this.snapshot.draftWarnings.length &&
        draftWarnings.every((warning, index) => warning === this.snapshot.draftWarnings[index])
      )
        return;
      this.publish({ modified, draftWarnings });
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
      const checkpoint = this.fingerprints.compute(captured);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
      const files = await buildCharacterPackage(captured, this.fetcher ?? fetch, signal);
      const { bytes, files: exportedFiles } = await this.zip.encode(files, signal);
      signal.throwIfAborted();
      downloadBlob(
        new Blob([bytes], { type: 'application/zip' }),
        `${captured.definition.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`,
      );
      this.lastFiles = exportedFiles;
      this.baseline = checkpoint;
      this.assessed = undefined;
      this.refresh();
      this.publish({
        unsavedCharacter: false,
        message: 'Package download started. Checkpoint recorded for these bytes; source files were not overwritten.',
      });
    } catch (error) {
      if (!request.signal.aborted)
        this.publish({
          message: `Could not export character package: ${String(error)} Check the reported assets and try Download again.`,
        });
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
    this.fingerprints.clear();
    this.assessed = undefined;
    this.publish({
      ready: false,
      busy: false,
      unsavedCharacter: false,
      preview: null,
      modified: [],
      draftWarnings: [],
    });
  }
  dispose(): void {
    this.unbind();
    this.listeners.clear();
  }
}
