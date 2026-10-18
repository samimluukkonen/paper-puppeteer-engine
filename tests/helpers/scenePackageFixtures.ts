import { createEmptyScene, type SceneDefinition } from '../../src/engine/SceneDefinition.js';
import { requestUrl } from './requestUrl.js';

export function sceneFixture(): SceneDefinition {
  return {
    ...createEmptyScene({ id: 'opening', duration: 2000 }),
    actors: ['hero', 'friend'].map((id, index) => ({
      id,
      character: { manifest: 'characters/hero/character.json' },
      position: { x: index * 100, y: 10 },
      animation: 'wave',
      skin: 'default',
    })),
    actions: [
      { id: 'walk', type: 'move', actorId: 'hero', time: 100, duration: 1000, destination: { x: 200, y: 20 } },
      {
        id: 'wave',
        type: 'animation',
        actorId: 'friend',
        time: 0,
        duration: 1000,
        animation: 'wave',
        loop: true,
        speed: 1,
      },
      { id: 'cue', type: 'cue', actorId: 'hero', time: 500, name: 'hello', payload: { z: 1, a: true } },
    ],
  };
}

export function assetFixture() {
  const documents: Record<string, unknown> = {
    'character.json': {
      version: 1,
      id: 'hero',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skins/default.json' },
      animations: ['animations/wave.json'],
      textures: {},
    },
    'rig.json': { version: 1, root: 'root', bones: [{ id: 'root' }] },
    'skins/default.json': { version: 1, name: 'default', slots: {} },
    'animations/wave.json': {
      version: 1,
      name: 'wave',
      duration: 1000,
      loop: true,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1000, x: 50 },
        ],
      },
    },
  };
  const requests: string[] = [];
  const fetcher: typeof fetch = (input) => {
    const path = decodeURIComponent(new URL(requestUrl(input)).pathname);
    requests.push(path);
    const key = path.replace('/scenes/characters/hero/', '');
    const value = documents[key];
    return Promise.resolve(
      value instanceof Uint8Array
        ? new Response(new Uint8Array(value))
        : value
          ? Response.json(value)
          : new Response(null, { status: 404 }),
    );
  };
  return { documents, requests, fetcher, baseUrl: 'https://example.test/scenes/scene.json' };
}

export function artworkFixture() {
  const assets = assetFixture();
  const image = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  assets.documents['character.json'] = {
    ...(assets.documents['character.json'] as object),
    textures: { paper: 'images/paper.png', alias: 'images/paper.png' },
  };
  assets.documents['rig.json'] = { version: 1, root: 'root', bones: [{ id: 'root', sprite: { texture: 'paper' } }] };
  assets.documents['images/paper.png'] = image;
  return assets;
}
