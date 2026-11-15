import type Phaser from 'phaser';
import {
  replacementOriginScale,
  DEFAULT_CHARACTER_TEXTURE_LIMITS as limits,
  type ArtworkAlignmentPolicy,
  type ArtworkReference,
  type ArtworkReplacement,
} from '../../../engine/core.js';
import type { CharacterDefinition } from '../../../engine/data.js';
import type { Puppet } from '../../../engine/runtime.js';
import { assetFilename } from '../assetFilename.js';
import { SnapshotHistory } from '../SnapshotHistory.js';
import { notifySubscribers } from '../subscriberNotifications.js';
import { importSprite, type ImportedSprite, type SpriteMetadata } from './spriteImport.js';

export interface ArtworkTarget {
  readonly key: string;
  readonly filename: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly references: readonly string[];
  readonly individuals: readonly { reference: ArtworkReference; reason: string | null }[];
  readonly reason: string | null;
}

interface SpriteResource {
  readonly sprite: ImportedSprite;
  readonly assetKey: string;
  readonly reference: ArtworkReference | undefined;
  readonly previous: { width: number; height: number; originScaleX: number; originScaleY: number };
  originScaleX: number;
  originScaleY: number;
  key: string | null;
  texture: Phaser.Textures.Texture | null;
}

type ArtworkState = ReadonlyMap<string, SpriteResource>;

export interface ArtworkExport {
  assetKey: string;
  reference: ArtworkReference | undefined;
  blob: Blob;
  format: 'image/png' | 'image/webp';
  originScaleX: number;
  originScaleY: number;
  newAsset?: boolean;
}

export interface ArtworkSnapshot {
  readonly ready: boolean;
  readonly targets: readonly ArtworkTarget[];
  readonly selectedKey: string | null;
  readonly selectedReference: ArtworkReference | null;
  readonly policy: ArtworkAlignmentPolicy | null;
  readonly previousSize: { width: number; height: number } | null;
  readonly proposed: (SpriteMetadata & { readonly url: string }) | null;
  readonly applied: (SpriteMetadata & { readonly url: string }) | null;
  readonly pendingCount: number;
  readonly previewing: boolean;
  readonly importing: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly message: string;
}

let nextNamespace = 0;
const identity = (assetKey: string, reference?: ArtworkReference): string =>
  JSON.stringify([assetKey, reference ?? null]);
const frameReason = (frame?: string | number): string | null =>
  frame !== undefined && frame !== '__BASE'
    ? `Atlas/frame "${frame}" cannot be preserved by a static PNG/WebP. Choose a whole-image reference or resolve the frame in the attachment editor first.`
    : null;

/** Session-only artwork document and independent bounded history. Authored rig/animation data stays immutable. */
export class ArtworkController {
  private puppet: Puppet | undefined;
  private textures: Phaser.Textures.TextureManager | undefined;
  private definition: CharacterDefinition | undefined;
  private refreshAppearance: () => void = () => {};
  private readonly listeners = new Set<() => void>();
  private readonly importedAssets = new Map<string, ImportedSprite>();
  private applied = new Map<string, SpriteResource>();
  private rendered = new Map<string, SpriteResource>();
  private readonly resources = new Set<SpriteResource>();
  private history = this.createHistory();
  private candidate: SpriteResource | undefined;
  private request: AbortController | undefined;
  private readonly namespace = `__paper_artwork_${++nextNamespace}_`;
  private serial = 0;
  private snapshot: ArtworkSnapshot = {
    ready: false,
    targets: [],
    selectedKey: null,
    selectedReference: null,
    policy: null,
    previousSize: null,
    proposed: null,
    applied: null,
    pendingCount: 0,
    previewing: false,
    importing: false,
    canUndo: false,
    canRedo: false,
    message: 'Load a character to replace artwork.',
  };

  constructor(
    private readonly decode: typeof importSprite = importSprite,
    private readonly confirmReplacement?: (texture: string) => boolean,
  ) {}

  private createHistory(): SnapshotHistory<ArtworkState> {
    return new SnapshotHistory<ArtworkState>(
      () => new Map(this.applied),
      (state) => {
        this.install(state);
        this.applied = new Map(state);
      },
      (a, b) => a.size === b.size && [...a].every(([key, value]) => b.get(key) === value),
      20,
    );
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): ArtworkSnapshot => this.snapshot;
  get hasUnsavedChanges(): boolean {
    return this.applied.size > 0 || this.importedAssets.size > 0;
  }
  get hasPendingChanges(): boolean {
    return this.hasUnsavedChanges || this.hasPendingProposal;
  }
  get hasPendingProposal(): boolean {
    return !!this.candidate || !!this.request;
  }
  private get selectedIdentity(): string {
    return identity(this.snapshot.selectedKey ?? '', this.snapshot.selectedReference ?? undefined);
  }

