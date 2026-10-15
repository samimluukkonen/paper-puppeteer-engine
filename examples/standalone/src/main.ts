import { loadSceneCharacter, Puppet } from 'paper-puppeteer-engine/runtime';
import Phaser from 'phaser';
import './style.css';

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const eventLog = document.querySelector<HTMLParagraphElement>('#event')!;
const clipButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-clip]')];
const skinButton = document.querySelector<HTMLButtonElement>('#skin')!;
const disposeButton = document.querySelector<HTMLButtonElement>('#dispose')!;

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
        puppet.setSkin(skins[skinIndex]!);
        skinButton.textContent = `Skin: ${skins[skinIndex]}`;
      },
      { signal: listeners.signal },
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      listeners.abort();
      unsubscribe();
      puppet.destroy();
      for (const button of [...clipButtons, skinButton]) button.disabled = true;
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
