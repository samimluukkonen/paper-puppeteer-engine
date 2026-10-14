import type Phaser from 'phaser';
import type { CharacterDefinition } from '../../../engine/CharacterDefinition.js';
import { DEFAULT_CHARACTER_TEXTURE_LIMITS as limits } from '../../../engine/characterTextureLimits.js';
import type { Puppet } from '../../../engine/Puppet.js';
import { assetFilename } from '../assetFilename.js';
import { importSprite, type ImportedSprite, type SpriteMetadata } from './spriteImport.js';

export interface ArtworkTarget {
  readonly key: string;
  readonly filename: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly references: readonly string[];
  readonly reason: string | null;
}

interface SpriteResource {
  readonly sprite: ImportedSprite;
  key: string | null;
  texture: Phaser.Textures.Texture | null;
}

export interface ArtworkSnapshot {
  readonly targets: readonly ArtworkTarget[];
  readonly selectedKey: string | null;
  readonly proposed: (SpriteMetadata & { readonly url: string }) | null;
  readonly applied: (SpriteMetadata & { readonly url: string }) | null;
  readonly pendingCount: number;
  readonly previewing: boolean;
  readonly importing: boolean;
  readonly message: string;
}

let nextNamespace = 0;

/** Session-local binary working copy. Nothing here participates in rig/animation serialization or history. */
export class ArtworkController {
  private puppet: Puppet | undefined;
  private textures: Phaser.Textures.TextureManager | undefined;
  private refreshAppearance: () => void = () => {};
  private readonly listeners = new Set<() => void>();
  private readonly applied = new Map<string, SpriteResource>();
  private candidate: SpriteResource | undefined;
  private request: AbortController | undefined;
  private readonly namespace = `__paper_artwork_${++nextNamespace}_`;
  private serial = 0;
  private snapshot: ArtworkSnapshot = {
    targets: [],
    selectedKey: null,
    proposed: null,
    applied: null,
    pendingCount: 0,
    previewing: false,
    importing: false,
    message: 'Load a character to replace artwork.',
  };

