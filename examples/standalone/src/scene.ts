import { SceneLoader, type LoadedScene } from 'paper-puppeteer-engine/runtime';
import Phaser from 'phaser';
import './style.css';

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const cues = document.querySelector<HTMLPreElement>('#events')!;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const time = document.querySelector<HTMLInputElement>('#time')!;
const file = document.querySelector<HTMLInputElement>('#package')!;
const cleanup = document.querySelector<HTMLButtonElement>('#dispose')!;
const listeners = new AbortController();

class AuthoredScene extends Phaser.Scene {
  private loaded: LoadedScene | undefined;
  private request: AbortController | undefined;
  private ready = false;
  constructor() {
    super('authored-scene');
  }
  create(): void {
    this.ready = true;
    this.events.once('shutdown', () => {
      this.ready = false;
      this.request?.abort();
      this.loaded?.dispose();
      this.loaded = undefined;
    });
    void this.open();
  }
  async open(zip?: Uint8Array): Promise<void> {
    if (!this.ready) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.loaded?.dispose();
    this.loaded = undefined;
    for (const control of [play, pause, stop, time]) control.disabled = true;
    status.textContent = 'Loading…';
    try {
      const options = {
        signal: request.signal,
        onCue: (cue: { name: string }) => {
          cues.textContent += `${cue.name}\n`;
        },
      };
      const loaded = zip
        ? await SceneLoader.loadPackage(this, zip, options)
        : await SceneLoader.load(this, new URL('scene.json', document.baseURI).href, options);
      if (request.signal.aborted) {
        loaded.dispose();
        return;
      }
      this.loaded = loaded;
      cues.textContent = '';
      time.max = String(loaded.runner.definition.duration);
      time.value = '0';
      for (const control of [play, pause, stop, time]) control.disabled = false;
      status.textContent = `Ready: ${loaded.runner.definition.id} / ${loaded.runner.actors.size} Actors`;
    } catch (error) {
      if (!request.signal.aborted) status.textContent = `Load failed: ${String(error)}`;
    }
  }
  command(kind: 'play' | 'pause' | 'stop'): void {
    this.loaded?.runner[kind]();
  }
  seek(value: number): void {
    this.loaded?.runner.seek(value);
  }
  update(_time: number, delta: number): void {
    const runner = this.loaded?.runner;
    if (!runner) return;
    runner.update(delta);
    time.value = String(runner.time);
    if (runner.status !== 'stopped')
      status.textContent = `${runner.definition.id}: ${runner.status} / ${Math.round(runner.time)} ms`;
  }
}
const scene = new AuthoredScene();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: 760,
  height: 640,
  backgroundColor: '#eee8dc',
  scene,
});
for (const [button, command] of [
  [play, 'play'],
  [pause, 'pause'],
  [stop, 'stop'],
] as const)
  button.addEventListener('click', () => scene.command(command), { signal: listeners.signal });
time.addEventListener('input', () => scene.seek(Number(time.value)), { signal: listeners.signal });
file.addEventListener(
  'change',
  () => {
    const selected = file.files?.[0];
    file.value = '';
    if (!selected) return;
    if (selected.size > 100 * 1024 * 1024) {
      status.textContent = 'Scene ZIP exceeds 100 MiB.';
      return;
    }
    void selected
      .arrayBuffer()
      .then((bytes) => scene.open(new Uint8Array(bytes)))
      .catch((error: unknown) => {
        status.textContent = `Load failed: ${String(error)}`;
      });
  },
  { signal: listeners.signal },
);
function dispose(): void {
  listeners.abort();
  game.scene.stop('authored-scene');
  game.destroy(true);
  for (const control of [play, pause, stop, time, file, cleanup]) control.disabled = true;
  status.textContent = 'Disposed';
}
cleanup.addEventListener('click', dispose, { signal: listeners.signal });
window.addEventListener('pagehide', dispose, { once: true, signal: listeners.signal });
