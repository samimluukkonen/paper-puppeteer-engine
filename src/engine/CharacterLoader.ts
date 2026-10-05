import { type CharacterData, CharacterDefinition, characterManifestSchema } from './CharacterDefinition.js';

export interface CharacterLoadOptions {
  /** Cancel all metadata requests belonging to this load. Custom fetchers must honor RequestInit.signal. */
  signal?: AbortSignal;
}

/** Fetches only JSON metadata. Image decoding/loading belongs to Phaser or the host. */
export const CharacterLoader = {
  async load(
    url: string,
    fetcher: typeof fetch = fetch,
    options: CharacterLoadOptions = {},
  ): Promise<CharacterDefinition> {
    const controller = new AbortController();
    const { signal } = options;
    const onAbort = (): void => controller.abort(signal!.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      signal?.throwIfAborted();
      const manifestUrl = new URL(url, globalThis.location?.href).href;
      const read = async (path: string): Promise<unknown> => {
        controller.signal.throwIfAborted();
        const resourceUrl = new URL(path, manifestUrl).href;
        const response = await fetcher(resourceUrl, { signal: controller.signal });
        controller.signal.throwIfAborted();
        if (!response.ok) throw new Error(`Could not load character JSON "${resourceUrl}" (${response.status}).`);
        const data: unknown = await response.json();
        controller.signal.throwIfAborted();
        return data;
      };
      const manifestData = await read(manifestUrl);
      const manifest = characterManifestSchema.parse(manifestData);
      const paths = [manifest.rig, ...Object.values(manifest.skins), ...manifest.animations, ...(manifest.poses ?? [])];
      const entries = await Promise.all([...new Set(paths)].map(async (path) => [path, await read(path)] as const));
      const files = Object.fromEntries(entries);
      const data: CharacterData = {
        manifest: manifestData,
        rig: files[manifest.rig],
        skins: files,
        animations: files,
        poses: files,
      };
      return CharacterDefinition.fromData(data, manifestUrl);
    } catch (error) {
      // Promise.all rejects before sibling requests finish; keep the original failure while canceling them.
      controller.abort(error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  },
};
