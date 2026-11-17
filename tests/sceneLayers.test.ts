import { assert, test } from 'vitest';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { stagePoint } from '../src/devtools/scene-editor/stageCoordinates.js';
import { panCamera, zoomCameraAt } from '../src/devtools/shared/editorCamera.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  type SceneLayerDefinition,
} from '../src/engine/SceneDefinition.js';
import {
  DEFAULT_SCENE_LAYERS,
  parallaxPosition,
  sceneActorDepth,
  sceneImageDepth,
  sceneLayer,
  sceneLayers,
} from '../src/engine/sceneLayers.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';
import { artworkFixture } from './helpers/scenePackageFixtures.js';

async function fixture() {
  const document = new SceneEditorDocument();
  document.createScene({ id: 'forest' });
  const bytes = new Uint8Array(artworkFixture().documents['images/paper.png'] as Uint8Array<ArrayBuffer>);
  const reference = await document.images.add(bytes, 'forest.png');
  document.artwork.addImage(reference);
  document.artwork.addImage(reference);
  document.addActor('hero.json', { x: 20, y: 30 });
  return { document, reference, bytes };
}

test('legacy scenes receive virtual Background/Actors bands without rewriting their JSON', () => {
  const scene = createEmptyScene({ id: 'legacy' });
  assert.isUndefined(scene.layers);
  assert.deepEqual(sceneLayers(scene), DEFAULT_SCENE_LAYERS);
  assert.equal(sceneLayer(scene, 'actors').parallax, 1);
  assert.isUndefined(parseSceneDefinition(scene).layers);
});

test('layer and image commands round-trip independently through history without changing Actor choreography', async () => {
  const { document } = await fixture();
  const original = document.workingScene!;
  document.artwork.addLayer();
  const created = document.workingScene!;
  assert.lengthOf(created.layers!, 3);
  document.undo();
  assert.strictEqual(document.workingScene, original);
  document.redo();
  assert.strictEqual(document.workingScene, created);
  document.artwork.updateLayer('layer-1', { name: 'Foreground trees', parallax: 1.2 });
  document.artwork.assignImageLayer('image-2', 'layer-1');
  const beforeOrder = document.workingScene!;
  const tree = beforeOrder.images![1]!;
  assert.isAbove(sceneImageDepth(beforeOrder, tree, 1), sceneActorDepth(beforeOrder, 0));
  document.artwork.reorderLayer('layer-1', -1);
  assert.isBelow(sceneImageDepth(document.workingScene!, tree, 1), sceneActorDepth(document.workingScene!, 0));
  document.undo();
  assert.strictEqual(document.workingScene, beforeOrder);
  document.redo();
  assert.deepEqual(document.workingScene!.actors, original.actors);
  assert.deepEqual(document.workingScene!.actions, original.actions);
  assert.deepEqual(parseSceneJson(document.exportJson()), document.workingScene);
  document.undo();
  document.undo();
  assert.isUndefined(document.workingScene!.images![1]!.layerId);
  document.redo();
  assert.equal(document.workingScene!.images![1]!.layerId, 'layer-1');
});

test('image ordering normalizes tied orders stably and remains undoable', async () => {
  const { document } = await fixture();
  document.artwork.updateImage('image-2', { order: 0 });
  const before = document.workingScene!;
  document.artwork.reorderImage('image-1', 1);
  const scene = document.workingScene!;
  assert.isAbove(sceneImageDepth(scene, scene.images![0]!, 0), sceneImageDepth(scene, scene.images![1]!, 1));
  document.undo();
  assert.strictEqual(document.workingScene, before);
  document.redo();
  assert.isFalse(document.artwork.reorderImage('image-1', 1));
});

test('removing a layer reassigns artwork atomically and retains its binary for undo and redo', async () => {
  const { document, reference } = await fixture();
  document.artwork.addLayer();
  document.artwork.assignImageLayer('image-1', 'layer-1');
  const before = document.workingScene;
  assert.isTrue(document.artwork.removeLayer('layer-1'));
  assert.equal(document.workingScene!.images![0]!.layerId, 'background');
  assert.lengthOf(document.workingScene!.images!, 2);
  assert.isTrue(document.images.has(reference));
  document.undo();
  assert.strictEqual(document.workingScene, before);
  document.redo();
  assert.equal(document.cleanupImages(), 0);
  assert.isFalse(document.artwork.removeLayer('actors'));
  assert.isFalse(document.artwork.removeLayer('background'));
});

