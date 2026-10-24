import { sceneLayers } from '../../engine/sceneLayers.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';

/** Foreground-first hierarchy; document arrays and rendering remain back-to-front. */
export function SceneLayersPanel({ document }: { document: SceneEditorDocument }) {
  const scene = document.workingScene;
  if (!scene) return null;
  const layers = sceneLayers(scene);
  return (
    <details className="scene-layers" data-guide-id={GUIDE_TARGETS.sceneLayers}>
      <summary>Scene Layers ({layers.length})</summary>
      <button
        type="button"
        className="workspace-primary"
        disabled={layers.length >= 64}
        onClick={() => document.addLayer()}
      >
        + Add Layer
      </button>
      <p className="workspace-caption">Top layers draw in front. Actors stay together between artwork layers.</p>
      <ol className="scene-layer-list" aria-label="Scene layers, front to back">
        {[...layers].reverse().map((layer) => {
          const index = layers.indexOf(layer);
          const locked = document.isLayerLocked(layer.id);
          const images = (scene.images ?? [])
            .filter((image) => (image.layerId ?? 'background') === layer.id)
            .sort((a, b) => b.order - a.order || (scene.images?.indexOf(b) ?? 0) - (scene.images?.indexOf(a) ?? 0));
          return (
            <li key={layer.id}>
              <form
                className="scene-layer-settings"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const name = data.get('name');
                  if (typeof name !== 'string') return;
                  document.updateLayer(layer.id, {
                    name,
                    parallax: Number(data.get('parallax')),
                  });
                }}
              >
                <label key={`name-${layer.name}`}>
                  Layer name
                  <input aria-label={`Name for ${layer.id}`} name="name" defaultValue={layer.name} required />
                </label>
                <label key={`parallax-${layer.parallax}`}>
                  Parallax
                  <input
                    aria-label={`Parallax for ${layer.id}`}
                    data-guide-id={layer.id === 'background' ? GUIDE_TARGETS.sceneLayerParallax : undefined}
                    name="parallax"
                    type="number"
                    min="0"
                    step="any"
                    defaultValue={layer.parallax}
                    readOnly={layer.id === 'actors'}
                    required
                  />
                </label>
                <button type="submit">Apply layer</button>
              </form>
              <div
                className="scene-artwork-commands"
                data-guide-id={layer.id === 'background' ? GUIDE_TARGETS.sceneLayerOrder : undefined}
              >
                <button
                  type="button"
                  aria-label={`Move ${layer.name} forward`}
                  disabled={index === layers.length - 1}
                  onClick={() => document.reorderLayer(layer.id, 1)}
                >
                  Forward
                </button>
                <button
                  type="button"
                  aria-label={`Move ${layer.name} backward`}
                  disabled={index === 0}
                  onClick={() => document.reorderLayer(layer.id, -1)}
                >
                  Backward
                </button>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Show ${layer.name}`}
                    checked={layer.visible}
                    onChange={(event) => document.updateLayer(layer.id, { visible: event.target.checked })}
                  />{' '}
                  Visible
                </label>
                {layer.id !== 'actors' && (
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Lock ${layer.name}`}
                      checked={locked}
                      onChange={(event) => document.setLayerLocked(layer.id, event.target.checked)}
                    />{' '}
                    Lock
                  </label>
                )}
                {layer.id !== 'background' && layer.id !== 'actors' && (
                  <button
                    type="button"
                    className="workspace-danger"
                    disabled={locked || document.isLayerLocked('background')}
                    onClick={() => document.removeLayer(layer.id)}
                  >
                    Remove layer
                  </button>
                )}
              </div>
              {layer.id !== 'background' && layer.id !== 'actors' && (
                <p className="workspace-caption">
                  Removing this layer moves its images to Background and keeps image assets.
                </p>
              )}
              <ul className="scene-artwork-list">
                {layer.id === 'actors'
                  ? [...scene.actors].reverse().map((actor) => (
                      <li key={actor.id} className="scene-layer-element">
                        <button
                          type="button"
                          aria-pressed={document.selectedActorId === actor.id}
                          onClick={() => document.selectActor(actor.id)}
                        >
                          {actor.id}
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${actor.id} forward`}
                          disabled={scene.actors.indexOf(actor) === scene.actors.length - 1}
                          onClick={() => document.reorderActor(actor.id, 1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${actor.id} backward`}
                          disabled={scene.actors.indexOf(actor) === 0}
                          onClick={() => document.reorderActor(actor.id, -1)}
                        >
                          ↓
                        </button>
                      </li>
                    ))
                  : images.map((image, imageIndex) => (
                      <li key={image.id} className="scene-layer-element">
                        <button
                          type="button"
                          aria-pressed={document.selectedImageId === image.id}
                          onClick={() => document.selectImage(image.id)}
                        >
                          {image.id}
                          {!image.visible && ' (hidden)'}
                        </button>
                        <select
                          aria-label={`Layer for ${image.id}`}
                          value={image.layerId ?? 'background'}
                          disabled={locked}
                          onChange={(event) => document.assignImageLayer(image.id, event.target.value)}
                        >
                          {layers
                            .filter((entry) => entry.id !== 'actors')
                            .map((entry) => (
                              <option key={entry.id} value={entry.id} disabled={document.isLayerLocked(entry.id)}>
                                {entry.name}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          aria-label={`Move ${image.id} forward`}
                          disabled={locked || imageIndex === 0}
                          onClick={() => document.reorderImage(image.id, 1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${image.id} backward`}
                          disabled={locked || imageIndex === images.length - 1}
                          onClick={() => document.reorderImage(image.id, -1)}
                        >
                          ↓
                        </button>
                      </li>
                    ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
