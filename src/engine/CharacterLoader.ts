import { type CharacterData, CharacterDefinition, characterManifestSchema } from './CharacterDefinition.js';
import { DEFAULT_MAX_JSON_BYTES, JsonInputLimitError, readJsonResponse, validateInputLimit } from './jsonInput.js';

export const DEFAULT_CHARACTER_LOAD_LIMITS = Object.freeze({
  maxJsonBytes: DEFAULT_MAX_JSON_BYTES,
  maxTotalJsonBytes: 50 * 1024 * 1024,
  maxResources: 256,
  concurrency: 6,
});

export interface CharacterLoadOptions {
  /** Cancel all metadata requests belonging to this load. Custom fetchers must honor RequestInit.signal. */
  signal?: AbortSignal;
  /** Maximum decoded bytes per JSON response. Defaults to 10 MiB. */
  maxJsonBytes?: number;
  /** Maximum decoded JSON bytes across the entire character load. Defaults to 50 MiB. */
  maxTotalJsonBytes?: number;
  /** Maximum manifest, unique metadata files and texture entries combined. Defaults to 256. */
  maxResources?: number;
  /** Maximum simultaneous metadata requests. Defaults to 6. */
  concurrency?: number;
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
      const limits = {
        maxJsonBytes: validateInputLimit(
          options.maxJsonBytes ?? DEFAULT_CHARACTER_LOAD_LIMITS.maxJsonBytes,
          'maxJsonBytes',
        ),
        maxTotalJsonBytes: validateInputLimit(
          options.maxTotalJsonBytes ?? DEFAULT_CHARACTER_LOAD_LIMITS.maxTotalJsonBytes,
          'maxTotalJsonBytes',
        ),
        maxResources: validateInputLimit(
          options.maxResources ?? DEFAULT_CHARACTER_LOAD_LIMITS.maxResources,
          'maxResources',
        ),
        concurrency: validateInputLimit(
          options.concurrency ?? DEFAULT_CHARACTER_LOAD_LIMITS.concurrency,
          'concurrency',
        ),
      };
      let totalBytes = 0;
      const countBytes = (bytes: number): void => {
        totalBytes += bytes;
        if (totalBytes > limits.maxTotalJsonBytes)
          throw new JsonInputLimitError(
            `Character JSON exceeds the ${limits.maxTotalJsonBytes}-byte total size limit.`,
          );
      };
      const requestedUrl = new URL(url, globalThis.location?.href).href;
      const read = async (resourceUrl: string): Promise<{ data: unknown; url: string }> => {
        controller.signal.throwIfAborted();
        try {
          const response = await fetcher(resourceUrl, { signal: controller.signal });
          controller.signal.throwIfAborted();
          if (!response.ok) throw new Error(`Could not load character JSON "${resourceUrl}" (${response.status}).`);
          const data = await readJsonResponse(response, limits.maxJsonBytes, controller.signal, countBytes);
          return { data, url: response.url || resourceUrl };
        } catch (error) {
          // Stop workers before they acquire another resource after a sibling fails.
          controller.abort(error);
          throw error;
        }
      };
      const { data: manifestData, url: manifestUrl } = await read(requestedUrl);
      const manifest = characterManifestSchema.parse(manifestData);
      const paths = [
        ...new Set([manifest.rig, ...Object.values(manifest.skins), ...manifest.animations, ...(manifest.poses ?? [])]),
      ];
      if (1 + paths.length + Object.keys(manifest.textures).length > limits.maxResources)
        throw new JsonInputLimitError(`Character exceeds the ${limits.maxResources}-resource limit.`);
      const entries: (readonly [string, unknown])[] = [];
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(limits.concurrency, paths.length) }, async () => {
          while (next < paths.length) {
            controller.signal.throwIfAborted();
            const index = next++;
            const path = paths[index]!;
            entries[index] = [path, (await read(new URL(path, manifestUrl).href)).data];
          }
        }),
      );
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
      // Keep the original failure while canceling any pending workers.
      controller.abort(error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  },
};
