import type { Point } from './affineMath.js';
import type { DeepReadonly } from './readonlyData.js';
import type { SceneImageDefinition, SceneLayerDefinition } from './SceneDefinition.js';

type LayerSource = { readonly layers?: readonly DeepReadonly<SceneLayerDefinition>[] | undefined };

export const DEFAULT_SCENE_LAYERS: readonly DeepReadonly<SceneLayerDefinition>[] = Object.freeze([
  Object.freeze({ id: 'background', name: 'Background', visible: true, parallax: 1 }),
  Object.freeze({ id: 'actors', name: 'Actors', visible: true, parallax: 1 }),
]);
export function sceneLayers(scene: LayerSource) {
  return scene.layers ?? DEFAULT_SCENE_LAYERS;
}
export function sceneLayer(scene: LayerSource, id = 'background') {
  return sceneLayers(scene).find((layer) => layer.id === id)!;
}
/** Bands stay below editor guides (9000). Fractional slots never cross a band boundary. */
export function sceneLayerDepth(scene: LayerSource, id: string): number {
  return (sceneLayers(scene).findIndex((layer) => layer.id === id) - 1) * 100;
}
export function sceneActorDepth(scene: LayerSource, index: number): number {
  return scene.layers ? sceneLayerDepth(scene, 'actors') + index / 257 : index;
}
export function sceneImageDepth(scene: LayerSource, image: DeepReadonly<SceneImageDefinition>, index: number): number {
  return sceneLayerDepth(scene, image.layerId ?? 'background') + (image.order + index / 257) / 256;
}
/** Equivalent to Phaser scroll factors while leaving editor navigation at normal world scrolling.
 * Only cinematic scroll is compensated; zoom and editor pan never change authored transforms.
 */
export function parallaxPosition(position: Point, factor: number, cinematicScroll: Point): Point {
  return {
    x: position.x + (1 - factor) * cinematicScroll.x,
    y: position.y + (1 - factor) * cinematicScroll.y,
  };
}
