import Phaser from 'phaser';
import type { DemoState } from './demo/DemoScene.js';
import { DemoScene } from './demo/DemoScene.js';
import { demoLimbColors } from './demo/demoLimbColors.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing demo host.');

app.innerHTML = `
  <header class="masthead">
    <a class="wordmark" href="./"><span class="mark" aria-hidden="true">✳</span> PAPER PUPPETEER <span class="wordmark-sub">ENGINE</span></a>
    <span class="version">v0.4.2 <span class="version-dot"></span> Skins & slots</span>
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
        <div class="button-pair">
          <button data-action="fadeIdle"><kbd>4</kbd> Fade to idle</button>
          <button data-action="fadeWalk"><kbd>5</kbd> Fade to walk</button>
        </div>
        <button class="wide-button" data-action="upperBody" aria-pressed="false"><span><kbd>L</kbd> Upper-body sword layer</span><span class="toggle" aria-hidden="true"></span></button>
      </div>
      <div class="control-section">
        <h2>02 <span>Playback</span></h2>
        <button class="wide-button" data-action="stepped" aria-pressed="false"><span><kbd>S</kbd> Smooth / stepped</span><span class="toggle" aria-hidden="true"></span></button>
        <div class="button-pair">
          <button data-action="fps8"><kbd>8</kbd> 8 FPS</button>
          <button data-action="fps10"><kbd>0</kbd> 10 FPS</button>
        </div>
        <button class="wide-button" data-action="pause" aria-pressed="false"><span><kbd>P</kbd> Pause / resume</span><span class="toggle" aria-hidden="true"></span></button>
        <div class="button-pair">
          <button data-action="slower"><kbd>[</kbd> Slower</button>
          <button data-action="faster"><kbd>]</kbd> Faster</button>
        </div>
      </div>
      <div class="control-section">
        <h2>03 <span>Direction</span></h2>
        <div class="button-pair">
          <button data-action="left" aria-pressed="false"><kbd>A</kbd> Left</button>
          <button data-action="right" aria-pressed="true"><kbd>D</kbd> Right</button>
        </div>
      </div>
      <div class="control-section">
        <h2>04 <span>Inspect the rig</span></h2>
        <button class="wide-button" data-action="debug" aria-pressed="false"><span><kbd>B</kbd> Bones & pivots</span><span class="toggle" aria-hidden="true"></span></button>
        <button class="wide-button" data-action="ikDebug" aria-pressed="false"><span><kbd>I</kbd> IK targets & chains</span><span class="toggle" aria-hidden="true"></span></button>
        <button class="wide-button" data-action="handIK" aria-pressed="false"><span><kbd>H</kbd> Mouse hand target</span><span class="toggle" aria-hidden="true"></span></button>
        <button class="wide-button" data-action="footIK" aria-pressed="false"><span><kbd>F</kbd> Plant feet while walking</span><span class="toggle" aria-hidden="true"></span></button>
        <button class="wide-button" data-action="prop" aria-pressed="true"><span><kbd>T</kbd> Katana</span><span class="toggle" aria-hidden="true"></span></button>
        <div class="button-pair">
          <button data-action="defaultSkin" aria-pressed="true"><kbd>K</kbd> Default skin</button>
          <button data-action="armoredSkin" aria-pressed="false"><kbd>M</kbd> Armor skin</button>
        </div>
        <button class="wide-button" data-action="gripHand" aria-pressed="false"><span><kbd>G</kbd> Grip hand</span><span class="toggle" aria-hidden="true"></span></button>
        <button class="wide-button" data-action="helmet" aria-pressed="false"><span><kbd>N</kbd> Headwear override</span><span class="toggle" aria-hidden="true"></span></button>
        <button class="wide-button" data-action="slotDebug" aria-pressed="false"><span><kbd>V</kbd> Slots</span><span class="toggle" aria-hidden="true"></span></button>
        <div class="button-pair">
          <button data-action="rotateLeft"><kbd>Q</kbd> Turn −</button>
          <button data-action="rotateRight"><kbd>E</kbd> Turn +</button>
        </div>
      </div>
      <p class="keyboard-note"><kbd>Space</kbd> stop / restart <span>·</span> <kbd>R</kbd> restart</p>
      <div class="status" aria-live="polite"><span class="status-dot"></span><span id="status-text">Current animation: idle</span></div>
    </aside>
    <div class="stage-wrap">
      <div class="stage" id="stage" aria-label="Paper Puppeteer Engine animation demo; move the mouse to aim the hand"></div>
      <aside class="limb-legend" aria-label="Limb colors">
        <h2>Limb colors</h2>
        <ul>${Object.values(demoLimbColors)
          .map(
            ({ label, color }) => `
          <li><span class="limb-swatch" style="--limb-color: #${color.toString(16).padStart(6, '0')}" aria-hidden="true"></span>${label}</li>
        `,
          )
          .join('')}</ul>
        <p>Colors follow each limb.</p>
      </aside>
      <div class="stage-caption"><span>THE PUPPET LAB</span><span>Mouse to aim · Q / E to turn</span></div>
    </div>
  </section>
  <footer><span>Paper Puppeteer Engine</span><span>Rigid cutouts / hierarchical transforms / endless possibilities</span></footer>
`;

