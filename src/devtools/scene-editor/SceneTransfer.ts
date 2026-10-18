import { safeFilename } from '../../engine/assetFilename.js';
import { resolveSceneDefinition, sceneAssetCatalog, type SceneAssetOptions } from '../../engine/SceneAssets.js';
import { parseSceneJson, serializeSceneDefinition } from '../../engine/SceneDefinition.js';
import type { ReadonlyScene, SceneEditorDocument } from './SceneEditorDocument.js';

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
  return document.importJson(serializeSceneDefinition(resolved.definition), confirmDiscard ? { confirmDiscard } : {});
}

export async function exportSceneJson(snapshot: ReadonlyScene, options: SceneAssetOptions): Promise<string> {
  const resolved = await resolveSceneDefinition(snapshot, options);
  return serializeSceneDefinition(resolved.definition, { characters: sceneAssetCatalog(resolved.characters) });
}

export function sceneExportFilename(id: string, extension: 'json' | 'zip'): string {
  return safeFilename(`${id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'scene'}.scene.${extension}`);
}
