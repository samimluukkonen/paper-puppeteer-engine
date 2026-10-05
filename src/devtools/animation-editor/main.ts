import { getDemoCharacterProfile } from '../../demo/demoCharacterProfiles.js';
import { bindCharacterSelection, selectedCharacterId } from '../../ui/characterSelection.js';
import { viewHeader } from '../../ui/viewShell.js';
import { createEditorGame } from '../shared/editorGame.js';
import { protectUnsavedChanges } from '../shared/protectUnsavedChanges.js';
import { AnimationEditorScene } from './AnimationEditorScene.js';
import { AUTHORED_FPS_MAX, AUTHORED_FPS_MIN, PREVIEW_PLAYBACK_SPEEDS } from './AnimationEditorState.js';
import { BoneInspectorController } from './BoneInspectorController.js';
import { TimelineController } from './TimelineController.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#animation-editor-app');
if (!app) throw new Error('Missing animation editor host.');
app.classList.add('view-shell');
app.innerHTML = `
  ${viewHeader('animation')}
  <main class="animation-layout view-content">
    <section class="animation-preview"><div class="animation-preview-options"><label>Facing <select id="animation-facing"><option value="right">Right</option><option value="left">Left</option></select></label><label><input id="animation-show-bones" type="checkbox" checked> Show bones</label><label><input id="animation-ik-preview" type="checkbox"> IK preview (fixed targets)</label></div><div id="animation-stage" aria-label="Puppet preview"></div></section>
    <section class="animation-session" aria-label="Animation session"><h2>Animation</h2><label>Animation <select id="animation-selection"></select></label>
      <div class="animation-settings" aria-label="Authored animation settings"><label>Mode <select id="animation-mode"><option value="smooth">Smooth</option><option value="stepped">Stepped</option></select></label><label>FPS <input id="animation-fps" type="number" min="${AUTHORED_FPS_MIN}" max="${AUTHORED_FPS_MAX}" step="any" aria-describedby="animation-settings-help"></label></div>
      <p id="animation-settings-help">Mode and FPS edit the working animation. FPS applies to stepped poses; key times stay unchanged.</p><div class="animation-history"><button id="animation-undo" type="button">Undo</button><button id="animation-redo" type="button">Redo</button></div>
      <p id="animation-metadata"></p><p id="animation-dirty"></p><p id="animation-status" role="status">Loading character…</p><p>Click or drag the timeline to preview the authored pose. Arrow keys move by 0.01 s; Shift moves by 0.1 s. Home / End jump to the endpoints.</p><p>Space plays or pauses; Home returns to time zero outside typing controls. Restart returns to the start and preserves playback. Loop preview repeats the animation. Speed changes preview timing without editing animation data. Dragging suspends playback until release. Undo authored changes before switching animations.</p></section>
    <section class="animation-authoring" aria-label="Bone keyframing"><div><h2>Bones</h2><div id="animation-bones" aria-label="Bone hierarchy"></div></div><div><h2 id="animation-bone-title">Select a bone</h2><fieldset id="animation-bone-fields" aria-label="Animated local transform"></fieldset><button id="animation-cancel-transform" type="button">Cancel edits</button><p>Fields preview temporary local values. Set Key commits only that property at the playhead; Delete Key removes only its current key. Rotation is shown in degrees. Editing pauses playback. Scrubbing, selecting another bone or animation, Play, settings changes, and undo/redo cancel drafts. IK and facing affect only the preview.</p></div></section>
    <section class="timeline-panel" aria-label="Animation timeline"><div class="timeline-toolbar"><h2>Timeline</h2><output id="current-time" aria-label="Current time"></output><button id="play-pause" type="button" aria-keyshortcuts="Space">Play</button><button id="reset-time" type="button" aria-keyshortcuts="Home">Restart</button><button id="preview-loop" type="button" aria-pressed="false">Loop preview</button><label>Speed <select id="playback-speed">${PREVIEW_PLAYBACK_SPEEDS.map((speed) => `<option value="${speed}"${speed === 1 ? ' selected' : ''}>${speed}×</option>`).join('')}</select></label></div>
      <div class="timeline-inset"><div id="timeline" role="slider" tabindex="0" aria-label="Animation time" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div id="timeline-ruler" aria-hidden="true"></div><div class="timeline-tracks" aria-hidden="true"></div><div id="timeline-playhead" aria-hidden="true"></div></div></div>
    </section>
  </main>`;

const releaseCharacterSelection = bindCharacterSelection(app);
const timeline = new TimelineController(app);
const inspector = new BoneInspectorController(app);
const releaseNavigationGuard = protectUnsavedChanges(() => timeline.hasUnsavedChanges);
const scene = new AnimationEditorScene(
  (state, id) => {
    timeline.bind(state, id);
    inspector.bind(state);
  },
  (message) => timeline.showError(message),
  {
    characterUrl: `../characters/${selectedCharacterId()}/character.json`,
    ikChains: getDemoCharacterProfile(selectedCharacterId()).ikChains,
  },
);
const previewControls = new AbortController();
app.querySelector<HTMLSelectElement>('#animation-facing')!.addEventListener(
  'change',
  (event) => {
    const facing = (event.target as HTMLSelectElement).value;
    if (facing === 'left' || facing === 'right') scene.setFacing(facing);
  },
  { signal: previewControls.signal },
);
app.querySelector<HTMLInputElement>('#animation-show-bones')!.addEventListener(
  'change',
  (event) => {
    scene.setBonesVisible((event.target as HTMLInputElement).checked);
  },
  { signal: previewControls.signal },
);
app.querySelector<HTMLInputElement>('#animation-ik-preview')!.addEventListener(
  'change',
  (event) => {
    scene.setIKPreview((event.target as HTMLInputElement).checked);
  },
  { signal: previewControls.signal },
);
const game = createEditorGame('animation-stage', scene);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    releaseNavigationGuard();
    timeline.dispose();
    inspector.dispose();
    previewControls.abort();
    releaseCharacterSelection();
    game.destroy(true);
  });
