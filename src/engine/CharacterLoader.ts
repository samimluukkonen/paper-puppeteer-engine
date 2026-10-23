import { type CharacterData, CharacterDefinition, characterManifestSchema } from './CharacterDefinition.js';
import { DEFAULT_MAX_JSON_BYTES, JsonInputLimitError, readJsonResponse, validateInputLimit } from './jsonInput.js';
import { JsonWorkloadBudget, type JsonWorkloadLimitOptions } from './jsonWorkloadLimits.js';
import { withResourceResponse } from './resourceInput.js';

export const DEFAULT_CHARACTER_LOAD_LIMITS = Object.freeze({
  maxJsonBytes: DEFAULT_MAX_JSON_BYTES,
  maxTotalJsonBytes: 50 * 1024 * 1024,
  maxResources: 256,
  concurrency: 6,
  timeoutMs: 30_000,
});

export interface CharacterLoadOptions extends JsonWorkloadLimitOptions {
  /** Cancel all metadata requests belonging to this load. Custom fetchers must honor RequestInit.signal. */
  signal?: AbortSignal;
  /** Maximum decoded bytes per JSON response. Defaults to 10 MiB. */
  maxJsonBytes?: number;
  /** Maximum decoded JSON bytes across the entire character load. Defaults to 50 MiB. */
  maxTotalJsonBytes?: number;
  /** Maximum manifest, metadata references and texture entries combined. Defaults to 256. */
  maxResources?: number;
  /** Maximum simultaneous metadata requests. Defaults to 6. */
  concurrency?: number;
  /** Timeout for each metadata request, including its body. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Approve every resolved metadata/artwork URL. When supplied, metadata redirects are disabled.
   * Custom fetchers must honor RequestInit.redirect; DNS/network restrictions belong to the host.
   */
  urlPolicy?: (url: URL) => boolean;
  /** Inspect each authored metadata/artwork path before URL normalization. Throw to reject it.
   * Package loaders use this to reject traversal and encoded aliases that URL policy cannot detect.
   */
  pathPolicy?: (path: string, field: string) => void;
}

/** Bound raw collections before schema validation can allocate an issue for every malformed entry. */
function assertManifestResourceLimit(input: unknown, maxResources: number): void {
  if (input === null || typeof input !== 'object') return;
  // Count the manifest and rig, plus every reference rather than just unique paths.
  let count = 2;
  for (const field of ['skins', 'animations', 'poses', 'textures'] as const) {
    const entries: unknown = Object.getOwnPropertyDescriptor(input, field)?.value;
    if (field === 'animations' || field === 'poses') {
      if (Array.isArray(entries)) count += entries.length;
    } else if (entries !== null && typeof entries === 'object' && !Array.isArray(entries)) {
      count += Object.keys(entries).length;
    }
    if (count > maxResources) throw new JsonInputLimitError(`Character exceeds the ${maxResources}-resource limit.`);
  }
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
      const workload = new JsonWorkloadBudget(options);
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
        timeoutMs: validateInputLimit(options.timeoutMs ?? DEFAULT_CHARACTER_LOAD_LIMITS.timeoutMs, 'timeoutMs'),
      };
      if (limits.timeoutMs > 2_147_483_647) throw new Error('timeoutMs must not exceed 2147483647.');
      const checkUrl = (resourceUrl: string): void => {
        if (options.urlPolicy && options.urlPolicy(new URL(resourceUrl)) !== true)
          throw new Error(`Character URL rejected by policy: "${resourceUrl}".`);
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
      const read = async (
        resourceUrl: string,
        inspect?: (data: unknown) => void,
      ): Promise<{ data: unknown; url: string }> => {
        controller.signal.throwIfAborted();
        try {
          checkUrl(resourceUrl);
          return await withResourceResponse(
            resourceUrl,
            fetcher,
            {
              controller,
              timeoutMs: limits.timeoutMs,
              timeoutMessage: `Character JSON request timed out: "${resourceUrl}".`,
              ...(options.urlPolicy ? { init: { redirect: 'error' } } : {}),
            },
            async (response, requestSignal) => {
              if (options.urlPolicy && response.redirected)
                throw new Error('Character metadata redirects are disabled by URL policy.');
              if (response.url) checkUrl(response.url);
              if (!response.ok) throw new Error(`Could not load character JSON "${resourceUrl}" (${response.status}).`);
              const data = await readJsonResponse(response, limits.maxJsonBytes, requestSignal, countBytes);
              inspect?.(data);
              return { data, url: response.url || resourceUrl };
            },
          );
        } catch (error) {
          // Stop workers before they acquire another resource after a sibling fails.
          const failure: unknown = controller.signal.aborted ? controller.signal.reason : error;
          controller.abort(failure);
          throw failure;
        }
      };
      const { data: manifestData, url: manifestUrl } = await read(requestedUrl);
      assertManifestResourceLimit(manifestData, limits.maxResources);
      const manifest = characterManifestSchema.parse(manifestData);
      const paths = [
        ...new Set([manifest.rig, ...Object.values(manifest.skins), ...manifest.animations, ...(manifest.poses ?? [])]),
      ];
      if (options.pathPolicy) {
        const references: [string, string][] = [
          ['rig', manifest.rig],
          ...Object.entries(manifest.skins).map(([name, path]): [string, string] => [`skins.${name}`, path]),
          ...manifest.animations.map((path, index): [string, string] => [`animations[${index}]`, path]),
          ...(manifest.poses ?? []).map((path, index): [string, string] => [`poses[${index}]`, path]),
          ...Object.entries(manifest.textures).map(([key, path]): [string, string] => [`textures.${key}`, path]),
        ];
        for (const [field, path] of references) {
          try {
            options.pathPolicy(path, `manifest.${field}`);
          } catch (error) {
            throw new Error(`character.json manifest.${field}: ${String(error)}`, { cause: error });
          }
        }
      }
      // Approve the complete resource list before starting sibling requests or handing artwork to the host.
      if (options.urlPolicy) {
        for (const path of [...paths, ...Object.values(manifest.textures)]) checkUrl(new URL(path, manifestUrl).href);
      }
      const entries: (readonly [string, unknown])[] = [];
      const animationPaths = new Set(manifest.animations);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(limits.concurrency, paths.length) }, async () => {
          while (next < paths.length) {
            controller.signal.throwIfAborted();
            const index = next++;
            const path = paths[index]!;
            const { data } = await read(new URL(path, manifestUrl).href, (input) => {
              if (path === manifest.rig) workload.checkRig(input);
              if (animationPaths.has(path)) workload.checkAnimation(input);
            });
            entries[index] = [path, data];
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
