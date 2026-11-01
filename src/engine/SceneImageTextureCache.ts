import type Phaser from 'phaser';
import { abortable } from './abortable.js';
import { decodeImage } from './decodeImage.js';
import { packageContentDigest } from './StoryPackage.js';

let serial = 0;
/** Content-shared GPU artwork, leased by prepared scenes and image-layer consumers. */
export class SceneImageTextureCache {
  private readonly entries = new Map<
    string,
    { count: number; pending: Promise<{ key: string; dispose: () => void }> }
  >();
  private readonly lifetime = new AbortController();
  constructor(private readonly scene: Phaser.Scene) {}
  async acquire(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<{ key: string; dispose: () => void }> {
    this.lifetime.signal.throwIfAborted();
    const digest = await packageContentDigest(bytes);
    signal.throwIfAborted();
    this.lifetime.signal.throwIfAborted();
    let entry = this.entries.get(digest);
    if (!entry) {
      const pending = (async () => {
        const decoded = await decodeImage(bytes, this.lifetime.signal);
        const key = `story_image_${++serial}`;
        try {
          this.lifetime.signal.throwIfAborted();
          if (!this.scene.textures.addImage(key, decoded.image))
            throw new Error('Could not create shared story image texture.');
          return {
            key,
            dispose: () => {
              try {
                if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
              } finally {
                decoded.dispose();
              }
            },
          };
        } catch (error) {
          decoded.dispose();
          throw error;
        }
      })();
      entry = { count: 0, pending };
      this.entries.set(digest, entry);
    }
    const lease = entry;
    lease.count++;
    let released = false;
    const dispose = (): void => {
      if (released) return;
      released = true;
      if (--lease.count === 0 && this.entries.get(digest) === lease) {
        this.entries.delete(digest);
        void lease.pending.then(
          (resource) => resource.dispose(),
          () => {},
        );
      }
    };
    try {
      const resource = await abortable(lease.pending, signal);
      this.lifetime.signal.throwIfAborted();
      return { key: resource.key, dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }
  dispose(): void {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    for (const entry of this.entries.values())
      void entry.pending.then(
        (resource) => resource.dispose(),
        () => {},
      );
    this.entries.clear();
  }
}
