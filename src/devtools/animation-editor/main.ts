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
      <p id="animation-settings-help">Mode and FPS edit the working animation. FPS applies to stepped poses; key times stay unchanged.</p><div class="animation-history"><button id="animation-undo" type="button" aria-keyshortcuts="Control+Z Meta+Z" title="Undo (Ctrl/Cmd+Z)">Undo</button><button id="animation-redo" type="button" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button></div>
      <div class="animation-history"><button id="animation-download" type="button">Download animation JSON</button><button id="animation-discard" type="button">Discard changes</button></div><p id="animation-export-feedback" role="status"></p><p>Downloads contain committed keys and settings. Temporary field edits are excluded. Place the file in your character folder using the filename referenced by its manifest.</p>
      <p id="animation-metadata"></p><p id="animation-dirty"></p><p id="animation-status" role="status">Loading character…</p><p>Click the timeline or drag its ruler to preview the authored pose. Drag empty lanes to select keys. With one selected key, Arrow keys nudge its time; Shift moves ten steps. Multiple selected keys do not nudge. With no selected keys, arrows scrub by 0.01 s or 0.1 s with Shift. Home / End jump to the endpoints.</p><p>Space plays or pauses; Home returns to time zero outside typing controls. Restart returns to the start and preserves playback. Loop preview repeats the animation. Speed changes preview timing without editing animation data. Scrubbing suspends playback until release. Moving a key pauses playback. Download, discard, or undo authored changes before switching animations.</p></section>
    <section class="animation-authoring" aria-label="Bone keyframing"><div><h2>Bones</h2><div id="animation-bones" aria-label="Bone hierarchy"></div></div><div><h2 id="animation-bone-title">Select a bone</h2><fieldset id="animation-bone-fields" aria-label="Animated local transform"></fieldset><button id="animation-cancel-transform" type="button">Cancel edits</button><p>Fields preview temporary local values. Set Key commits only that property at the playhead; Delete Key removes only its current key. Rotation is shown in degrees. Editing pauses playback. Scrubbing, selecting another bone or animation, Play, settings changes, and undo/redo cancel drafts. IK and facing affect only the preview.</p></div></section>
    <section class="timeline-panel" aria-label="Animation timeline"><div class="timeline-toolbar"><h2>Timeline</h2><output id="current-time" aria-label="Current time"></output><button id="play-pause" type="button" aria-keyshortcuts="Space">Play</button><button id="reset-time" type="button" aria-keyshortcuts="Home">Restart</button><button id="preview-loop" type="button" aria-pressed="false">Loop preview</button><label>Speed <select id="playback-speed">${PREVIEW_PLAYBACK_SPEEDS.map((speed) => `<option value="${speed}"${speed === 1 ? ' selected' : ''}>${speed}×</option>`).join('')}</select></label></div>
      <div class="timeline-key-commands" aria-label="Keyframe commands"><button id="timeline-previous-key" type="button">Previous Key</button><button id="timeline-next-key" type="button">Next Key</button><button id="timeline-delete-key" type="button" aria-keyshortcuts="Delete Backspace">Delete Selected Keys</button><button id="timeline-copy-keys" type="button" aria-keyshortcuts="Control+C Meta+C" title="Copy selected keys (Ctrl/Cmd+C in timeline)">Copy Keys</button><button id="timeline-paste-keys" type="button" aria-keyshortcuts="Control+V Meta+V" title="Paste at playhead (Ctrl/Cmd+V in timeline)">Paste Keys</button><button id="timeline-duplicate-keys" type="button" aria-keyshortcuts="Control+D Meta+D" title="Duplicate selected keys (Ctrl/Cmd+D in timeline)">Duplicate Keys</button><label>Snap <select id="timeline-snap"><option value="none">None</option><option value="frame">Frame</option></select></label></div>
      <details class="timeline-instructions"><summary>Timeline controls</summary><table aria-label="Timeline controls"><thead><tr><th scope="col">Control</th><th scope="col">Behavior</th></tr></thead><tbody>
        <tr><th scope="row">Ctrl/Cmd-click</th><td>Add or remove a key; keep the primary key and playhead where possible.</td></tr>
        <tr><th scope="row">Shift-click</th><td>Select a range on one property track; across tracks, add the clicked key.</td></tr>
        <tr><th scope="row">Drag empty lanes</th><td>Select keys inside a rectangle. Ctrl/Cmd adds to selection.</td></tr>
        <tr><th scope="row">Drag a key</th><td>Select only this key and move its time.</td></tr>
        <tr><th scope="row">Shift during key drag</th><td>Bypass snapping.</td></tr>
        <tr><th scope="row">Escape</th><td>Cancel a key drag or rectangle; otherwise clear key selection.</td></tr>
        <tr><th scope="row">Frame snap</th><td>Use authored FPS (10 FPS for smooth clips).</td></tr>
        <tr><th scope="row">Left / Right Arrow</th><td>Nudge when exactly one key is selected.</td></tr>
        <tr><th scope="row">Shift + Arrow</th><td>Nudge ten steps.</td></tr>
        <tr><th scope="row">Move onto another key</th><td>Replace the destination key on the same property.</td></tr>
        <tr><th scope="row">Delete / Backspace</th><td>Remove all selected keys outside inputs.</td></tr>
        <tr><th scope="row">Ctrl/Cmd + C / V</th><td>In the timeline, copy selected keys or paste at the playhead, preserving tracks and spacing. Paste extends duration when needed.</td></tr>
        <tr><th scope="row">Ctrl/Cmd + D</th><td>In the timeline, duplicate by one authored frame, or 0.01 s for smooth clips. Collisions replace destination values.</td></tr>
        <tr><th scope="row">Click an empty area</th><td>Clear key selection.</td></tr>
      </tbody></table></details>
      <div class="timeline-inset"><div class="timeline-label-column"><div class="timeline-label-heading">Bone / property</div><div id="timeline-track-labels" aria-label="Timeline tracks"></div></div><div id="timeline" role="slider" tabindex="0" aria-label="Animation time" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div id="timeline-ruler" aria-hidden="true"></div><div id="timeline-tracks"></div><div id="timeline-playhead" aria-hidden="true"></div></div></div>
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
