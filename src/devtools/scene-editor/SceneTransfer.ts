import { safeFilename } from '../../engine/assetFilename.js';
import { decodeImage } from '../../engine/decodeImage.js';
import { resolveSceneDefinition, sceneAssetCatalog, type SceneAssetOptions } from '../../engine/SceneAssets.js';
import { parseSceneDefinition, parseSceneJson, serializeSceneDefinition } from '../../engine/SceneDefinition.js';
import type { ReadonlyScene, SceneEditorDocument } from './SceneEditorDocument.js';
import { SceneImageRegistry } from './SceneImageRegistry.js';

/** The async preflight completes before a document is registered or replaced. A failed
 * import preserves the current working copy, selections, playback source and history. */
export async function importSceneJson(
  document: SceneEditorDocument,
  json: string,
  options: SceneAssetOptions,
  confirmDiscard?: () => boolean,
): Promise<boolean> {
  const resolved = await resolveSceneDefinition(parseSceneJson(json), options);
  options.signal?.throwIfAborted();
  const proposal = new SceneImageRegistry();
  const images = new Map<string, string>();
  for (const [reference, bytes] of resolved.images ?? []) {
    if (typeof Image !== 'undefined') {
      const decoded = await decodeImage(bytes, options.signal ?? new AbortController().signal);
      decoded.dispose();
    }
    images.set(reference, await proposal.add(bytes, reference.split('/').at(-1)!, options.signal));
  }
  const scene = parseSceneDefinition(resolved.definition);
  for (const image of scene.images ?? []) image.image = images.get(image.image)!;
  options.signal?.throwIfAborted();
  // Do not install assets until replacement has been accepted.
  if (document.needsImportConfirmation(resolved.definition.id) && !confirmDiscard?.()) return false;
  document.images.registerAll(
    new Map(proposal.entries.map((image) => [image.reference, proposal.read(image.reference)])),
  );
  return document.importJson(serializeSceneDefinition(scene), { confirmDiscard: () => true });
}

export async function exportSceneJson(snapshot: ReadonlyScene, options: SceneAssetOptions): Promise<string> {
  const resolved = await resolveSceneDefinition(snapshot, options);
  return serializeSceneDefinition(resolved.definition, { characters: sceneAssetCatalog(resolved.characters) });
}

export function sceneExportFilename(id: string, extension: 'json' | 'zip'): string {
  return safeFilename(`${id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'scene'}.scene.${extension}`);
}
