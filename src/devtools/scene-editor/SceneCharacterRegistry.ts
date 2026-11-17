import { CharacterLoader, sceneCharacterAssetPath, sceneCharacterReferenceSchema } from '../../engine/core.js';
import type { CharacterDefinition } from '../../engine/data.js';
import { characterCatalog } from '../../shared/characterCatalog.js';
import { Subscribers } from '../shared/subscriberNotifications.js';

/** Permanent package references use the same catalog and manifest convention as the character editors. */
export const sceneCharacterChoices = characterCatalog.map((entry) => ({
  ...entry,
  manifest: `../characters/${encodeURIComponent(entry.id)}/character.json`,
}));

/** Cache immutable definitions, never live Puppets. A page owns and cancels its metadata requests. */
export class SceneCharacterRegistry {
  private readonly definitions = new Map<string, CharacterDefinition>();
  private readonly pending = new Map<string, Promise<CharacterDefinition>>();
  private readonly lifetime = new AbortController();
  private readonly subscribers = new Subscribers({ label: 'Scene character subscribers failed.' });
  constructor(
    private readonly loadDefinition = (manifest: string, signal: AbortSignal) => {
      const url = new URL(manifest, globalThis.location?.href);
      return CharacterLoader.load(url.href, fetch, {
        signal,
        pathPolicy: (path) => {
          sceneCharacterAssetPath(path);
        },
        urlPolicy: (resource) => resource.origin === url.origin && !resource.search && !resource.hash,
      });
    },
  ) {}

  readonly subscribe = this.subscribers.subscribe;
  readonly getSnapshot = this.subscribers.getSnapshot;
  get(manifest: string): CharacterDefinition | undefined {
    return this.definitions.get(manifest);
  }
  load(manifest: string): Promise<CharacterDefinition> {
    const cached = this.get(manifest);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(manifest);
    if (pending) return pending;
    const request = Promise.resolve()
      .then(async () => {
        this.lifetime.signal.throwIfAborted();
        sceneCharacterReferenceSchema.parse({ manifest });
        const definition = await this.loadDefinition(manifest, this.lifetime.signal);
        this.lifetime.signal.throwIfAborted();
        this.definitions.set(manifest, definition);
        this.subscribers.notify();
        return definition;
      })
      .finally(() => this.pending.delete(manifest));
    this.pending.set(manifest, request);
    return request;
  }
  dispose(): void {
    this.lifetime.abort();
    this.subscribers.clear();
    this.definitions.clear();
    this.pending.clear();
  }
}
