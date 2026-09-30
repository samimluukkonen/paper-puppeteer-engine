import { type CharacterData, CharacterDefinition, characterManifestSchema } from './CharacterDefinition.js';

/** Fetches only JSON metadata. Image decoding/loading belongs to Phaser or the host. */
export const CharacterLoader = {
  async load(url: string, fetcher: typeof fetch = fetch): Promise<CharacterDefinition> {
    const manifestUrl = new URL(url, globalThis.location?.href).href;
    const read = async (path: string): Promise<unknown> => {
      const resourceUrl = new URL(path, manifestUrl).href;
      const response = await fetcher(resourceUrl);
      if (!response.ok) throw new Error(`Could not load character JSON "${resourceUrl}" (${response.status}).`);
      return response.json();
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
  },
};