  assetPreview(
    key: string,
    reference?: ArtworkReference,
  ): { url: string; filename: string; imported: boolean } | undefined {
    const target = this.snapshot.targets.find((entry) => entry.key === key);
    const imported =
      (reference ? this.applied.get(identity(key, reference)) : undefined)?.sprite ??
      this.applied.get(identity(key))?.sprite ??
      this.importedAssets.get(key);
    return imported
      ? { url: imported.url, filename: imported.filename, imported: true }
      : target
        ? { url: target.url, filename: target.filename, imported: false }
        : undefined;
  }

  /** Detached metadata retains immutable blobs, never private texture keys or object URLs. */
  exportReplacements() {
    if (this.candidate || this.request)
      throw new Error('Apply or cancel the artwork proposal before exporting a package.');
    return this.appliedReplacements();
  }

  /** Dirty status can inspect committed artwork while a separate proposal blocks export. */
  appliedReplacements(): ArtworkExport[] {
    const additions = [...this.importedAssets]
      .filter(([key]) => !this.applied.has(identity(key)))
      .map(([assetKey, sprite]) => ({
        assetKey,
        reference: undefined,
        blob: sprite.blob,
        format: sprite.format,
        originScaleX: 1,
        originScaleY: 1,
        newAsset: true,
      }));
    return [
      ...additions,
      ...[...this.applied.values()].map((entry) => ({
        assetKey: entry.assetKey,
        reference: entry.reference,
        blob: entry.sprite.blob,
        format: entry.sprite.format,
        originScaleX: entry.originScaleX,
        originScaleY: entry.originScaleY,
        newAsset: this.importedAssets.has(entry.assetKey) && !entry.reference,
      })),
    ];
  }

  private publish(update: Partial<ArtworkSnapshot>): void {
    const next = { ...this.snapshot, ...update };
    this.snapshot = {
      ...next,
      pendingCount: this.applied.size + this.importedAssets.size,
      applied: this.applied.get(identity(next.selectedKey ?? '', next.selectedReference ?? undefined))?.sprite ?? null,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    };
    notifySubscribers(this.listeners, 'Artwork subscribers failed.');
  }

  /** Catalog edits can introduce new logical references without replacing the preview puppet. */
  refreshTargets(): void {
    const { puppet, textures, definition } = this;
    if (!puppet || !textures || !definition) return;
    const targets = this.artworkTargets(puppet, textures, definition);
    this.publish({ targets, selectedKey: this.targetSelection(targets) });
  }

  private targetSelection(targets: readonly ArtworkTarget[]): string | null {
    return targets.some((target) => target.key === this.snapshot.selectedKey)
      ? this.snapshot.selectedKey
      : (targets[0]?.key ?? null);
  }

  private artworkTargets(
    puppet: Puppet,
    textures: Phaser.Textures.TextureManager,
    definition: CharacterDefinition,
  ): ArtworkTarget[] {
    const usages = puppet.getArtworkUsages();
    const keys = new Set([
      ...Object.keys(definition.textures),
      ...this.importedAssets.keys(),
      ...usages.map((entry) => entry.texture),
      ...[...this.applied.values()].map((entry) => entry.assetKey),
    ]);
    const targets: ArtworkTarget[] = [];
    for (const key of keys) {
      if (!textures.exists(key)) continue;
      const texture = textures.get(key);
      const frame = texture.get('__BASE');
      const source = texture.getSourceImage();
      const entries = usages.filter((entry) => entry.texture === key);
      const references: string[] = entries.map((entry) =>
        entry.reference.replace('bone:', 'Bone: ').replace('attachment:', 'Attachment: '),
      );
      for (const entry of entries)
        references.push(...entry.slots.map((slot) => `Slot: ${slot}`), ...entry.skins.map((skin) => `Skin: ${skin}`));
      targets.push({
        key,
        filename: this.importedAssets.get(key)?.filename ?? assetFilename(definition.textures[key], key),
        url: Object.hasOwn(definition.textures, key) ? definition.textureUrl(key) : 'src' in source ? source.src : '',
        width: frame.width,
        height: frame.height,
        references: [...new Set(references)],
        individuals: entries.map((entry) => ({ reference: entry.reference, reason: frameReason(entry.frame) })),
        reason: entries.some((entry) => frameReason(entry.frame))
          ? 'Atlas/frame references prevent shared replacement. Select a whole-image attachment or bone, or resolve every frame first.'
          : null,
      });
    }
    return targets;
  }

