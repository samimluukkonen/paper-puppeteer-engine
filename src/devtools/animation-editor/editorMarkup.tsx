import { ViewHeader } from '../../ui/viewShell.js';
import { useWorkspaceInspector } from '../../ui/Workspace.js';
import { AUTHORED_FPS_MAX, AUTHORED_FPS_MIN, PREVIEW_PLAYBACK_SPEEDS } from './AnimationEditorState.js';
import type { IKBakeController } from './IKBakeController.js';
import { IKBakePanel } from './IKBakePanel.js';
import type { IKInspectorController } from './IKInspectorController.js';
import { IKInspectorPanel } from './IKInspectorPanel.js';
import { AUTHORED_INTERPOLATION_MODES, interpolationLabel } from './interpolationPresentation.js';
import type { MirrorToolsController } from './MirrorToolsController.js';
import { MirrorToolsPanel } from './MirrorToolsPanel.js';

/** React owns the shell; the timeline and inspector controllers own their host regions. */
export function AnimationEditorView({
  mirrorTools,
  ikInspector,
  ikBake,
}: {
  mirrorTools: MirrorToolsController;
  ikInspector: IKInspectorController;
  ikBake: IKBakeController;
}) {
  const inspector = useWorkspaceInspector();
  const interpolationOptions = AUTHORED_INTERPOLATION_MODES.map((mode) => (
    <option key={mode} value={mode}>
      {interpolationLabel(mode)}
    </option>
  ));
  return (
    <>
      <ViewHeader view="animation" />

      <section className="animation-command-bar" aria-label="Animation session">
        <label>
          Animation <select id="animation-selection"></select>
        </label>
        <div className="animation-history">
          <button id="animation-undo" type="button" aria-keyshortcuts="Control+Z Meta+Z" title="Undo (Ctrl/Cmd+Z)">
            Undo
          </button>
          <button
            id="animation-redo"
            type="button"
            aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            Redo
          </button>
        </div>
        <details id="animation-clip-settings" className="animation-popover">
          <summary>Clip settings</summary>
          <div className="animation-popover-content">
            <div className="animation-settings" aria-label="Authored animation settings">
              <label>
                Mode{' '}
                <select id="animation-mode">
                  <option value="smooth">Smooth</option>
                  <option value="stepped">Stepped</option>
                </select>
              </label>
              <label>
                FPS{' '}
                <input
                  id="animation-fps"
                  type="number"
                  min={AUTHORED_FPS_MIN}
                  max={AUTHORED_FPS_MAX}
                  step="any"
                  aria-describedby="animation-settings-help"
                />
              </label>
            </div>
            <p id="animation-settings-help">
              Mode and FPS edit the working animation. FPS applies to stepped poses; key times stay unchanged.
            </p>
            <label>
              Clip interpolation{' '}
              <select id="animation-interpolation" aria-describedby="animation-interpolation-help" disabled>
                <option value="">Default (Linear)</option>
                {interpolationOptions}
              </select>
            </label>
            <p id="animation-interpolation-help">
              Applies to the whole clip. Default and explicit Linear evaluate identically. Smooth/stepped sampling uses
              Mode and FPS above.
            </p>

            <p id="animation-metadata"></p>
            <p id="animation-session-status"></p>
          </div>
        </details>
        <MirrorToolsPanel controller={mirrorTools} />
        <IKBakePanel controller={ikBake} />
        <button id="animation-tools-open" type="button" aria-haspopup="dialog">
          File tools
        </button>
        <button id="animation-help-open" type="button" aria-haspopup="dialog">
          Help
        </button>
        <button id="animation-reset-layout" type="button">
          Reset layout
        </button>
        <button
          ref={inspector.toggle}
          id="animation-inspector-toggle"
          type="button"
          aria-expanded={inspector.open}
          aria-controls="animation-inspector"
          onClick={inspector.toggleOpen}
        >
          Inspector
        </button>
        <div className="animation-save">
          <span id="animation-dirty" role="status"></span>
          <button
            id="animation-download"
            type="button"
            title="Download committed edits as JSON; move the file into your character folder"
          >
            Download JSON
          </button>
          <small>Saves an exported file</small>
        </div>
        <div className="animation-feedback">
          <p id="animation-status" role="status">
            Loading character…
          </p>
          <p id="animation-draft-status" role="status"></p>
          <button id="animation-download-retained-drafts" type="button" hidden>
            Download retained drafts
          </button>
          <p id="animation-export-feedback" role="status"></p>
          <p id="animation-import-feedback" role="status"></p>
        </div>
      </section>
      <main className={`animation-layout view-content ${inspector.open ? 'inspector-open' : ''}`}>
        <section className="animation-preview" aria-label="Animation preview">
          <div className="animation-preview-options">
            <label>
              Facing{' '}
              <select id="animation-facing">
                <option value="right">Right</option>
                <option value="left">Left</option>
              </select>
            </label>
            <label>
              <input id="animation-show-bones" type="checkbox" defaultChecked /> Show bones
            </label>
            <label>
              <input id="animation-onion-skinning" type="checkbox" /> Onion Skinning
            </label>
            <details className="animation-onion-settings">
              <summary>Onion settings</summary>
              <section className="animation-onion-panel" aria-label="Onion Skinning settings">
                <h2>Onion Skinning</h2>
                <label htmlFor="animation-onion-previous-count">Previous poses</label>
                <input id="animation-onion-previous-count" type="number" min="0" max="3" step="1" />
                <label htmlFor="animation-onion-next-count">Next poses</label>
                <input id="animation-onion-next-count" type="number" min="0" max="3" step="1" />
                <label htmlFor="animation-onion-spacing">Frame spacing</label>
                <input id="animation-onion-spacing" type="number" min="1" max="5" step="1" />
                <label htmlFor="animation-onion-previous-opacity">Previous opacity</label>
                <input id="animation-onion-previous-opacity" type="range" min="0.05" max="0.6" step="0.01" />
                <label htmlFor="animation-onion-next-opacity">Next opacity</label>
                <input id="animation-onion-next-opacity" type="range" min="0.05" max="0.6" step="0.01" />
                <label htmlFor="animation-onion-previous-color">Previous color</label>
                <input id="animation-onion-previous-color" type="color" />
                <label htmlFor="animation-onion-next-color">Next color</label>
                <input id="animation-onion-next-color" type="color" />
                <p>Set a pose count to zero to hide that direction. Spacing uses authored frames.</p>
                <p>Ghosts show authored poses before IK preview. They are read-only and never exported.</p>
              </section>
            </details>
            <label>
              <input id="animation-ik-preview" type="checkbox" /> IK preview (fixed targets)
            </label>
          </div>
          <div className="animation-preview-options">
            <label>
              <input id="animation-ik-handles" type="checkbox" defaultChecked /> Show IK targets
            </label>
            <label>
              <input id="animation-ik-drag" type="checkbox" defaultChecked /> Drag IK targets
            </label>
            <span>Wheel: zoom · Middle drag: pan · Crosshair: requested target</span>
          </div>
          <div id="animation-stage" aria-label="Puppet preview"></div>
        </section>
        <aside
          ref={inspector.panel}
          id="animation-inspector"
          className="animation-authoring"
          inert={inspector.narrow && !inspector.open}
          aria-label="Selection inspector"
        >
          <div className="animation-inspector-heading">
            <h2>Inspector</h2>
            <button id="animation-inspector-close" type="button" onClick={inspector.close}>
              Close
            </button>
          </div>
          <details className="animation-bone-list" open>
            <summary>Bones</summary>
            <div id="animation-bones" aria-label="Bone hierarchy"></div>
          </details>
          <IKInspectorPanel controller={ikInspector} />
          <section id="animation-bone-inspector" aria-label="Bone keyframing">
            <h2 id="animation-bone-title">Select a bone</h2>
            <fieldset id="animation-bone-fields" aria-label="Animated local transform"></fieldset>
            <button id="animation-cancel-transform" type="button">
              Cancel edits
            </button>
            <p className="animation-field-help">
              Yellow fields are temporary. Set Key commits that property at the playhead.
            </p>
          </section>
          <section id="animation-event-inspector" aria-label="Selected animation event" hidden>
            <h3>Event</h3>
            <label>
              Time (seconds) <input id="animation-event-time" type="number" min="0" step="any" />
            </label>
            <label>
              Name <input id="animation-event-name" type="text" required />
            </label>
            <div id="animation-event-payload">
              <label>
                Data (JSON; blank removes data){' '}
                <textarea
                  id="animation-event-data"
                  rows={4}
                  spellCheck="false"
                  aria-describedby="animation-event-help animation-event-error"
                ></textarea>
              </label>
            </div>
            <p id="animation-event-help">
              Commit on blur or Enter. JSON uses Ctrl/Cmd+Enter. Escape resets the field drafts.
            </p>
            <p id="animation-event-error" role="alert"></p>
            <button id="animation-delete-event" type="button" aria-keyshortcuts="Delete Backspace">
              Delete Event
            </button>
          </section>

          <details className="animation-key-details">
            <summary>Key details</summary>
            <div className="timeline-interpolation">
              <label>
                Selected key interpolation{' '}
                <select id="timeline-interpolation" aria-describedby="timeline-interpolation-help" disabled>
                  <option value="">—</option>
                  {interpolationOptions}
                </select>
              </label>
              <span id="timeline-interpolation-help">Select a key to inspect its outgoing interpolation.</span>
              <span className="timeline-interpolation-legend">◆ Linear outgoing segment · ◇ No outgoing segment</span>
            </div>
          </details>
        </aside>
        <div
          id="animation-workspace-divider"
          role="separator"
          tabIndex={0}
          aria-label="Preview and timeline size"
          aria-orientation="horizontal"
          aria-valuemin={25}
          aria-valuemax={70}
          aria-valuenow={58}
          title="Drag to resize. Up/Down adjusts; Home/End selects the limits."
        ></div>
        <section className="timeline-panel" aria-label="Animation timeline">
          <div className="timeline-toolbar">
            <h2>Timeline</h2>
            <button id="timeline-add-event" type="button">
              + Event
            </button>
            <output id="current-time" aria-label="Current time"></output>
            <label className="timeline-time-control">
              Time (s){' '}
              <input id="timeline-time-input" type="number" min="0" step="any" aria-label="Current time in seconds" />
            </label>
            <label id="timeline-frame-control" className="timeline-time-control" hidden>
              Frame <input id="timeline-frame-input" type="number" min="0" step="1" aria-label="Current frame" />
            </label>
            <button id="play-pause" type="button" aria-keyshortcuts="Space">
              Play
            </button>
            <button id="reset-time" type="button" aria-keyshortcuts="Home">
              Restart
            </button>
            <button id="preview-loop" type="button" aria-pressed="false">
              Loop preview
            </button>
            <label>
              Speed{' '}
              <select id="playback-speed" defaultValue="1">
                {PREVIEW_PLAYBACK_SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="timeline-key-commands" aria-label="Timeline commands">
            <button id="timeline-previous-key" type="button">
              Previous Key
            </button>
            <button id="timeline-next-key" type="button">
              Next Key
            </button>
            <button id="timeline-delete-key" type="button" aria-keyshortcuts="Delete Backspace">
              Delete Selected Keys
            </button>
            <button
              id="timeline-copy-keys"
              type="button"
              aria-keyshortcuts="Control+C Meta+C"
              title="Copy selected event or keys (Ctrl/Cmd+C in timeline)"
            >
              Copy Keys
            </button>
            <button
              id="timeline-paste-keys"
              type="button"
              aria-keyshortcuts="Control+V Meta+V"
              title="Paste at playhead (Ctrl/Cmd+V in timeline)"
            >
              Paste Keys
            </button>
            <button
              id="timeline-duplicate-keys"
              type="button"
              aria-keyshortcuts="Control+D Meta+D"
              title="Duplicate selected event or keys (Ctrl/Cmd+D in timeline)"
            >
              Duplicate Keys
            </button>
            <label>
              Snap{' '}
              <select id="timeline-snap">
                <option value="none">None</option>
                <option value="frame">Frame</option>
              </select>
            </label>
            <label>
              Zoom{' '}
              <select id="timeline-zoom">
                <option value="1">Fit</option>
                <option value="2">2×</option>
                <option value="4">4×</option>
                <option value="8">8×</option>
                <option value="16">16×</option>
                <option value="32">32×</option>
                <option value="64">64×</option>
                <option value="128">128×</option>
                <option id="timeline-custom-zoom" value="custom" hidden>
                  Custom
                </option>
              </select>
            </label>
            <details className="timeline-navigation-tools" open={!inspector.narrow}>
              <summary>Navigation</summary>
              <div className="timeline-navigation" aria-label="Timeline navigation">
                <button id="timeline-zoom-out" type="button" aria-label="Zoom out" aria-keyshortcuts="-">
                  −
                </button>
                <button id="timeline-zoom-in" type="button" aria-label="Zoom in" aria-keyshortcuts="+">
                  +
                </button>
                <button id="timeline-fit-animation" type="button" aria-keyshortcuts="F">
                  Fit Entire Animation
                </button>
                <button id="timeline-fit-selection" type="button">
                  Fit Selected Keyframes
                </button>
                <button id="timeline-center-playhead" type="button">
                  Center Playhead
                </button>
                <label>
                  <input id="timeline-follow" type="checkbox" defaultChecked /> Follow playhead
                </label>
              </div>
            </details>
          </div>
          <div className="timeline-track-controls" aria-label="Track navigation">
            <label>
              Search tracks{' '}
              <input
                id="timeline-search"
                type="search"
                placeholder="Bone, property, IK, events"
                aria-describedby="timeline-filter-status"
              />
            </label>
            <label>
              Tracks{' '}
              <select id="timeline-filter">
                <option value="all">Show All Tracks</option>
                <option value="keyed">Keyed Tracks Only</option>
                <option value="selected">Selected Target Only</option>
              </select>
            </label>
            <label>
              <input id="timeline-show-ik" type="checkbox" defaultChecked /> IK tracks
            </label>
            <label>
              <input id="timeline-show-events" type="checkbox" defaultChecked /> Event track
            </label>
            <button id="timeline-clear-filters" type="button">
              Clear Filters
            </button>
            <details className="timeline-expansion-controls" open={!inspector.narrow}>
              <summary>Expand / collapse</summary>
              <div>
                <button id="timeline-expand-all" type="button">
                  Expand All
                </button>
                <button id="timeline-collapse-all" type="button">
                  Collapse All
                </button>
                <button id="timeline-expand-selected" type="button">
                  Expand Selected
                </button>
              </div>
            </details>
            <button id="timeline-reveal-selection" type="button" hidden>
              Reveal Selection
            </button>
          </div>
          <p id="timeline-filter-status" role="status" hidden></p>
          <p id="timeline-selection-status" role="status" hidden></p>
          <p id="timeline-filter-empty" className="timeline-empty" hidden>
            No matching tracks. Clear Filters to show every track.
          </p>
          <div className="timeline-inset">
            <div className="timeline-label-column">
              <div
                id="timeline-label-divider"
                role="separator"
                tabIndex={0}
                aria-label="Track label width"
                aria-orientation="vertical"
                aria-valuemin={120}
                aria-valuemax={400}
                aria-valuenow={240}
                title="Drag or use Left/Right to resize track labels"
              ></div>
              <div className="timeline-label-heading">Events / bone / property</div>
              <div id="timeline-track-labels" aria-label="Timeline tracks"></div>
            </div>
            <div id="timeline" role="group" tabIndex={-1} aria-label="Animation keyframes">
              <div
                id="timeline-ruler"
                role="slider"
                tabIndex={0}
                aria-label="Animation time"
                aria-valuemin={0}
                aria-valuemax={0}
                aria-valuenow={0}
              ></div>
              <div id="timeline-tracks"></div>
              <div id="timeline-playhead" aria-hidden="true"></div>
            </div>
          </div>
        </section>
      </main>
      <dialog id="animation-tools-dialog" className="animation-dialog" aria-labelledby="animation-tools-title">
        <div className="animation-dialog-heading">
          <h2 id="animation-tools-title">Animation file tools</h2>
          <form method="dialog">
            <button type="submit">Close</button>
          </form>
        </div>
        <div className="animation-session">
          <p id="animation-file-export-feedback" role="status"></p>
          <div className="animation-history">
            <button id="animation-copy-json" type="button">
              Copy Animation JSON
            </button>
            <button id="animation-log-json" type="button">
              Log Animation JSON
            </button>
            <button id="animation-discard" type="button" title="Restore the last successful export checkpoint">
              Discard changes
            </button>
            <button
              id="animation-revert"
              type="button"
              title="Restore the loaded/imported source, including changes already exported"
            >
              Revert Animation
            </button>
          </div>
          <p>
            Exports contain committed keys, events, and settings. Temporary field edits are excluded. Successful copy,
            download, or log saves a clean session checkpoint and retains Undo/Redo; it does not write project files.
            Discard changes restores that checkpoint. Revert Animation restores the loaded/imported source and clears
            history. Place the exported file in your character folder using the filename referenced by its manifest.
          </p>
          <div className="animation-history">
            <button id="animation-import-paste" type="button">
              Import / Paste Animation JSON
            </button>
            <button id="animation-reload-export" type="button">
              Reload Current Export
            </button>
          </div>
          <label>
            Import local animation JSON{' '}
            <input
              id="animation-import-file"
              type="file"
              accept=".json,application/json"
              aria-describedby="animation-import-help"
            />
          </label>
          <section id="animation-import-panel" aria-label="Paste animation JSON" hidden>
            <label>
              Animation JSON{' '}
              <textarea
                id="animation-import-text"
                rows={10}
                spellCheck="false"
                aria-describedby="animation-import-help animation-file-import-feedback"
              ></textarea>
            </label>
            <div className="animation-history">
              <button id="animation-import-submit" type="button">
                Parse / Import
              </button>
              <button id="animation-import-cancel" type="button">
                Cancel
              </button>
            </div>
          </section>
          <p id="animation-file-import-feedback" role="status"></p>
          <p id="animation-import-help">
            Successful import replaces current edits with a clean session and clears Undo/Redo. Unsaved changes require
            confirmation. Download first to keep edits. Invalid or cancelled imports preserve the session. Reload
            Current Export exports committed data and imports it for a round-trip check, including edits since your last
            download.
          </p>
        </div>
      </dialog>
      <dialog id="animation-help-dialog" className="animation-dialog" aria-labelledby="animation-help-title">
        <div className="animation-dialog-heading">
          <h2 id="animation-help-title">Animation editor help</h2>
          <form method="dialog">
            <button type="submit">Close</button>
          </form>
        </div>
        <p>
          Mirror tools in the command bar configure reusable bone pairs and source/destination direction. Preview is
          read-only. M toggles preview with workspace focus; Escape in Mirror tools hides it. Mirror Current Pose uses
          the selected bone, or all mapped source bones when no bone is selected. Mirror Selected Keys requires every
          selected key to be on the chosen source side. Each commit is one Undo/Redo operation (Ctrl/Cmd+Z /
          Ctrl/Cmd+Shift+Z).
        </p>
        <p>
          Select a bone in the preview or hierarchy. Scrub to a time, enter a local value, then Set Key. Fields preview
          temporary values; scrubbing, changing selection, Play, settings changes, or Undo/Redo cancel drafts. Rotation
          is shown in degrees. Facing affects preview placement.
        </p>
        <p>
          To animate a reach, select an IK constraint, position its hand or foot crosshair at time zero, and choose Set
          Target Key. Move to 0.5 s, drag toward the object, and set another target key. X/Y use puppet-local
          coordinates; key Influence from 0 to 1 to blend with bone motion. Disable fixed-target IK preview to see
          authored targets. Dragging creates temporary values until committed. IK keys support single selection,
          deletion, arrow movement and Undo/Redo; group selection, clipboard and marker dragging are unavailable. Onion
          skins and bone mirroring use authored bone poses before IK. To bake an authored reach, open IK Baking, select
          constraints and sampling FPS, preview while scrubbing, then review the key summary and Bake IK. Baking creates
          one Undo operation. Turn off fixed-target IK preview before baking.
        </p>
        <p>
          Space plays or pauses. Home/End jumps to the start/end outside typing controls. Drag the ruler to scrub.
          Moving selected keys or events pauses playback. Use the timeline arrow keys to nudge; Shift moves ten steps.
        </p>
        <p>
          Collapsed bone diamonds summarize timing; expand the bone to edit individual keys. Search finds bone IDs,
          properties, IK targets and Events, keeping ancestors for context. Clear Filters restores your layout; Reveal
          Selection also opens selected tracks. Commands affect all selected keys, including hidden keys. Zoom reveals a
          horizontal scrollbar. Ctrl/Cmd + wheel zooms around the pointer; Shift + wheel pans horizontally. Zoom buttons
          use the playhead as an anchor. Fit Entire Animation shows the complete clip; Fit Selected Keyframes includes
          hidden selected keys. Center Playhead scrolls to the current time. Follow playhead scrolls near an edge during
          playback and can be disabled. Time (s) accepts continuous seconds; Frame uses zero-based authored FPS when
          present. In the timeline, +/− zooms, F fits the animation, and [ / ] selects the previous/next bone-property
          key. Reset layout restores panel sizes, all tracks, and Fit zoom.
        </p>
        <details className="timeline-instructions">
          <summary>Timeline controls</summary>
          <table aria-label="Timeline controls">
            <thead>
              <tr>
                <th scope="col">Control</th>
                <th scope="col">Behavior</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Ctrl/Cmd-click</th>
                <td>Add or remove a key; keep the primary key and playhead where possible.</td>
              </tr>
              <tr>
                <th scope="row">Shift-click</th>
                <td>Select a range on one property track; across tracks, add the clicked key.</td>
              </tr>
              <tr>
                <th scope="row">Drag empty lanes</th>
                <td>Select keys inside a rectangle. Ctrl/Cmd adds to selection.</td>
              </tr>
              <tr>
                <th scope="row">Drag an unselected key</th>
                <td>Select only this key and move its time.</td>
              </tr>
              <tr>
                <th scope="row">Drag a selected key</th>
                <td>Move the selection together, preserving spacing.</td>
              </tr>
              <tr>
                <th scope="row">Shift during key/event drag</th>
                <td>Bypass snapping.</td>
              </tr>
              <tr>
                <th scope="row">Escape</th>
                <td>Cancel a key/event drag or rectangle; otherwise clear timeline selection.</td>
              </tr>
              <tr>
                <th scope="row">Frame snap</th>
                <td>Use authored FPS (10 FPS for smooth clips).</td>
              </tr>
              <tr>
                <th scope="row">Left / Right Arrow</th>
                <td>
                  Nudge the selected event or keys in the tracks. When the ruler is focused, scrub time without editing
                  keys.
                </td>
              </tr>
              <tr>
                <th scope="row">Ruler Up / Down / Home / End</th>
                <td>Scrub forward/backward or jump to the start/end without editing selected keys.</td>
              </tr>
              <tr>
                <th scope="row">Shift + Arrow</th>
                <td>Nudge ten steps.</td>
              </tr>
              <tr>
                <th scope="row">Drag an event</th>
                <td>Move only its time; playhead follows. Same-time events remain separate.</td>
              </tr>
              <tr>
                <th scope="row">Move onto another key</th>
                <td>Replace the destination key on the same property.</td>
              </tr>
              <tr>
                <th scope="row">Delete / Backspace</th>
                <td>Remove the selected event or all selected keys outside inputs.</td>
              </tr>
              <tr>
                <th scope="row">Ctrl/Cmd + C / V</th>
                <td>
                  In the timeline, copy the selected event or keys. Paste the last copied content at the playhead. Event
                  data is preserved; key groups retain tracks and spacing and extend duration when needed.
                </td>
              </tr>
              <tr>
                <th scope="row">Ctrl/Cmd + D</th>
                <td>
                  Duplicate the selected event or keys by one authored frame, or the timeline nudge step for smooth
                  events. Events at the endpoint step backwards and same-time events stay separate. Key collisions
                  replace destination values.
                </td>
              </tr>
              <tr>
                <th scope="row">Click an empty area</th>
                <td>Clear key selection.</td>
              </tr>
            </tbody>
          </table>
        </details>
      </dialog>
    </>
  );
}
