import Phaser from 'phaser';
import packageInfo from '../../../package.json';
import { AnimationEditorScene } from './AnimationEditorScene.js';
import { TimelineController } from './TimelineController.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#animation-editor-app');
if (!app) throw new Error('Missing animation editor host.');
app.innerHTML = `
  <header class="animation-header"><div><nav><a href="../">← Engine demo</a> · <a href="../rig-editor/">Rig Editor</a></nav><h1>Animation Editor</h1><p id="character-status">Loading character…</p></div><span>v${packageInfo.version}</span></header>
  <div class="animation-layout">
    <section class="animation-preview"><div id="animation-stage" aria-label="Puppet preview"></div></section>
    <section class="animation-session" aria-label="Animation session"><h2>Animation</h2><label>Animation <select id="animation-selection"></select></label><p id="animation-metadata"></p><p id="animation-dirty"></p><p id="animation-status" role="status">Loading character…</p><p>Click or drag the timeline to preview the authored pose. Arrow keys move by 0.01 s; Shift moves by 0.1 s. Home / End jump to the endpoints.</p><p>Keyframe authoring and playback controls will follow in later milestones.</p></section>
    <section class="timeline-panel" aria-label="Animation timeline"><div class="timeline-toolbar"><h2>Timeline</h2><output id="current-time" aria-label="Current time"></output><button id="reset-time" type="button">Reset time</button></div>
      <div class="timeline-inset"><div id="timeline" role="slider" tabindex="0" aria-label="Animation time" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div id="timeline-ruler" aria-hidden="true"></div><div class="timeline-tracks" aria-hidden="true"></div><div id="timeline-playhead" aria-hidden="true"></div></div></div>
    </section>
  </div>`;

const timeline = new TimelineController(app);
const scene = new AnimationEditorScene(
  (state, id) => timeline.bind(state, id),
  (message) => timeline.showError(message),
);
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'animation-stage',
  width: 760,
  height: 640,
  transparent: true,
  render: { antialias: true, maxTextures: 1 },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [scene],
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    timeline.dispose();
    game.destroy(true);
  });