  bind(
    scene: Phaser.Scene,
    puppet: Puppet,
    definition: CharacterDefinition,
    refreshAppearance: () => void = () => {},
  ): void {
    if (this.puppet === puppet) {
      this.refreshAppearance = refreshAppearance;
      this.refreshTargets();
      return;
    }
    const sharedTextures = !this.textures || this.textures === scene.textures;
    if (sharedTextures) this.prepareTextures(scene);
    const targets = this.artworkTargets(puppet, scene.textures, definition);
    const state = sharedTextures ? this.applied : new Map<string, SpriteResource>();
    if (!this.textures) this.textures = scene.textures;
    // Validate retained replacements before canceling a proposal or changing either puppet.
    for (const resource of state.values()) {
      this.register(resource);
      puppet.validateArtworkReplacement(resource.assetKey, this.override(resource), resource.reference);
    }
    this.cancel();
    if (this.candidate) throw new Error('Could not cancel the artwork proposal before replacing the preview.');
    const rendered = this.installOn(puppet, new Map(), state, refreshAppearance);
    try {
      // Release the old consumers only after the replacement can render every override.
      if (sharedTextures) this.install(new Map());
      else this.unbind();
    } catch (error) {
      try {
        this.installOn(puppet, rendered, new Map(), refreshAppearance);
      } catch (rollbackError) {
        // oxlint-disable-next-line eslint/preserve-caught-error -- Both failures are retained in AggregateError.errors.
        throw new AggregateError([error, rollbackError], 'Artwork binding and rollback failed.', { cause: error });
      }
      throw error;
    }
    this.puppet = puppet;
    this.textures = scene.textures;
    this.definition = definition;
    this.refreshAppearance = refreshAppearance;
    this.rendered = rendered;
    this.publish({
      ready: true,
      targets,
      selectedKey: this.targetSelection(targets),
      message: 'Choose shared artwork or one logical attachment/bone, then import a PNG or WebP.',
    });
  }

  /** Restore project-owned additions before constructing a puppet that references them. */
  prepareTextures(scene: Phaser.Scene): void {
    for (const [key, sprite] of this.importedAssets) {
      if (!scene.textures.exists(key) && !scene.textures.addImage(key, sprite.image))
        throw new Error('Could not restore imported artwork.');
    }
  }

  select(key: string): void {
    if (!this.snapshot.targets.some((target) => target.key === key) || key === this.snapshot.selectedKey) return;
    this.cancel();
    this.publish({
      selectedKey: key,
      selectedReference: null,
      policy: null,
      message: 'Ready to import a replacement.',
    });
  }

  selectReference(reference: ArtworkReference | null): void {
    this.refreshTargets();
    const target = this.snapshot.targets.find((entry) => entry.key === this.snapshot.selectedKey);
    if (reference && !target?.individuals.some((entry) => entry.reference === reference)) return;
    if (reference === this.snapshot.selectedReference) return;
    this.cancel();
    this.publish({
      selectedReference: reference,
      policy: null,
      message: reference
        ? 'Only this logical artwork reference changes, across all slots and skins using it.'
        : 'Shared replacement updates all uses except explicit individual replacements.',
    });
  }

  setPolicy(policy: ArtworkAlignmentPolicy): void {
    if (!['normalized', 'pixels', 'manual'].includes(policy)) return;
    // Restore the baseline first so changing policies cannot compound a proposal's pivot migration.
    if (this.snapshot.previewing) {
      try {
        this.install(this.applied);
      } catch (error) {
        this.report(error);
        return;
      }
    }
    this.publish({ policy, previewing: false, message: 'Alignment policy changed. Preview again before applying.' });
  }

