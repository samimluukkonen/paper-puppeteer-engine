import Phaser from 'phaser';
import { SceneLoader, StandaloneStoryPlayer, createEmptyScene } from '../../src/engine/runtime.js';
import { silentWav, trackedAudioBackend } from './trackedAudioBackend.js';

/** Public runtime consumer: no React or authoring modules. */
export async function mountStory(space = false, audio = false) {
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
  const scenes = new Map(
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
  const definition = {
    version: 1,
    id: 'film',
    name: 'Film',
    scenes: [...scenes.keys()].map((sceneAssetId) => ({ id: sceneAssetId, sceneAssetId })),
  };
  const loaded: Awaited<ReturnType<typeof SceneLoader.fromDefinition>>[] = [];
  let viewer!: StandaloneStoryPlayer;
  const mount = async () => {
    viewer = new StandaloneStoryPlayer(scene, host, {
      ...(space ? { advanceKeys: [' '], advanceLabel: 'Space' } : {}),
      loadStory: (id, signal) => {
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
        text: subtitle instanceof Phaser.GameObjects.Text ? subtitle.text : '',
        audio: loaded.at(-1)?.runner.audio?.status,
        objects: scene.children.list.length,
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
