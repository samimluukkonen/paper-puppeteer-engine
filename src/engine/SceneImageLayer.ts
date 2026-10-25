import type Phaser from 'phaser';
import { abortable } from './abortable.js';
import type { CharacterTextureBudget } from './characterTextureLimits.js';
import { decodeImage } from './decodeImage.js';
import type { DeepReadonly } from './readonlyData.js';
import type { SceneImageDefinition, SceneLayerDefinition } from './SceneDefinition.js';
import { parallaxPosition, sceneImageDepth, sceneLayer } from './sceneLayers.js';
import { createSceneTextureBudget } from './sceneTextureBudget.js';

let layerSerial = 0;
interface TextureLease {
  key: string;
  controller: AbortController;
  dispose?: () => void;
}
interface ImageRequest {
  controller: AbortController;
  promise: Promise<void>;
}

/** Owns only its private textures and independent image objects. Actors never enter this layer. */
export class SceneImageLayer {
  readonly objects = new Map<string, Phaser.GameObjects.Image>();
  private readonly textures = new Map<string, TextureLease>();
  private readonly pending = new Map<string, ImageRequest>();
  private readonly failures = new Map<string, string>();
  private elements: readonly DeepReadonly<SceneImageDefinition>[] = [];
  private layers: readonly DeepReadonly<SceneLayerDefinition>[] | undefined;
  private cinematicScroll: { x: number; y: number } | undefined;
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
  sync(
    elements: readonly DeepReadonly<SceneImageDefinition>[] = [],
    layers?: readonly DeepReadonly<SceneLayerDefinition>[],
    cinematicScroll?: { x: number; y: number },
  ): void {
    if (!this.alive) return;
    this.elements = elements;
    this.layers = layers;
    this.cinematicScroll = cinematicScroll;
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
    for (const [reference, request] of this.pending)
      if (!references.has(reference)) {
        // Invalidate before aborting: a restored reference owns a fresh request.
        this.pending.delete(reference);
        request.controller.abort();
      }
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
        const layer = sceneLayer({ layers }, element.layerId);
        const position = cinematicScroll
          ? parallaxPosition(element.position, layer.parallax, cinematicScroll)
          : element.position;
        object.scrollFactorX = object.scrollFactorY = cinematicScroll ? 1 : layer.parallax;
        if (object.texture.key !== lease.key) object.setTexture(lease.key);
        object
          .setPosition(position.x, position.y)
          .setScale(element.scale.x, element.scale.y)
          .setVisible(element.visible && layer.visible)
          .setAlpha(element.opacity ?? 1);
        // Camera sampling changes presentation every frame. Phaser queues a full
        // display-list sort even when setDepth receives the existing depth.
        const depth = sceneImageDepth({ layers }, element, index);
        if (object.depth !== depth) object.setDepth(depth);
      } else if (!this.pending.has(element.image) && !this.failures.has(element.image)) {
        // Store the request before it can complete and trigger a reconciliation.
        const controller = new AbortController();
        const request: ImageRequest = {
          controller,
          promise: Promise.resolve()
            .then(() => this.prepare(element.image, controller))
            .catch((error: unknown) => {
              if (this.alive && this.pending.get(element.image) === request)
                this.failures.set(
                  element.image,
                  `${element.image}: ${error instanceof Error ? error.message : String(error)}`,
                );
            })
            .finally(() => {
              if (this.pending.get(element.image) !== request) return;
              this.pending.delete(element.image);
              if (this.alive) {
                this.sync(this.elements, this.layers, this.cinematicScroll);
                this.changed([...this.failures.values()].join('\n'));
              }
            }),
        };
        this.pending.set(element.image, request);
      }
    }
  }
  private async prepare(reference: string, controller: AbortController): Promise<void> {
    controller.signal.throwIfAborted();
    const bytes = await abortable(this.load(reference), controller.signal);
    controller.signal.throwIfAborted();
    if (!this.alive || !this.elements.some((image) => image.image === reference)) return;
    const budget = createSceneTextureBudget();
    budget.checkImage(reference, bytes);
    const key = `${this.prefix}${++this.serial}`;
    const lease: TextureLease = { key, controller };
    this.textures.set(reference, lease);
    try {
      // Charge actual allocations, including independent layers using the same reference.
      this.sharedBudget?.checkImage(key, bytes);
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
    await Promise.all([...this.pending.values()].map((request) => request.promise));
    if (this.failures.size) throw new Error([...this.failures.values()].join('\n'));
  }
  retry(): void {
    this.failures.clear();
    this.sync(this.elements, this.layers, this.cinematicScroll);
  }
  private release(reference: string, lease: TextureLease): void {
    this.textures.delete(reference);
    lease.controller.abort();
    try {
      if (this.scene.textures.exists(lease.key)) this.scene.textures.remove(lease.key);
    } finally {
      this.sharedBudget?.release(lease.key);
      lease.dispose?.();
    }
  }
  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const object of this.objects.values()) object.destroy();
    this.objects.clear();
    for (const [reference, lease] of this.textures) this.release(reference, lease);
    for (const request of this.pending.values()) request.controller.abort();
    this.pending.clear();
    this.failures.clear();
    this.elements = [];
    this.layers = undefined;
    this.cinematicScroll = undefined;
  }
}
