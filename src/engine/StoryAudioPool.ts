import { AudioAssetLoader, type AudioBackend, type DecodedAudioResource } from './AudioAssetLoader.js';

/** One context and content decoder; each prepared/active scene owns an independent lease.
 * Voices remain scene-owned. Decoded data survives only while current/next leases need it. */
export class StoryAudioPool {
  private readonly loader: AudioAssetLoader;
  private readonly references = new Map<DecodedAudioResource, number>();
  private pending = 0;
  private closed = false;
  constructor(backend?: AudioBackend) {
    this.loader = new AudioAssetLoader(() => undefined, backend);
  }
  lease(): AudioBackend {
    if (this.closed) throw new Error('Story audio pool disposed.');
    const running = () => this.loader.running;
    let disposed = false;
    const resources = new Set<DecodedAudioResource>();
    const releaseUnused = (): void => {
      if (this.pending) return;
      for (const [resource, count] of this.references)
        if (!count) {
          this.references.delete(resource);
          this.loader.evict(resource);
        }
    };
    return {
      get running() {
        return running();
      },
      resume: () => this.loader.unlock(),
      decode: async (bytes, _budget, signal) => {
        if (disposed || this.closed) throw new Error('Story audio lease disposed.');
        this.pending++;
        try {
          const resource = await this.loader.prepare(bytes, signal);
          this.references.set(resource, (this.references.get(resource) ?? 0) + 1);
          let released = false;
          const wrapper: DecodedAudioResource = {
            durationSeconds: resource.durationSeconds,
            byteLength: resource.byteLength,
            play: (volume, ended) => resource.play(volume, ended),
            ...(resource.playTimeline ? { playTimeline: (options) => resource.playTimeline!(options) } : {}),
            dispose: () => {
              if (released) return;
              released = true;
              resources.delete(wrapper);
              this.references.set(resource, (this.references.get(resource) ?? 1) - 1);
              releaseUnused();
            },
          };
          resources.add(wrapper);
          if (disposed || this.closed || signal?.aborted) {
            wrapper.dispose();
            throw new Error('Story audio preparation cancelled.');
          }
          return wrapper;
        } finally {
          this.pending--;
          releaseUnused();
        }
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        for (const resource of resources) resource.dispose();
      },
    };
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.references.clear();
    this.loader.dispose();
  }
}
