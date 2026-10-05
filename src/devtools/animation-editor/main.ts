import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { viewHeader } from '../../ui/viewShell.js';
import { createEditorGame } from '../shared/editorGame.js';
import { AnimationEditorScene } from './AnimationEditorScene.js';
import { TimelineController } from './TimelineController.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#animation-editor-app');
if (!app) throw new Error('Missing animation editor host.');
app.classList.add('view-shell');
app.innerHTML = `
  ${viewHeader('animation')}
  <main class="animation-layout view-content">
    <section class="animation-preview"><div id="animation-stage" aria-label="Puppet preview"></div></section>
    <section class="animation-session" aria-label="Animation session"><h2>Animation</h2><label>Animation <select id="animation-selection"></select></label><p id="animation-metadata"></p><p id="animation-dirty"></p><p id="animation-status" role="status">Loading character…</p><p>Click or drag the timeline to preview the authored pose. Arrow keys move by 0.01 s; Shift moves by 0.1 s. Home / End jump to the endpoints.</p><p>Space plays or pauses. Restart returns to the start and preserves playback. Loop preview repeats the animation. Dragging suspends playback until release. Keyframe authoring will follow in later milestones.</p></section>
    <section class="timeline-panel" aria-label="Animation timeline"><div class="timeline-toolbar"><h2>Timeline</h2><output id="current-time" aria-label="Current time"></output><button id="play-pause" type="button" aria-keyshortcuts="Space">Play</button><button id="reset-time" type="button">Restart</button><button id="preview-loop" type="button" aria-pressed="false">Loop preview</button></div>
      <div class="timeline-inset"><div id="timeline" role="slider" tabindex="0" aria-label="Animation time" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div id="timeline-ruler" aria-hidden="true"></div><div class="timeline-tracks" aria-hidden="true"></div><div id="timeline-playhead" aria-hidden="true"></div></div></div>
    </section>
  </main>`;

const releaseCharacterSelection = bindCharacterSelection(app);
const timeline = new TimelineController(app);
const scene = new AnimationEditorScene(
  (state, id) => timeline.bind(state, id),
  (message) => timeline.showError(message),
  { characterUrl: `../characters/${selectedCharacterId()}/character.json` },
);
const game = createEditorGame('animation-stage', scene);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    timeline.dispose();
    releaseCharacterSelection();
    game.destroy(true);
  });
