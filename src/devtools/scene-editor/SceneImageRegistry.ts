import { inspectImageHeader, sceneImageReferenceSchema } from '../../engine/core.js';
import { createSceneTextureBudget } from '../../engine/runtime.js';
import { importSprite } from '../shared/artwork/spriteImport.js';
import { Subscribers } from '../shared/subscriberNotifications.js';

export interface SceneImageAsset {
  readonly reference: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** Binary ownership shared by scenes and project packaging. No URL enters authored data. */
export class SceneImageRegistry {
  private readonly assets = new Map<string, SceneImageAsset & { bytes: Uint8Array<ArrayBuffer> }>();
  private readonly subscribers = new Subscribers({ label: 'Scene image subscribers failed.' });
  readonly subscribe = this.subscribers.subscribe;
  readonly getSnapshot = this.subscribers.getSnapshot;
  private notify(): void {
    this.subscribers.notify();
  }
  get entries(): readonly SceneImageAsset[] {
    return [...this.assets.values()].map(({ bytes: _bytes, ...asset }) => asset);
  }
  has(reference: string): boolean {
    return this.assets.has(reference);
  }
  read(reference: string): Uint8Array<ArrayBuffer> {
    const asset = this.assets.get(reference);
    if (!asset) throw new Error(`Missing image "${reference}". Import or replace this image before exporting.`);
    return new Uint8Array(asset.bytes);
  }
  /** Package bytes have already passed the package boundary; validate headers and collisions again. */
  register(reference: string, bytes: Uint8Array<ArrayBuffer>, name = reference.split('/').at(-1)!): void {
    sceneImageReferenceSchema.parse(reference);
    const budget = createSceneTextureBudget();
    for (const [key, asset] of this.assets) budget.checkImage(key, asset.bytes);
    budget.checkImage(reference, bytes);
    const header = inspectImageHeader(bytes)!;
    if (!reference.toLowerCase().endsWith(header.format === 'image/png' ? '.png' : '.webp'))
      throw new Error('Image extension must match its content.');
    const previous = this.assets.get(reference);
    if (previous) {
      if (previous.bytes.length !== bytes.length || !previous.bytes.every((byte, index) => byte === bytes[index]))
        throw new Error(`Image path collision at "${reference}".`);
      return;
    }
    if ([...this.assets.keys()].some((key) => key.toLowerCase() === reference.toLowerCase()))
      throw new Error(`Image path collision at "${reference}".`);
    this.assets.set(reference, {
      reference,
      name: name.trim().slice(0, 200) || 'Image',
      width: header.width,
      height: header.height,
      bytes: new Uint8Array(bytes),
    });
    this.notify();
  }
  registerAll(images: ReadonlyMap<string, Uint8Array<ArrayBuffer>>): void {
    const proposal = new SceneImageRegistry();
    for (const asset of this.assets.values()) proposal.register(asset.reference, asset.bytes, asset.name);
    for (const [reference, bytes] of images) proposal.register(reference, bytes);
    for (const [reference, bytes] of images) this.register(reference, bytes);
  }
  async add(bytes: Uint8Array<ArrayBuffer>, name: string, signal?: AbortSignal): Promise<string> {
    const header = inspectImageHeader(bytes);
    if (!header) throw new Error('Choose a PNG or static WebP image.');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    signal?.throwIfAborted();
    // Equal content imported from a character package or local file shares one binary.
    const existing = [...this.assets.values()].find(
      (asset) => asset.bytes.length === bytes.length && asset.bytes.every((byte, index) => byte === bytes[index]),
    );
    if (existing) return existing.reference;
    const reference = `../images/${digest}.${header.format === 'image/png' ? 'png' : 'webp'}`;
    this.register(reference, bytes, name);
    return reference;
  }
  async import(file: File, signal: AbortSignal): Promise<string> {
    const sprite = await importSprite(file, signal);
    try {
      return await this.add(new Uint8Array(await sprite.blob.arrayBuffer()), file.name, signal);
    } finally {
      sprite.dispose();
    }
  }
  removeUnused(retained: ReadonlySet<string>): number {
    let count = 0;
    for (const reference of this.assets.keys()) {
      if (!retained.has(reference)) {
        this.assets.delete(reference);
        count++;
      }
    }
    if (count) this.notify();
    return count;
  }
}
