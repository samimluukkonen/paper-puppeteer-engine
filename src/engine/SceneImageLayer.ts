import type Phaser from 'phaser';
import type { CharacterTextureBudget } from './characterTextureLimits.js';
import { decodeImage } from './decodeImage.js';
import type { DeepReadonly } from './readonlyData.js';
import type { SceneImageDefinition } from './SceneDefinition.js';
import { createSceneTextureBudget } from './sceneTextureBudget.js';

let layerSerial = 0;
interface TextureLease {
  key: string;
  controller: AbortController;
  dispose?: () => void;
}

/** Owns only its private textures and independent image objects. Actors never enter this layer. */
export class SceneImageLayer {
  readonly objects = new Map<string, Phaser.GameObjects.Image>();
  private readonly textures = new Map<string, TextureLease>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, string>();
  private elements: readonly DeepReadonly<SceneImageDefinition>[] = [];
  private alive = true;
  private readonly prefix = `scene_artwork_${++layerSerial}_`;
  private serial = 0;
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly load: (reference: string) => Promise<Uint8Array<ArrayBuffer>>,
    private readonly changed: (error: string) => void = () => {},
    private readonly sharedBudget?: CharacterTextureBudget,
  ) {}
  get error(): string {
    return [...this.failures.values()].join('\n');
  }
  sync(elements: readonly DeepReadonly<SceneImageDefinition>[] = []): void {
    if (!this.alive) return;
    this.elements = elements;
    const ids = new Set(elements.map((element) => element.id));
    for (const [id, object] of this.objects)
      if (!ids.has(id)) {
        object.destroy();
        this.objects.delete(id);
      }
    // Destroy consumers before releasing or switching their textures.
    for (const element of elements) {
      const object = this.objects.get(element.id);
      if (object && object.texture.key !== this.textures.get(element.image)?.key) {
        object.destroy();
        this.objects.delete(element.id);
      }
    }
    const references = new Set(elements.map((element) => element.image));
    for (const reference of this.failures.keys()) if (!references.has(reference)) this.failures.delete(reference);
    for (const [reference, lease] of this.textures) if (!references.has(reference)) this.release(reference, lease);
    for (const [index, element] of elements.entries()) {
      const lease = this.textures.get(element.image);
      if (lease && !this.pending.has(element.image) && this.scene.textures.exists(lease.key)) {
        let object = this.objects.get(element.id);
        if (!object) {
          object = this.scene.add.image(0, 0, lease.key);
          this.objects.set(element.id, object);
        }
        object
          .setTexture(lease.key)
          .setPosition(element.position.x, element.position.y)
          .setScale(element.scale.x, element.scale.y)
          .setVisible(element.visible)
          .setAlpha(element.opacity ?? 1)
          .setDepth(-100 + (element.order + index / 257) / 256);
      } else if (!this.pending.has(element.image) && !this.failures.has(element.image)) {
        // Store the request before it can complete and trigger a reconciliation.
        const request = Promise.resolve()
          .then(() => this.prepare(element.image))
          .catch((error: unknown) => {
            if (this.alive && this.elements.some((image) => image.image === element.image))
              this.failures.set(
                element.image,
                `${element.image}: ${error instanceof Error ? error.message : String(error)}`,
              );
          })
          .finally(() => {
            if (this.pending.get(element.image) !== request) return;
            this.pending.delete(element.image);
            if (this.alive) {
              this.sync(this.elements);
              this.changed([...this.failures.values()].join('\n'));
            }
          });
        this.pending.set(element.image, request);
      }
    }
  }
  private async prepare(reference: string): Promise<void> {
    const bytes = await this.load(reference);
    if (!this.alive || !this.elements.some((image) => image.image === reference)) return;
    const budget = createSceneTextureBudget();
    budget.checkImage(reference, bytes);
    this.sharedBudget?.checkImage(`image:${reference}`, bytes);
    const key = `${this.prefix}${++this.serial}`;
    const controller = new AbortController();
    const lease: TextureLease = { key, controller };
    this.textures.set(reference, lease);
    try {
      const decoded = await decodeImage(bytes, controller.signal);
      lease.dispose = decoded.dispose;
      if (!this.alive || this.textures.get(reference) !== lease) {
        decoded.dispose();
        return;
      }
      if (!this.scene.textures.addImage(key, decoded.image)) throw new Error('Could not create scene image texture.');
    } catch (error) {
      if (this.textures.get(reference) === lease) this.release(reference, lease);
      throw error;
    }
  }
  async ready(): Promise<void> {
    await Promise.all(this.pending.values());
    if (this.failures.size) throw new Error([...this.failures.values()].join('\n'));
  }
  retry(): void {
    this.failures.clear();
    this.sync(this.elements);
  }
  private release(reference: string, lease: TextureLease): void {
    this.textures.delete(reference);
    lease.controller.abort();
    try {
      if (this.scene.textures.exists(lease.key)) this.scene.textures.remove(lease.key);
    } finally {
      lease.dispose?.();
    }
  }
  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const object of this.objects.values()) object.destroy();
    this.objects.clear();
    for (const [reference, lease] of this.textures) this.release(reference, lease);
    this.pending.clear();
    this.failures.clear();
    this.elements = [];
  }
}
