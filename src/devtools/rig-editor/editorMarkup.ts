import { viewHeader } from '../../ui/viewShell.js';

/** Static page shell; controllers own its interactive regions. */
export function mountEditorMarkup(app: HTMLElement): void {
  app.classList.add('view-shell');
  app.innerHTML = `
  ${viewHeader('rig')}
  <main class="editor-layout view-content">
    <aside class="editor-panel"><h2>Hierarchy</h2><div id="hierarchy" role="tree"></div><h2>Editing</h2><div class="edit-controls"><label>Edit <select id="edit-mode"><option value="joint">Joint</option><option value="sprite">Sprite</option></select></label><label>Grid <select id="grid-snap"><option value="0">Off</option><option value="1">1</option><option value="2">2</option><option value="5">5</option><option value="10">10</option></select></label><label>Rotation snap <select id="rotation-snap"><option value="0">Off</option><option value="1">1°</option><option value="5">5°</option><option value="15">15°</option></select></label><label><input id="dim-selection" type="checkbox"> Dim unselected artwork</label><label><input id="ik-preview" type="checkbox"> IK Preview</label></div><h2>History and reset</h2><div class="action-grid"><button id="undo" type="button">Undo</button><button id="redo" type="button">Redo</button><button id="reset-selected" type="button">Reset Selected</button><button id="reset-rig" type="button">Reset Rig</button></div><h2>Visibility</h2><div id="visibility"></div><label class="opacity-label">Artwork opacity <select id="opacity"><option value="1">100%</option><option value="0.5">50%</option><option value="0.25">25%</option></select></label></aside>
    <section class="editor-center"><div id="editor-stage" aria-label="Rig canvas"></div><details class="shortcut-help"><summary>Controls and shortcuts</summary><div class="shortcut-table-wrap"><table><thead><tr><th scope="col">Action</th><th scope="col">Control</th></tr></thead><tbody>
      <tr><td>Select a bone or slot</td><td>Click the hierarchy or canvas; <kbd>Alt</kbd>+click prefers slots</td></tr>
      <tr><td>Move a joint or slot</td><td>Drag its canvas marker</td></tr>
      <tr><td>Edit artwork offset</td><td>Choose Sprite mode, then click and drag artwork; selecting its bone also works</td></tr>
      <tr><td>Nudge a joint</td><td>Arrow keys; hold <kbd>Shift</kbd> for larger steps</td></tr>
      <tr><td>Rotate a joint</td><td><kbd>,</kbd> / <kbd>.</kbd>; hold <kbd>Shift</kbd> for larger steps</td></tr>
      <tr><td>Undo / redo</td><td><kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> / <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td></tr>
      <tr><td>Snap translation / rotation</td><td>Use Grid / Rotation snap in the left panel</td></tr>
      <tr><td>Reset selected / rig</td><td>Use Reset Selected / Reset Rig in the left panel</td></tr>
      <tr><td>Validate / export</td><td>Use the buttons in the right panel</td></tr>
      <tr><td>Zoom / pan</td><td>Mouse wheel / middle-button drag</td></tr>
      <tr><td>Move the whole character</td><td>Left-button drag on the canvas background</td></tr>
    </tbody></table></div></details></section>
    <aside class="editor-panel inspector"><h2>Session</h2><div id="session-status"></div><p id="rig-draft-status" role="status"></p><h2>Inspector</h2><div id="inspector">Loading character…</div><h2>Validation and export</h2><div id="validation" role="status"></div><div class="action-grid"><button id="validate-rig" type="button">Validate</button><button id="copy-json" type="button">Copy rig JSON</button><button id="download-json" type="button">Download rig.json</button><button id="log-json" type="button">Log rig JSON</button><button id="reload-exported" type="button">Reload exported rig</button><button id="reload-original" type="button">Reload original rig</button></div><label class="load-label">Load rig JSON <input id="load-json" type="file" accept=".json,application/json"></label><div id="action-feedback" role="status"></div></aside>
  </main>`;
}
