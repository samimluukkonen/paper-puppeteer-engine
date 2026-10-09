import Phaser from 'phaser';
import { DemoScene } from './demo/DemoScene.js';
import { DemoUIStore } from './demo/DemoUIStore.js';
import { DemoView } from './demo/DemoView.js';
import { bindCharacterSelection, selectedCharacterId } from './ui/characterSelection.js';
import { mountView } from './ui/mountView.js';
import { observePreview } from './ui/observePreview.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing demo host.');
app.classList.add('view-shell', 'workspace-shell', 'demo-workspace');
const store = new DemoUIStore();
const unmount = mountView(
  app,
  <DemoView store={store} sketch={selectedCharacterId() === 'random-paperdoll-sketch'} />,
  (app) => {
    const releaseCharacterSelection = bindCharacterSelection(app);
    const demo = new DemoScene(store.update, `characters/${selectedCharacterId()}/character.json`);
    const releaseCommands = store.bind(demo);
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'stage',
      width: 760,
      height: 640,
      transparent: true,
      // Single-texture batches avoid cutout artifacts on software WebGL renderers.
      render: { antialias: true, roundPixels: false, maxTextures: 1 },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [demo],
    });
    const releaseResize = observePreview(app.querySelector<HTMLElement>('#stage')!, game);
    return () => {
      releaseResize();
      releaseCommands();
      releaseCharacterSelection();
      game.destroy(true);
    };
  },
);
if (import.meta.hot) import.meta.hot.dispose(unmount);
