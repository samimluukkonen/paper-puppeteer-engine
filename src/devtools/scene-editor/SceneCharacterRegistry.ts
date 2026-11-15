import { CharacterLoader, sceneCharacterAssetPath, sceneCharacterReferenceSchema } from '../../engine/core.js';
import type { CharacterDefinition } from '../../engine/data.js';
import { characterCatalog } from '../../shared/characterCatalog.js';
import { notifySubscribers } from '../shared/subscriberNotifications.js';

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
  private readonly listeners = new Set<() => void>();
  private revision = 0;
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

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): number => this.revision;
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
        this.revision++;
        notifySubscribers(this.listeners, 'Scene character subscribers failed.');
        return definition;
      })
      .finally(() => this.pending.delete(manifest));
    this.pending.set(manifest, request);
    return request;
  }
  dispose(): void {
    this.lifetime.abort();
    this.listeners.clear();
    this.definitions.clear();
    this.pending.clear();
  }
}