function updateControls(state: DemoState): void {
  const pressed: Record<string, boolean> = {
    idle: state.animation === 'idle',
    walk: state.animation === 'walk',
    sword: state.animation === 'sword',
    left: state.facing === 'left',
    right: state.facing === 'right',
    debug: state.debug,
    prop: state.katanaVisible,
    handIK: state.handIK,
    footIK: state.footIK,
    ikDebug: state.ikDebug,
    stepped: state.playback === 'stepped',
    upperBody: state.upperBody,
    pause: state.paused,
    defaultSkin: state.skin === 'default',
    armoredSkin: state.skin === 'armored',
    gripHand: state.gripHand,
    helmet: state.helmet,
    slotDebug: state.slotDebug,
  };
  for (const [action, value] of Object.entries(pressed)) {
    document.querySelector(`[data-action="${action}"]`)?.setAttribute('aria-pressed', String(value));
  }
  const status = document.querySelector('#status-text');
  if (status)
    status.textContent = `Current: ${state.animation}${state.playing ? '' : ' (stopped)'}\nPlayback: ${state.playback}${state.playback === 'stepped' ? ` ${state.fps} FPS` : ''} · ${state.speed.toFixed(2)}x\nPaused: ${state.paused} · Upper body: ${state.upperBody ? `on (${state.layerWeight.toFixed(1)})` : 'off'}\nTransition: ${state.transition}\nEvent: ${state.lastEvent}`;
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
  idle: () => demo.play('idle'),
  walk: () => demo.play('walk'),
  sword: () => demo.play('sword'),
  fadeIdle: () => demo.crossfade('idle'),
  fadeWalk: () => demo.crossfade('walk'),
  stepped: () => demo.toggleStepped(),
  fps8: () => demo.setSteppedFPS(8),
  fps10: () => demo.setSteppedFPS(10),
  pause: () => demo.togglePause(),
  slower: () => demo.adjustSpeed(-0.25),
  faster: () => demo.adjustSpeed(0.25),
  upperBody: () => demo.toggleUpperBody(),
  left: () => demo.face('left'),
  right: () => demo.face('right'),
  debug: () => demo.toggleDebug(),
  prop: () => demo.toggleProp(),
  handIK: () => demo.toggleHandIK(),
  footIK: () => demo.toggleFootIK(),
  ikDebug: () => demo.toggleIKDebug(),
  defaultSkin: () => demo.setSkin('default'),
  armoredSkin: () => demo.setSkin('armored'),
  gripHand: () => demo.toggleGripHand(),
  helmet: () => demo.toggleHelmet(),
  slotDebug: () => demo.toggleSlotDebug(),
  rotateLeft: () => demo.rotateKatana(-0.15),
  rotateRight: () => demo.rotateKatana(0.15),
};
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action) actions[action]?.();
  });
}

if (import.meta.hot) import.meta.hot.dispose(() => game.destroy(true));