  constructor(private readonly decode: typeof importSprite = importSprite) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): ArtworkSnapshot => this.snapshot;
  get hasUnsavedChanges(): boolean {
    return this.applied.size > 0;
  }
  assetPreview(key: string): { url: string; filename: string; imported: boolean } | undefined {
    const target = this.snapshot.targets.find((entry) => entry.key === key);
    const imported = this.applied.get(key)?.sprite;
    return imported
      ? { url: imported.url, filename: imported.filename, imported: true }
      : target
        ? { url: target.url, filename: target.filename, imported: false }
        : undefined;
  }

  private publish(update: Partial<ArtworkSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }

  /** Rebind after rig reload; original Phaser keys remain loaded and authored files remain unchanged. */
  bind(
    scene: Phaser.Scene,
    puppet: Puppet,
    definition: CharacterDefinition,
    refreshAppearance: () => void = () => {},
  ): void {
    if (this.puppet === puppet) return;
    this.cancel();
    if (this.textures && this.textures !== scene.textures) this.unbind();
    this.puppet = puppet;
    this.textures = scene.textures;
    this.refreshAppearance = refreshAppearance;
    const references = new Map<string, string[]>(Object.keys(definition.textures).map((key) => [key, []]));
    const framed = new Set<string>();
    const add = (sprite: { texture: string; frame?: string | number }, label: string): void => {
      const entries = references.get(sprite.texture) ?? [];
      entries.push(label);
      references.set(sprite.texture, entries);
      if (sprite.frame !== undefined && sprite.frame !== '__BASE') framed.add(sprite.texture);
    };
    for (const bone of puppet.rig.bones) if (bone.sprite) add(bone.sprite, `Bone: ${bone.id}`);
    for (const attachment of puppet.rig.attachments) {
      add(attachment, `Attachment: ${attachment.id}`);
      for (const slot of puppet.rig.slots)
        if (puppet.rig.skins.some((skin) => skin.slots[slot.id] === attachment.id)) add(attachment, `Slot: ${slot.id}`);
      for (const skin of puppet.rig.skins)
        if (Object.values(skin.slots).includes(attachment.id)) add(attachment, `Skin: ${skin.name}`);
    }
    const targets: ArtworkTarget[] = [];
    for (const [key, entries] of references) {
      const texture = scene.textures.get(key);
      const frame = texture.get();
      const source = texture.getSourceImage();
      const url = Object.hasOwn(definition.textures, key)
        ? definition.textureUrl(key)
        : 'src' in source
          ? source.src
          : '';
      targets.push({
        key,
        filename: assetFilename(definition.textures[key], key),
        url,
        width: frame.width,
        height: frame.height,
        references: [...new Set(entries)],
        reason: framed.has(key) ? 'Atlas/frame replacement is deferred. Choose a whole-image asset.' : null,
      });
    }
    // Imported rigs may stop referring to a pending asset; keep it selectable for reversion.
    for (const previous of this.snapshot.targets)
      if (this.applied.has(previous.key) && !references.has(previous.key))
        targets.push({ ...previous, references: [] });
    for (const [key, resource] of this.applied) puppet.setArtworkTexture(key, resource.key!);
    this.refreshAppearance();
    const selectedKey = targets.some((target) => target.key === this.snapshot.selectedKey)
      ? this.snapshot.selectedKey
      : (targets[0]?.key ?? null);
    this.publish({
      targets,
      selectedKey,
      applied: this.applied.get(selectedKey ?? '')?.sprite ?? null,
      pendingCount: this.applied.size,
      message: 'Choose an artwork asset and import a PNG or WebP.',
    });
  }

  select(key: string): void {
    if (!this.snapshot.targets.some((target) => target.key === key) || key === this.snapshot.selectedKey) return;
    this.cancel();
    this.publish({
      selectedKey: key,
      applied: this.applied.get(key)?.sprite ?? null,
      message: 'Ready to import a replacement.',
    });
  }

  async import(file: File): Promise<void> {
    this.cancel();
    const key = this.snapshot.selectedKey;
    const target = this.snapshot.targets.find((entry) => entry.key === key);
    if (!target || !this.puppet || target.reason) {
      this.publish({ message: target?.reason ?? 'Load a character and choose an artwork asset first.' });
      return;
    }
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
      const resources = [...this.applied.values()].map((entry) => entry.sprite);
      if (
        resources.reduce((sum, entry) => sum + entry.bytes, sprite.bytes) > limits.maxTotalImageBytes ||
        resources.reduce((sum, entry) => sum + entry.width * entry.height, sprite.width * sprite.height) >
          limits.maxTotalImagePixels
      )
        throw new Error(
          'Pending artwork exceeds the session budget (50 MiB or 64 megapixels). Revert an applied replacement first.',
        );
      this.candidate = { sprite, key: null, texture: null };
      this.publish({
        proposed: sprite,
        importing: false,
        message: 'Image ready. Preview it on the character before applying.',
      });
    } catch (error) {
      sprite?.dispose();
      if (!request.signal.aborted && this.request === request)
        this.publish({ importing: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }

  preview(): void {
    const candidate = this.candidate;
    const key = this.snapshot.selectedKey;
    if (!candidate || !key || !this.puppet || !this.textures) return;
    try {
      if (!candidate.key) {
        let textureKey: string;
        do {
          textureKey = `${this.namespace}${++this.serial}`;
        } while (this.textures.exists(textureKey));
        const texture = this.textures.addImage(textureKey, candidate.sprite.image);
        if (!texture) throw new Error('Phaser could not create the replacement texture. Try a smaller PNG.');
        candidate.key = textureKey;
        candidate.texture = texture;
      }
      this.puppet.setArtworkTexture(key, candidate.key);
      this.refreshAppearance();
      this.publish({
        previewing: true,
        message: 'Preview only. Apply to keep this pending artwork change, or Cancel to restore.',
      });
    } catch (error) {
      // Keep the previous applied/original appearance usable even if texture installation fails.
      this.puppet.setArtworkTexture(key, this.applied.get(key)?.key ?? undefined);
      this.refreshAppearance();
      this.publish({ previewing: false, message: error instanceof Error ? error.message : String(error) });
    }
  }

  apply(): void {
    const key = this.snapshot.selectedKey;
    if (!key || !this.candidate || !this.snapshot.previewing) return;
    const previous = this.applied.get(key);
    this.applied.set(key, this.candidate);
    const sprite = this.candidate.sprite;
    this.candidate = undefined;
    if (previous) this.release(previous);
    this.publish({
      proposed: null,
      applied: sprite,
      previewing: false,
      pendingCount: this.applied.size,
      message: 'Replacement applied as a pending session asset change. Source files have not been written.',
    });
  }

  cancel(): void {
    this.request?.abort();
    this.request = undefined;
    if (this.snapshot.previewing && this.snapshot.selectedKey) {
      this.puppet?.setArtworkTexture(
        this.snapshot.selectedKey,
        this.applied.get(this.snapshot.selectedKey)?.key ?? undefined,
      );
      this.refreshAppearance();
    }
    if (this.candidate) this.release(this.candidate);
    this.candidate = undefined;
    this.publish({
      proposed: null,
      previewing: false,
      importing: false,
      message: 'Replacement cancelled. Previous artwork restored.',
    });
  }

  revert(): void {
    this.cancel();
    const key = this.snapshot.selectedKey;
    const resource = key ? this.applied.get(key) : undefined;
    if (!key || !resource) return;
    this.puppet?.setArtworkTexture(key);
    this.refreshAppearance();
    this.applied.delete(key);
    this.release(resource);
    this.publish({ applied: null, pendingCount: this.applied.size, message: 'Original artwork restored.' });
  }

  private release(resource: SpriteResource): void {
    // Only remove the exact texture this controller created, never a host-owned key.
    if (
      resource.key &&
      resource.texture &&
      this.textures?.exists(resource.key) &&
      this.textures.get(resource.key) === resource.texture
    )
      this.textures.remove(resource.key);
    resource.sprite.dispose();
  }

  unbind(): void {
    this.cancel();
    for (const key of this.applied.keys()) this.puppet?.setArtworkTexture(key);
    this.refreshAppearance();
    for (const resource of this.applied.values()) this.release(resource);
    this.applied.clear();
    this.puppet = undefined;
    this.textures = undefined;
    this.refreshAppearance = () => {};
    this.publish({
      targets: [],
      selectedKey: null,
      applied: null,
      pendingCount: 0,
      message: 'Load a character to replace artwork.',
    });
  }

  dispose(): void {
    this.unbind();
    this.listeners.clear();
  }
}
