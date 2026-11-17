import { sceneLayers } from '../../engine/core.js';
import type { SceneImageDefinition, SceneLayerDefinition } from '../../engine/data.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneGestureKind } from './SceneEditorGestures.js';

type CommandState = Pick<
  SceneEditorDocument,
  'images' | 'isImageLocked' | 'isLayerLocked' | 'replaceScene' | 'reportError' | 'selectImage' | 'workingScene'
>;
/** The artwork edits a scene document exposes as `document.artwork`. */
export type SceneArtworkEditing = Pick<SceneArtworkCommands, keyof SceneArtworkCommands>;

/** Build artwork and layer proposals without owning snapshots, selection, binary assets or history. */
export class SceneArtworkCommands {
  constructor(
    private readonly state: CommandState,
    /** Commit the active gesture, unless it is a drag of `unlessDragging`. */
    private readonly finishGestures: (unlessDragging?: SceneGestureKind) => void,
  ) {}

  addLayer(): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene) return false;
    const layers = sceneLayers(scene);
    let index = 1;
    while (layers.some((layer) => layer.id === `layer-${index}`)) index++;
    return this.state.replaceScene({
      ...scene,
      layers: [...layers, { id: `layer-${index}`, name: `Layer ${index}`, visible: true, parallax: 1 }],
    });
  }
  updateLayer(id: string, patch: Partial<Omit<SceneLayerDefinition, 'id'>>): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene || !sceneLayers(scene).some((layer) => layer.id === id)) return false;
    return this.state.replaceScene({
      ...scene,
      layers: sceneLayers(scene).map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
    });
  }
  reorderLayer(id: string, offset: -1 | 1): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene) return false;
    const layers = [...sceneLayers(scene)];
    const index = layers.findIndex((layer) => layer.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= layers.length) return false;
    [layers[index], layers[target]] = [layers[target]!, layers[index]!];
    return this.state.replaceScene({ ...scene, layers });
  }
  removeLayer(id: string): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (
      !scene ||
      id === 'background' ||
      id === 'actors' ||
      this.state.isLayerLocked(id) ||
      this.state.isLayerLocked('background')
    )
      return false;
    if (!sceneLayers(scene).some((layer) => layer.id === id)) return false;
    return this.state.replaceScene({
      ...scene,
      layers: sceneLayers(scene).filter((layer) => layer.id !== id),
      ...(scene.images
        ? { images: scene.images.map((image) => (image.layerId === id ? { ...image, layerId: 'background' } : image)) }
        : {}),
    });
  }
  assignImageLayer(id: string, layerId: string): boolean {
    this.finishGestures();
    if (this.state.isLayerLocked(layerId)) return false;
    return this.updateImage(id, { layerId });
  }
  reorderImage(id: string, offset: -1 | 1): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    const image = scene?.images?.find((image) => image.id === id);
    if (!scene || !image || this.state.isImageLocked(id)) return false;
    const siblings = (scene.images ?? [])
      .filter((entry) => (entry.layerId ?? 'background') === (image.layerId ?? 'background'))
      .sort((a, b) => a.order - b.order);
    const index = siblings.findIndex((entry) => entry.id === id);
    const target = index + offset;
    if (target < 0 || target >= siblings.length) return false;
    [siblings[index], siblings[target]] = [siblings[target]!, siblings[index]!];
    const orders = new Map(siblings.map((entry, order) => [entry.id, order]));
    return this.state.replaceScene({
      ...scene,
      images: scene.images!.map((entry) => (orders.has(entry.id) ? { ...entry, order: orders.get(entry.id)! } : entry)),
    });
  }
  addImage(reference: string): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene) return false;
    if (this.state.isLayerLocked('background'))
      return this.state.reportError(new Error('Unlock Background before adding artwork.'));
    if (!this.state.images.has(reference)) return this.state.reportError(new Error(`Missing image "${reference}".`));
    let index = 1;
    while (scene.images?.some((image) => image.id === `image-${index}`)) index++;
    const id = `image-${index}`;
    if (
      !this.state.replaceScene({
        ...scene,
        images: [
          ...(scene.images ?? []),
          {
            id,
            image: reference,
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            visible: true,
            order: Math.min(255, scene.images?.length ?? 0),
          },
        ],
      })
    )
      return false;
    this.state.selectImage(id);
    return true;
  }
  updateImage(id: string, patch: Partial<Omit<SceneImageDefinition, 'id'>>): boolean {
    if (this.state.isImageLocked(id) || (patch.layerId && this.state.isLayerLocked(patch.layerId))) return false;
    this.finishGestures('image');
    const scene = this.state.workingScene;
    if (!scene?.images?.some((image) => image.id === id)) return false;
    return this.state.replaceScene({
      ...scene,
      images: scene.images.map((image) => (image.id === id ? { ...image, ...patch } : image)),
    });
  }
  removeImage(id: string): boolean {
    if (this.state.isImageLocked(id)) return false;
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene?.images?.some((image) => image.id === id)) return false;
    return this.state.replaceScene({ ...scene, images: scene.images.filter((image) => image.id !== id) });
  }
}
