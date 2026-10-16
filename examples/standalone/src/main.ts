import { AnimationStateController, loadSceneCharacter, Puppet } from 'paper-puppeteer-engine/runtime';
import Phaser from 'phaser';
import './style.css';

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const eventLog = document.querySelector<HTMLParagraphElement>('#event')!;
const clipButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-clip]')];
const skinButton = document.querySelector<HTMLButtonElement>('#skin')!;
const disposeButton = document.querySelector<HTMLButtonElement>('#dispose')!;
const controllerButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-state], [data-command]')];
const lifecycleLog = document.querySelector<HTMLParagraphElement>('#lifecycle')!;

class CharacterScene extends Phaser.Scene {
  constructor() {
    super('character');
  }

  create(): void {
    void this.startCharacter().catch((error: unknown) => {
      status.textContent = `Load failed: ${String(error)}`;
    });
  }

  private async startCharacter(): Promise<void> {
    const url = new URL('character/character.json', document.baseURI).href;
    const definition = await loadSceneCharacter(this, url, { allowWebp: true });
    if (!definition) return; // Shutdown while fetching metadata or decoding images.
    const puppet = new Puppet(this, { definition, x: 380, y: 380 });
    const unsubscribe = puppet.onAnimationEvent((event) => {
      eventLog.textContent = `${event.clip}: ${event.name} ${JSON.stringify(event.data ?? null)}`;
    });
    puppet.play('idle');
    status.textContent = `Ready: ${definition.id} / idle`;

    const listeners = new AbortController();
    let pendingWait: AbortController | undefined;
    // Custom exports can omit these optional example clips; basic playback still works.
    const hasControllerClips = ['idle', 'walk', 'run', 'attack', 'recover'].every((name) => puppet.hasAnimation(name));
    const controller = hasControllerClips
      ? new AnimationStateController(puppet, {
          initialState: 'idle',
          defaultFadeDuration: 150,
          states: {
            idle: { animation: 'idle' },
            walking: { animation: 'walk' },
            running: { animation: 'run' },
            attack: { animation: 'attack' },
          },
        })
      : undefined;
    const releaseLifecycle = puppet.onPlaybackLifecycle((event) => {
      lifecycleLog.textContent = `${event.layer}: ${event.clip} / ${event.type} (#${event.playbackId})`;
    });
    const playAsync = async (): Promise<void> => {
      pendingWait?.abort();
      const operation = new AbortController();
      pendingWait = operation;
      status.textContent = 'Awaiting attack…';
      try {
        const result = await puppet.playAndWait('attack', { fadeDuration: 150, signal: operation.signal });
        if (listeners.signal.aborted || pendingWait !== operation) return;
        status.textContent = `Async attack: ${result.status}`;
        if (result.status !== 'completed') return;
        // A callback or queue may already own a newer selection by the time await resumes.
        if (puppet.getPlaybackStatus()?.playbackId === result.playback.playbackId) controller?.setState('idle');
      } catch (error) {
        if (!listeners.signal.aborted && pendingWait === operation)
          status.textContent = `Playback failed: ${String(error)}`;
      } finally {
        if (pendingWait === operation) pendingWait = undefined;
      }
    };
    for (const button of controllerButtons) {
      button.disabled = !controller;
      button.addEventListener(
        'click',
        () => {
          if (!controller) return;
          if (button.dataset.state) {
            controller.setState(button.dataset.state);
            status.textContent = `State: ${controller.currentState}`;
          } else if (button.dataset.command === 'queue') {
            // A looping idle cannot have a finite queue behind it. Stop only the base channel.
            puppet.stopQueue().queue('attack').queue('recover', { fadeDuration: 100 });
            status.textContent = 'Queued: attack → recover';
          } else if (button.dataset.command === 'action') {
            controller.playAction('attack');
            status.textContent = `Action: attack → ${controller.currentState}`;
          } else if (button.dataset.command === 'async') {
            void playAsync();
          } else if (button.dataset.command === 'cancel') {
            pendingWait?.abort(); // Cancels the wait; the clip keeps playing.
          } else if (button.dataset.command === 'stop') {
            puppet.stopQueue();
            status.textContent = 'Base stopped';
          }
        },
        { signal: listeners.signal },
      );
    }
    for (const button of clipButtons) {
      const clip = button.dataset.clip!;
      button.disabled = !definition.animations.some((animation) => animation.name === clip);
      button.addEventListener(
        'click',
        () => {
          puppet.play(clip, { fadeDuration: 150 });
          status.textContent = `Ready: ${definition.id} / ${clip}`;
        },
        { signal: listeners.signal },
      );
    }
    const skins = definition.rig.skins.map((skin) => skin.name);
    let skinIndex = skins.indexOf(definition.defaultSkin);
    skinButton.disabled = skins.length < 2;
    skinButton.addEventListener(
      'click',
      () => {
        skinIndex = (skinIndex + 1) % skins.length;
        // Start from the base each time so sparse overrides match the authoring preview.
        puppet.setSkin(definition.defaultSkin).applySkin(skins[skinIndex]!);
        skinButton.textContent = `Skin: ${skins[skinIndex]}`;
      },
      { signal: listeners.signal },
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      listeners.abort();
      pendingWait?.abort();
      controller?.dispose();
      releaseLifecycle();
      unsubscribe();
      puppet.destroy();
      for (const button of [...clipButtons, ...controllerButtons, skinButton]) button.disabled = true;
      // This example owns the entire game. Game destruction below releases its texture manager.
      status.textContent = 'Disposed';
    });
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: 760,
  height: 640,
  backgroundColor: '#eee8dc',
  scene: CharacterScene,
});
let disposed = false;
function dispose(): void {
  if (disposed) return;
  disposed = true;
  disposeButton.removeEventListener('click', dispose);
  window.removeEventListener('pagehide', dispose);
  // Stopping first also cancels a pending loadSceneCharacter and destroys the Puppet.
  game.scene.stop('character');
  game.destroy(true);
  disposeButton.disabled = true;
  status.textContent = 'Disposed';
}
disposeButton.addEventListener('click', dispose, { once: true });
window.addEventListener('pagehide', dispose, { once: true });