  async import(file: File): Promise<void> {
    this.cancel();
    if (this.candidate) return;
    this.refreshTargets();
    const target = this.snapshot.targets.find((entry) => entry.key === this.snapshot.selectedKey);
    const reference = this.snapshot.selectedReference ?? undefined;
    const reason = reference
      ? target?.individuals.find((entry) => entry.reference === reference)?.reason
      : target?.reason;
    if (!target || !this.puppet || !this.textures || reason) {
      this.publish({ message: reason ?? 'Load a character and choose an artwork reference first.' });
      return;
    }
    if (reference && !target.individuals.some((entry) => entry.reference === reference)) {
      this.publish({ message: 'This artwork reference was removed. Select an existing attachment or bone.' });
      return;
    }
    const old = this.puppet.getArtworkReplacement(target.key, reference);
    const oldFrame = this.textures.get(old?.textureKey ?? target.key).get('__BASE');
    const previous = {
      width: oldFrame.width,
      height: oldFrame.height,
      originScaleX: old?.originScaleX ?? 1,
      originScaleY: old?.originScaleY ?? 1,
    };
    const request = new AbortController();
    this.request = request;
    this.publish({ importing: true, message: 'Validating and decoding image…' });
    let sprite: ImportedSprite | undefined;
    try {
      sprite = await this.decode(file, request.signal);
      if (request.signal.aborted || this.request !== request) {
        sprite.dispose();
        return;
      }
      // Include retained undo data in the budget, not just textures currently visible.
      const resources = [...this.resources].map((entry) => entry.sprite).concat([...this.importedAssets.values()]);
      if (
        resources.reduce((sum, entry) => sum + entry.bytes, sprite.bytes) > limits.maxTotalImageBytes ||
        resources.reduce((sum, entry) => sum + entry.width * entry.height, sprite.width * sprite.height) >
          limits.maxTotalImagePixels
      )
        throw new Error(
          'Artwork and undo data exceed the session budget (50 MiB or 64 megapixels). Reopen the character to clear session history, or import a smaller image.',
        );
      this.candidate = {
        sprite,
        assetKey: target.key,
        reference,
        previous,
        originScaleX: previous.originScaleX,
        originScaleY: previous.originScaleY,
        key: null,
        texture: null,
      };
      this.resources.add(this.candidate);
      this.publish({
        proposed: sprite,
        previousSize: { width: previous.width, height: previous.height },
        importing: false,
        policy: previous.width === sprite.width && previous.height === sprite.height ? 'normalized' : null,
        message: 'Image ready. Choose an alignment policy for changed dimensions, then preview before applying.',
      });
    } catch (error) {
      sprite?.dispose();
      if (!request.signal.aborted && this.request === request) this.report(error, { importing: false });
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }

  /** Add real artwork to an empty character without inventing a rig reference or placeholder image. */
  async importAsset(file: File): Promise<void> {
    this.cancel();
    const textures = this.textures;
    if (!textures || !this.puppet || this.candidate) return;
    const request = new AbortController();
    this.request = request;
    this.publish({ importing: true, message: 'Validating new artwork...' });
    let sprite: ImportedSprite | undefined;
    let key: string | undefined;
    try {
      sprite = await this.decode(file, request.signal);
      request.signal.throwIfAborted();
      const retained = [...this.resources].map((entry) => entry.sprite).concat([...this.importedAssets.values()]);
      if (
        retained.reduce((sum, entry) => sum + entry.bytes, sprite.bytes) > limits.maxTotalImageBytes ||
        retained.reduce((sum, entry) => sum + entry.width * entry.height, sprite.width * sprite.height) >
          limits.maxTotalImagePixels
      )
        throw new Error('Artwork and undo data exceed the session image budget. Import a smaller image.');
      const stem =
        file.name
          .replace(/\.[^.]+$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-') || 'artwork';
      key = stem;
      let suffix = 1;
      while (textures.exists(key)) key = `${stem}-${++suffix}`;
      if (!textures.addImage(key, sprite.image)) throw new Error('Could not register the imported artwork.');
      this.importedAssets.set(key, sprite);
      this.refreshTargets();
      this.publish({
        selectedKey: key,
        selectedReference: null,
        importing: false,
        message:
          'Artwork added to the library. Create an attachment using this asset. Download a character ZIP to include its image.',
      });
    } catch (error) {
      if (key) {
        this.importedAssets.delete(key);
        if (textures.exists(key)) textures.remove(key);
      }
      sprite?.dispose();
      if (!request.signal.aborted) this.report(error, { importing: false });
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }

  private register(resource: SpriteResource): void {
    if (resource.key && this.textures?.get(resource.key) === resource.texture) return;
    const textures = this.textures;
    if (!textures) throw new Error('Artwork preview is unavailable. Reload the character.');
    let key: string;
    do {
      key = `${this.namespace}${++this.serial}`;
    } while (textures.exists(key));
    try {
      const texture = textures.addImage(key, resource.sprite.image);
      if (!texture) throw new Error('Phaser could not create the replacement texture. Try a smaller PNG.');
      resource.key = key;
      resource.texture = texture;
    } catch (error) {
      // addImage can fail after adding a cache entry. This freshly allocated key was absent before the call.
      if (textures.exists(key)) textures.remove(key);
      throw error;
    }
  }

  private override(resource: SpriteResource): ArtworkReplacement {
    return { textureKey: resource.key!, originScaleX: resource.originScaleX, originScaleY: resource.originScaleY };
  }

  /** Register first; refresh every retained consumer before releasing any displaced texture. */
  private install(state: ArtworkState): void {
    if (this.puppet) this.rendered = this.installOn(this.puppet, this.rendered, state, this.refreshAppearance);
  }

  /** Stage another puppet without transferring controller ownership until both previews are synchronized. */
  private installOn(
    puppet: Puppet,
    before: ArtworkState,
    state: ArtworkState,
    refreshAppearance: () => void,
  ): Map<string, SpriteResource> {
    // Complete registration and validation before touching even the first active image.
    for (const resource of state.values()) {
      this.register(resource);
      puppet.validateArtworkReplacement(resource.assetKey, this.override(resource), resource.reference);
    }
    const apply = (next: ArtworkState): void => {
      for (const resource of next.values()) this.register(resource);
      const all = new Map([...before, ...state]);
      // Shared overrides install first; individual overrides always take precedence.
      for (const resource of [...all.values()].sort((a, b) => Number(!!a.reference) - Number(!!b.reference))) {
        const desired = next.get(identity(resource.assetKey, resource.reference));
        puppet.setArtworkReplacement(
          resource.assetKey,
          desired ? this.override(desired) : undefined,
          resource.reference,
        );
      }
      refreshAppearance();
    };
    try {
      apply(state);
      return new Map(state);
    } catch (error) {
      try {
        apply(before);
      } catch (rollbackError) {
        // Track every possibly installed scope so a later Cancel/teardown can retry restoration safely.
        if (puppet === this.puppet) this.rendered = new Map([...before, ...state]);
        // oxlint-disable-next-line eslint/preserve-caught-error -- Both errors are retained in AggregateError.errors.
        throw new AggregateError(
          [error, rollbackError],
          'Artwork refresh and rollback failed. Original asset data is retained; reload the preview.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  preview(): void {
    const candidate = this.candidate;
    if (!candidate || !this.puppet) return;
    if (!this.snapshot.policy) {
      this.publish({ message: 'Dimensions changed. Choose an alignment policy before previewing.' });
      return;
    }
    Object.assign(candidate, replacementOriginScale(this.snapshot.policy, candidate.previous, candidate.sprite));
    const state = new Map(this.applied).set(identity(candidate.assetKey, candidate.reference), candidate);
    try {
      this.install(state);
      this.publish({
        previewing: true,
        message:
          this.snapshot.policy === 'manual'
            ? 'Preview uses the current normalized origin. Apply, then realign with the artwork alignment tools.'
            : 'Preview only. Apply to keep this artwork change, or Cancel to restore.',
      });
    } catch (error) {
      // A failed rollback may leave a consumer holding the proposed texture; retain it until teardown.
      if (!(error instanceof AggregateError) && ![...this.rendered.values()].includes(candidate))
        this.releaseTexture(candidate);
      this.report(error, { previewing: false });
    }
  }

  apply(): void {
    const candidate = this.candidate;
    if (!candidate || !this.snapshot.previewing) return;
    if (!candidate.reference && this.confirmReplacement && !this.confirmReplacement(candidate.assetKey)) return;
    try {
      // The catalog may have changed since Preview. Commit must revalidate its current frame references.
      this.install(this.rendered);
      this.history.change(() => {
        this.applied.set(identity(candidate.assetKey, candidate.reference), candidate);
      });
    } catch (error) {
      try {
        this.install(this.applied);
        this.collect();
        this.report(error, { previewing: false });
      } catch (rollbackError) {
        this.report(rollbackError);
      }
      return;
    }
    this.candidate = undefined;
    this.collect();
    this.publish({
      proposed: null,
      previousSize: null,
      previewing: false,
      message: 'Replacement applied in this session. Artwork Undo/Redo is separate from rig and animation history.',
    });
  }

  cancel(): void {
    this.request?.abort();
    this.request = undefined;
    try {
      if (this.snapshot.previewing || this.candidate?.key) this.install(this.applied);
      this.candidate = undefined;
      this.collect();
      this.publish({
        proposed: null,
        previousSize: null,
        previewing: false,
        importing: false,
        message: 'Replacement cancelled. Previous artwork restored.',
      });
    } catch (error) {
      this.report(error);
    }
  }

  revert(): void {
    if (
      !this.snapshot.selectedReference &&
      this.snapshot.selectedKey &&
      this.applied.has(this.selectedIdentity) &&
      this.confirmReplacement &&
      !this.confirmReplacement(this.snapshot.selectedKey)
    )
      return;
    this.cancel();
    if (this.candidate || !this.applied.has(this.selectedIdentity)) return;
    try {
      this.history.change(() => {
        const state = new Map(this.applied);
        state.delete(this.selectedIdentity);
        this.install(state);
        this.applied = state;
      });
      this.collect();
      this.publish({
        message: this.snapshot.selectedReference
          ? 'Individual replacement reverted. Shared or original artwork restored.'
          : 'Original shared artwork restored.',
      });
    } catch (error) {
      this.report(error);
    }
  }

  undo(): void {
    this.restoreHistory('undo');
  }
  redo(): void {
    this.restoreHistory('redo');
  }
  private restoreHistory(action: 'undo' | 'redo'): void {
    this.cancel();
    if (this.candidate) return;
    try {
      this.history[action]();
      this.collect();
      this.publish({ message: `Artwork ${action} complete.` });
    } catch (error) {
      if (!(error instanceof AggregateError)) this.collect();
      this.report(error);
    }
  }

  private report(error: unknown, update: Partial<ArtworkSnapshot> = {}): void {
    this.publish({ ...update, message: error instanceof Error ? error.message : String(error) });
  }

  private releaseTexture(resource: SpriteResource): void {
    if (
      resource.key &&
      resource.texture &&
      this.textures?.exists(resource.key) &&
      this.textures.get(resource.key) === resource.texture
    )
      this.textures.remove(resource.key);
    resource.key = null;
    resource.texture = null;
  }

  private collect(): void {
    const retained = new Set([
      ...this.applied.values(),
      ...this.history.retainedSnapshots.flatMap((entry) => [...entry.values()]),
      ...(this.candidate ? [this.candidate] : []),
    ]);
    const visible = new Set(this.rendered.values());
    for (const resource of this.resources) {
      if (!visible.has(resource)) this.releaseTexture(resource);
      if (!retained.has(resource) && !visible.has(resource)) {
        resource.sprite.dispose();
        this.resources.delete(resource);
      }
    }
  }

  /** Release every renderer reference while retaining authored blobs and artwork history. */
  suspend(): void {
    this.cancel();
    this.install(new Map());
    for (const resource of this.resources) this.releaseTexture(resource);
    for (const key of this.importedAssets.keys()) {
      if (this.textures?.exists(key)) this.textures.remove(key);
    }
    this.rendered.clear();
    this.puppet = undefined;
    this.textures = undefined;
    this.definition = undefined;
    this.refreshAppearance = () => {};
    this.publish({ ready: false, targets: [], proposed: null, applied: null, previewing: false, importing: false });
  }

  unbind(): void {
    this.cancel();
    this.install(new Map());
    for (const resource of this.resources) {
      this.releaseTexture(resource);
      resource.sprite.dispose();
    }
    this.resources.clear();
    for (const [key, sprite] of this.importedAssets) {
      if (this.textures?.exists(key)) this.textures.remove(key);
      sprite.dispose();
    }
    this.importedAssets.clear();
    this.applied.clear();
    this.rendered.clear();
    this.candidate = undefined;
    this.history = this.createHistory();
    this.puppet = undefined;
    this.textures = undefined;
    this.definition = undefined;
    this.refreshAppearance = () => {};
    this.publish({
      ready: false,
      targets: [],
      selectedKey: null,
      selectedReference: null,
      policy: null,
      proposed: null,
      previousSize: null,
      previewing: false,
      importing: false,
      message: 'Load a character to replace artwork.',
    });
  }

  dispose(): void {
    this.unbind();
    this.listeners.clear();
  }
}
