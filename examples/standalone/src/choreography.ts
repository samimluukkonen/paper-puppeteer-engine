import Phaser from 'phaser';
import { createScriptedScene, type ScriptedScene } from './scriptedScene.js';
import './style.css';

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const log = document.querySelector<HTMLPreElement>('#events')!;
const run = document.querySelector<HTMLButtonElement>('#run')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const cleanup = document.querySelector<HTMLButtonElement>('#dispose')!;
let current: ScriptedScene | undefined;
let disposed = false;
let busy = false;

class ScriptScene extends Phaser.Scene {
  constructor() {
    super('script');
  }

  create(): void {
    run.disabled = false;
    status.textContent = 'Ready';
    run.addEventListener('click', start);
    cancel.addEventListener('click', cancelRun);
    this.events.once('shutdown', () => {
      current?.dispose();
      run.removeEventListener('click', start);
      cancel.removeEventListener('click', cancelRun);
    });
  }
}
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: 760,
  height: 640,
  backgroundColor: '#eee8dc',
  scene: ScriptScene,
});

function cancelRun(): void {
  current?.choreography.cancel();
}
function start(): void {
  if (disposed || busy) return;
  busy = true;
  run.disabled = true;
  status.textContent = 'Loading';
  log.textContent = '';
  void (async () => {
    const releases: (() => void)[] = [];
    try {
      const scene = game.scene.getScene('script');
      const url = new URL('character/character.json', document.baseURI).href;
      current = await createScriptedScene(scene, { urls: [url, url] });
      if (!current || disposed) return;
      for (const actor of current.actors) {
        releases.push(
          actor.puppet.onPlaybackLifecycle((event) => {
            if (event.type === 'started') log.textContent += `${actor.id}: ${event.clip}\n`;
          }),
        );
        releases.push(
          actor.puppet.onAnimationEvent((event) => {
            log.textContent += `${actor.id}: event ${event.name}\n`;
          }),
        );
      }
      status.textContent = 'Running';
      cancel.disabled = false;
      const outcome = await current.run();
      if (!disposed) status.textContent = `Scene: ${outcome.status}; resources disposed`;
    } catch (error) {
      if (!disposed) status.textContent = `Failed: ${String(error)}`;
    } finally {
      for (const release of releases) release();
      current?.dispose();
      current = undefined;
      busy = false;
      run.disabled = disposed;
      cancel.disabled = true;
    }
  })();
}
function dispose(): void {
  if (disposed) return;
  disposed = true;
  game.scene.stop('script');
  game.destroy(true);
  run.disabled = cancel.disabled = cleanup.disabled = true;
  status.textContent = 'Disposed';
  window.removeEventListener('pagehide', dispose);
}
cleanup.addEventListener('click', dispose, { once: true });
window.addEventListener('pagehide', dispose, { once: true });