test('editor-only locks cancel gestures, guard authored image commands, preserve redo and never enter export', async () => {
  const { document } = await fixture();
  document.artwork.addLayer();
  document.artwork.assignImageLayer('image-1', 'layer-1');
  const before = document.workingScene;
  document.artwork.updateImage('image-1', { visible: false });
  document.undo();
  let imageDrag = document.beginDrag({ kind: 'image', id: 'image-1' })!;
  imageDrag.change({ position: { x: 100, y: 200 }, scale: { x: 2, y: 2 } });
  document.setLayerLocked('layer-1', true);
  assert.strictEqual(document.workingScene, before);
  assert.isTrue(document.canRedo);
  assert.isFalse(document.hasActiveGesture);
  assert.isNull(document.beginDrag({ kind: 'image', id: 'image-1' }));
  assert.isFalse(document.artwork.updateImage('image-1', { visible: false }));
  assert.isFalse(document.artwork.assignImageLayer('image-1', 'background'));
  assert.isFalse(document.artwork.removeImage('image-1'));
  assert.isFalse(document.artwork.removeLayer('layer-1'));
  assert.isFalse(document.artwork.assignImageLayer('image-2', 'layer-1'));
  document.selectImage('image-1');
  const json = document.exportJson();
  assert.notInclude(json, 'locked');
  assert.notInclude(json, 'selected');
  const reopened = new SceneEditorDocument();
  assert.isTrue(reopened.importJson(json));
  assert.isFalse(reopened.isLayerLocked('layer-1'));
  document.createScene({ id: 'other' });
  assert.isFalse(document.isLayerLocked('layer-1'));
  document.selectScene('forest');
  assert.isTrue(document.isLayerLocked('layer-1'));
  document.setLayerLocked('layer-1', false);
  imageDrag = document.beginDrag({ kind: 'image', id: 'image-1' })!;
  assert.isNotNull(imageDrag);
  imageDrag.cancel();
  document.setLayerLocked('layer-1', true);
  assert.isTrue(document.importJson(json, { confirmDiscard: () => true }));
  assert.isFalse(document.isLayerLocked('layer-1'));
  assert.isNull(document.selectedImageId);
});

test('layer validation rejects ambiguous identities, invalid factors, missing references and artwork in the Actors band', async () => {
  const { document } = await fixture();
  const scene = document.workingScene!;
  const layers = [...DEFAULT_SCENE_LAYERS];
  for (const invalid of [
    { ...scene, layers: [layers[0], layers[0]] },
    { ...scene, layers: [layers[1], layers[1]] },
    { ...scene, layers: layers.map((layer) => ({ ...layer, parallax: -1 })) },
    { ...scene, layers: layers.map((layer) => ({ ...layer, parallax: Infinity })) },
    { ...scene, layers: layers.map((layer) => ({ ...layer, parallax: NaN })) },
    { ...scene, layers: layers.map((layer) => ({ ...layer, parallax: 0 })) },
    {
      ...scene,
      layers: Array.from({ length: 65 }, (_, i) => ({ id: `l${i}`, name: 'Layer', visible: true, parallax: 1 })),
    },
    ...['missing', 'actors'].map((layerId) => ({
      ...scene,
      images: scene.images!.map((image) => ({ ...image, layerId })),
    })),
  ])
    assert.throws(() => parseSceneDefinition(invalid));
});

test.each([0, 0.2, 0.5, 1, 1.2, 3])(
  'parallax factor %s agrees with Phaser scroll semantics through editor pan, zoom and picking',
  (factor) => {
    const authored = Object.freeze({ x: 90, y: 60 });
    const cinematic = { x: 100, y: 40 };
    const camera = {
      scrollX: -400 + cinematic.x,
      scrollY: -300 + cinematic.y,
      zoom: 1,
      width: 800,
      height: 600,
      originX: 0.5,
      originY: 0.5,
      setZoom(zoom: number) {
        this.zoom = zoom;
      },
    };
    const render = parallaxPosition(authored, factor, cinematic);
    assert.closeTo(render.x - camera.scrollX, 400 + authored.x - factor * cinematic.x, 1e-9);
    const bounds = { left: 25, top: 50, width: 1000, height: 750 };
    const pick = () => {
      const client = {
        x: bounds.left + (((render.x - camera.scrollX - 400) * camera.zoom + 400) * bounds.width) / camera.width,
        y: bounds.top + (((render.y - camera.scrollY - 300) * camera.zoom + 300) * bounds.height) / camera.height,
      };
      const point = stagePoint(client, bounds, camera);
      assert.closeTo(point.x, render.x, 1e-8);
      assert.closeTo(point.y, render.y, 1e-8);
    };
    pick();
    panCamera(camera, 100, -80);
    zoomCameraAt(camera, 200, 150, -400);
    pick();
    assert.deepEqual(authored, { x: 90, y: 60 });
  },
);

test('all image and Actor slots stay in their bands below ground guides at workload limits', () => {
  const layers: SceneLayerDefinition[] = [...DEFAULT_SCENE_LAYERS];
  for (let i = 2; i < 64; i++) layers.push({ id: `l${i}`, name: 'Layer', visible: true, parallax: i });
  const scene = { layers };
  const image = {
    id: 'art',
    image: 'art.png',
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    order: 255,
    visible: true,
  };
  assert.isBelow(sceneImageDepth(scene, image, 255), sceneActorDepth(scene, 0));
  assert.isBelow(sceneActorDepth(scene, 255), sceneImageDepth(scene, { ...image, layerId: 'l2', order: 0 }, 0));
  assert.isBelow(sceneImageDepth(scene, { ...image, layerId: 'l63' }, 255), 9000);
});

test('scene ZIP rebasing retains layer identities, order, visibility and factors', async () => {
  const { document, bytes } = await fixture();
  document.removeActor(document.selectedActorId!);
  document.artwork.addLayer();
  document.artwork.updateLayer('layer-1', { name: 'Far mountains', parallax: 0.2, visible: false });
  document.artwork.assignImageLayer('image-2', 'layer-1');
  const source = document.workingScene!;
  const packaged = await buildScenePackage(source, {
    baseUrl: 'https://example.test/scene.json',
    loadImage: () => Promise.resolve(bytes),
  });
  const restored = await validateScenePackage(packaged);
  assert.deepEqual(restored.definition.layers, source.layers);
  assert.equal(restored.definition.images![1]!.layerId, 'layer-1');
  assert.lengthOf(restored.images!, 1);
});
