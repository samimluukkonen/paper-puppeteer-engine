import Phaser from 'phaser';
import {
  SceneLoader,
  StandaloneStoryPlayer,
  StoryPackageLoader,
  buildStoryPackage,
  buildScenePackage,
  encodePackageZip,
  createEmptyScene,
} from '../../src/engine/runtime.js';
import { linearStoryFixture } from '../helpers/linearStoryFixture.js';
import { silentWav, trackedAudioBackend } from './trackedAudioBackend.js';

/** Public runtime consumer: no React or authoring modules. */
export async function mountStory(space = false, audio = false, portable = false, acceptance = false) {
  const host = document.createElement('div');
  host.tabIndex = 0;
  host.setAttribute('aria-label', 'Standalone story');
  host.style.cssText = 'width:1000px;font-family:sans-serif';
  const outside = document.createElement('input');
  outside.setAttribute('aria-label', 'Outside editor field');
  document.body.replaceChildren(outside, host);
  const text = document.createElement('textarea');
  text.setAttribute('aria-label', 'Embedded editor field');
  host.append(text);
  const button = document.createElement('button');
  button.textContent = 'Host button';
  host.append(button);
  const scene = new Phaser.Scene('StoryConsumer');
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 1000,
    height: 700,
    transparent: true,
    audio: { noAudio: true },
    scene: [scene],
  });
  const start = performance.now();
  while (!scene.sys.isActive()) {
    if (performance.now() - start > 15000) throw new Error('Story consumer did not boot.');
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  const tracking: ReturnType<typeof trackedAudioBackend>[] = [];
  const acceptanceFixture = acceptance ? linearStoryFixture() : undefined;
  const scenes =
    acceptanceFixture?.scenes ??
    new Map(
      ['forest', 'meeting'].map((id) => {
        const definition = createEmptyScene({ id, duration: 100 });
        definition.dialogue = ['01-first', '02-second'].map((lineId) => ({
          id: lineId,
          speakerName: '語り手',
          text: `${id} ${lineId}\n森は静かだった。`,
          time: 0,
          duration: 0,
          progression: 'advance-required' as const,
        }));
        if (portable) {
          definition.actors = [
            {
              id: 'hero',
              character: { manifest: new URL('characters/demo-puppet/character.json', location.href).href },
              position: { x: 0, y: 0 },
              animation: 'idle',
            },
          ];
          definition.images = [
            {
              id: 'paper',
              image: 'paper.png',
              position: { x: -400, y: -300 },
              scale: { x: 800, y: 600 },
              visible: true,
              order: 0,
            },
          ];
        }
        if (audio) {
          definition.audioAssets = [{ id: 'tone', name: 'Tone', path: 'tone.wav', category: 'music' }];
          definition.audioTracks = [{ id: 'music', name: 'Music', category: 'music' }];
          definition.audioClips = [
            {
              id: 'bed',
              trackId: 'music',
              assetId: 'tone',
              time: 0,
              duration: 100,
              sourceOffset: 0,
              volume: 0.5,
              loop: true,
              playback: 'dialogue-hold',
            },
          ];
        }
        return [id, definition];
      }),
    );
  const definition = acceptanceFixture?.story ?? {
    version: 1,
    id: 'film',
    name: 'Film',
    scenes: [...scenes.keys()].map((sceneAssetId, index) => ({
      id: sceneAssetId,
      sceneAssetId,
      ...(portable && index === 1 ? { transition: { type: 'fade', duration: 300, color: '#000000' } } : {}),
    })),
  };
  const loaded: Awaited<ReturnType<typeof SceneLoader.fromDefinition>>[] = [];
  const metrics = {
    exports: [] as number[],
    preparations: [] as number[],
    activations: [] as number[],
    updates: [] as number[],
  };
  let viewer!: StandaloneStoryPlayer;
  const mount = async () => {
    viewer = new StandaloneStoryPlayer(scene, host, {
      ...(space ? { advanceKeys: [' '], advanceLabel: 'Space' } : {}),
      loadStory: async (id, signal) => {
        if (portable) {
          const backend = trackedAudioBackend();
          tracking.push(backend);
          const png = Uint8Array.from(
            atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),
            (value) => value.charCodeAt(0),
          );
          const image = async (width: number, height: number) => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#193d29';
            context.fillRect(0, 0, width, height);
            context.fillStyle = '#50783b';
            for (let x = 0; x < width; x += 80) context.fillRect(x, 0, 35, height);
            const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
            return new Uint8Array(await blob.arrayBuffer());
          };
          const background = acceptance ? await image(2048, 1024) : png;
          const characterImage = acceptance ? await image(80, 40) : png;
          if (acceptanceFixture) acceptanceFixture.assets.documents['images/paper.png'] = characterImage;
          const exportStart = performance.now();
          const files = await buildStoryPackage(definition, {
            scenes,
            signal,
            buildScene: (definition) =>
              buildScenePackage(definition, {
                ...(acceptanceFixture?.assets ?? { baseUrl: location.href }),
                signal,
                loadImage: (reference) =>
                  Promise.resolve(reference.endsWith('forest.png') ? background : characterImage),
                loadAudio: () => Promise.resolve(silentWav(1)),
              }),
          });
          const zip = encodePackageZip(files);
          metrics.exports.push(performance.now() - exportStart);
          const source = await StoryPackageLoader.load(scene, zip, {
            signal,
            ...(audio ? { audioBackend: backend.backend } : {}),
          });
          const prepare = source.prepareScene!;
          return {
            ...source,
            prepareScene: async (...args: Parameters<typeof prepare>) => {
              const preparationStart = performance.now();
              const prepared = await prepare(...args);
              metrics.preparations.push(performance.now() - preparationStart);
              return {
                ...prepared,
                activate: async () => {
                  const activationStart = performance.now();
                  const session = await prepared.activate();
                  metrics.activations.push(performance.now() - activationStart);
                  if (acceptance) {
                    const update = session.runner.update.bind(session.runner);
                    session.runner.update = (delta) => {
                      const start = performance.now();
                      update(delta);
                      metrics.updates.push(performance.now() - start);
                    };
                  }
                  loaded.push(session);
                  return session;
                },
              };
            },
          };
        }
        signal.throwIfAborted();
        if (id !== 'film') return Promise.reject(new Error('Unknown story'));
        return Promise.resolve({
          definition,
          scenes,
          loadScene: async (definition, context) => {
            const backend = trackedAudioBackend();
            tracking.push(backend);
            const session = await SceneLoader.fromDefinition(scene, definition, {
              baseUrl: location.href,
              signal: context.signal,
              loadAudio: () => Promise.resolve(silentWav(1)),
              ...(audio ? { audioBackend: backend.backend } : {}),
            });
            loaded.push(session);
            return session;
          },
        });
      },
    });
    await viewer.load('film');
    // Enter before Play must remain inert.
    host.focus();
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    if (viewer.status !== 'stopped') throw new Error('Keyboard unexpectedly started the story.');
    await viewer.play();
    host.focus();
  };
  await mount();
  return {
    snapshot: () => {
      const root = scene.children.getByName('scene-dialogue');
      const subtitle = root instanceof Phaser.GameObjects.Container ? root.getByName('scene-dialogue-text') : undefined;
      return {
        status: viewer.status,
        index: viewer.index,
        waiting: viewer.waitingForDialogue,
        line: loaded.at(-1)?.runner.dialogue?.line.id,
        time: loaded.at(-1)?.runner.time,
        camera: loaded.at(-1)?.runner.cinematicCamera,
        actorPositions: [...(loaded.at(-1)?.runner.actors.values() ?? [])].map((actor) => actor.position),
        rootScales: [...(loaded.at(-1)?.runner.actors.values() ?? [])].map(
          (actor) => actor.puppet.getBone('root').pose.scaleY,
        ),
        metrics,
        text: subtitle instanceof Phaser.GameObjects.Text ? subtitle.text : '',
        audio: loaded.at(-1)?.runner.audio?.status,
        objects: scene.children.list.length,
        textures: scene.textures
          .getTextureKeys()
          .filter((key) => key.startsWith('scene_package_') || key.startsWith('story_image_')).length,
        voices: tracking.reduce((sum, backend) => sum + backend.remainingVoices, 0),
        contextsClosed: tracking.reduce((sum, backend) => sum + backend.stats.contextsClosed, 0),
        decoded: tracking.reduce((sum, backend) => sum + backend.stats.decodedBytes, 0),
        released: tracking.reduce((sum, backend) => sum + backend.stats.disposedBytes, 0),
        updateListeners: scene.events.listenerCount('update'),
      };
    },
    focus: () => host.focus(),
    stop: () => viewer.stop(),
    restart: async () => {
      viewer.stop();
      await viewer.play();
      host.focus();
    },
    advance: () => viewer.advanceDialogue(),
    dispose: () => viewer.dispose(),
    remount: async () => {
      viewer.dispose();
      await mount();
    },
    shutdown: () => {
      scene.scene.stop();
    },
    destroy: () => {
      viewer.dispose();
      game.destroy(true);
      if (game.isRunning) game.loop.tick();
    },
    destroyGame: () => {
      game.destroy(true);
      if (game.isRunning) game.loop.tick();
      return {
        status: viewer.status,
        voices: tracking.reduce((sum, backend) => sum + backend.remainingVoices, 0),
        contextsClosed: tracking.reduce((sum, backend) => sum + backend.stats.contextsClosed, 0),
        decoded: tracking.reduce((sum, backend) => sum + backend.stats.decodedBytes, 0),
        released: tracking.reduce((sum, backend) => sum + backend.stats.disposedBytes, 0),
      };
    },
  };
}

declare global {
  interface Window {
    storyConsumer: Awaited<ReturnType<typeof mountStory>>;
  }
}
