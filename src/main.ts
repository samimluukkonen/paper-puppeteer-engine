import Phaser from 'phaser';
import { DemoScene } from './demo/DemoScene.js';
import type { DemoState } from './demo/DemoScene.js';
import { demoLimbColors } from './demo/demoLimbColors.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing demo host.');

app.innerHTML = `
  <header class="masthead">
    <a class="wordmark" href="./"><span class="mark" aria-hidden="true">✳</span> PAPER PUPPETEER <span class="wordmark-sub">ENGINE</span></a>
    <span class="version">IK <span class="version-dot"></span> Motion study</span>
  </header>
  <section class="workbench">
    <aside class="controls" aria-label="Animation controls">
      <p class="eyebrow">A LITTLE THEATRE OF TRANSFORMS</p>
      <h1>Paper pieces.<br>Living joints.</h1>
      <p class="intro">Move a hand target, plant the feet, and turn a katana held with two hands.</p>
      <div class="control-section">
        <h2>01 <span>Animation</span></h2>
        <div class="button-pair">
          <button data-action="idle" aria-pressed="true"><kbd>1</kbd> Idle</button>
          <button data-action="walk" aria-pressed="false"><kbd>2</kbd> Walk</button>
        </div>
        <button class="wide-button" data-action="sword" aria-pressed="false"><span><kbd>3</kbd> Two-handed katana</span><span class="toggle" aria-hidden="true"></span></button>
      </div>
      <div class="control-section">
        <h2>02 <span>Direction</span></h2>
        <div class="button-pair">
          <button data-action="left" aria-pressed="false"><kbd>A</kbd> Left</button>
          <button data-action="right" aria-pressed="true"><kbd>D</kbd> Right</button>
        </div>
      </div>
      <div class="control-section">
        <h2>03 <span>Inspect the rig</span></h2>
        <button class="wide-button" data-action="debug" aria-pressed="false"><span><kbd>B</kbd> Bones & pivots</span><span class="toggle" aria-hidden="true"></span></button>
        <button class="wide-button" data-action="ikDebug" aria-pressed="false"><span><kbd>I</kbd> IK targets & chains</span><span class="toggle" aria-hidden="true"></span></button>
        <button class="wide-button" data-action="handIK" aria-pressed="false"><span><kbd>H</kbd> Mouse hand target</span><span class="toggle" aria-hidden="true"></span></button>
        <button class="wide-button" data-action="footIK" aria-pressed="false"><span><kbd>F</kbd> Plant the feet</span><span class="toggle" aria-hidden="true"></span></button>
        <button class="wide-button" data-action="prop" aria-pressed="true"><span><kbd>P</kbd> Katana attachment</span><span class="toggle" aria-hidden="true"></span></button>
        <div class="button-pair">
          <button data-action="rotateLeft"><kbd>Q</kbd> Turn −</button>
          <button data-action="rotateRight"><kbd>E</kbd> Turn +</button>
        </div>
      </div>
      <p class="keyboard-note"><kbd>Space</kbd> stop / restart <span>·</span> <kbd>R</kbd> restart</p>
      <div class="status" aria-live="polite"><span class="status-dot"></span><span id="status-text">Current animation: idle</span></div>
    </aside>
    <div class="stage-wrap">
      <div class="stage" id="stage" aria-label="Paper Puppeteer Engine IK demo; move the mouse to aim the hand"></div>
      <aside class="limb-legend" aria-label="Limb colors">
        <h2>Limb colors</h2>
        <ul>${Object.values(demoLimbColors).map(({ label, color }) => `
          <li><span class="limb-swatch" style="--limb-color: #${color.toString(16).padStart(6, '0')}" aria-hidden="true"></span>${label}</li>
        `).join('')}</ul>
        <p>Colors follow each limb.</p>
      </aside>
      <div class="stage-caption"><span>THE PUPPET LAB</span><span>Mouse to aim · Q / E to turn</span></div>
    </div>
  </section>
  <footer><span>Paper Puppeteer Engine</span><span>Rigid cutouts / hierarchical transforms / endless possibilities</span></footer>
`;

function updateControls(state: DemoState): void {
  const pressed: Record<string, boolean> = {
    idle: state.animation === 'idle', walk: state.animation === 'walk', sword: state.animation === 'sword',
    left: state.facing === 'left', right: state.facing === 'right',
    debug: state.debug, prop: state.attached,
    handIK: state.handIK, footIK: state.footIK, ikDebug: state.ikDebug,
  };
  for (const [action, value] of Object.entries(pressed)) {
    document.querySelector(`[data-action="${action}"]`)?.setAttribute('aria-pressed', String(value));
  }
  const status = document.querySelector('#status-text');
  if (status) status.textContent = `Current animation: ${state.animation}${state.playing ? '' : ' (stopped)'}`;
  document.querySelector('.status-dot')?.classList.toggle('stopped', !state.playing);
}

const demo = new DemoScene(updateControls);
export const game = new Phaser.Game({
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

const actions: Record<string, () => void> = {
  idle: () => demo.play('idle'), walk: () => demo.play('walk'),
  sword: () => demo.play('sword'),
  left: () => demo.face('left'), right: () => demo.face('right'),
  debug: () => demo.toggleDebug(), prop: () => demo.toggleProp(),
  handIK: () => demo.toggleHandIK(), footIK: () => demo.toggleFootIK(), ikDebug: () => demo.toggleIKDebug(),
  rotateLeft: () => demo.rotateKatana(-0.15), rotateRight: () => demo.rotateKatana(0.15),
};
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
  button.addEventListener('click', () => {
    const action = button.dataset['action'];
    if (action) actions[action]?.();
  });
}

if (import.meta.hot) import.meta.hot.dispose(() => game.destroy(true));
