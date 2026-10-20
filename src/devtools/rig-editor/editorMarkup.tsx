import { ViewHeader } from '../../ui/viewShell.js';
import { openWorkspaceDialog, useWorkspaceInspector, WorkspaceDialog } from '../../ui/Workspace.js';
import type { ArtworkController } from '../shared/artwork/ArtworkController.js';
import { ArtworkPanel } from '../shared/artwork/ArtworkPanel.js';
import { GroundGuideControls } from '../shared/GroundGuideControls.js';
import type { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { PackageController } from '../shared/package/PackageController.js';
import { PackagePanel } from '../shared/package/PackagePanel.js';
import type { AttachmentController } from './AttachmentController.js';
import { AttachmentPanel } from './AttachmentPanel.js';
import { FootContactMarkersPanel } from './FootContactMarkersPanel.js';
import { RigHelp } from './RigHelp.js';
import { RigIKPanel } from './RigIKPanel.js';
import { RigStructurePanel } from './RigStructurePanel.js';

export function RigEditorView({
  artwork,
  attachments,
  packages,
  groundGuide,
  header = true,
}: {
  artwork?: ArtworkController;
  attachments?: AttachmentController;
  packages?: PackageController;
  groundGuide?: GroundGuideWorkspace;
  header?: boolean;
} = {}) {
  const inspector = useWorkspaceInspector();
  return (
    <>
      <ViewHeader view="rig" selectionId={header ? 'character-selection' : 'inactive-character-selection'} />
      <main className={`workspace-layout view-content ${inspector.open ? 'inspector-open' : ''}`}>
        {packages && <PackagePanel controller={packages} />}
        <section className="workspace-command-bar" aria-label="Rig session">
          <div className="rig-session-editing" role="group" aria-label="Rig editing controls">
            <label>
              Edit{' '}
              <select id="edit-mode" data-guide-id={GUIDE_TARGETS.rigEditMode}>
                <option value="joint">Joint Editing</option>
                <option value="sprite">Artwork Offset Editing</option>
                <option value="origin">Sprite Origin Editing</option>
                <option value="slot">Slot Transform Editing</option>
              </select>
            </label>
            <label>
              Grid{' '}
              <select id="grid-snap">
                <option value="0">Off</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="5">5</option>
                <option value="10">10</option>
              </select>
            </label>
            <label>
              Rotation snap{' '}
              <select id="rotation-snap">
                <option value="0">Off</option>
                <option value="1">1°</option>
                <option value="5">5°</option>
                <option value="15">15°</option>
              </select>
            </label>
            <span className="rig-history" data-guide-id={GUIDE_TARGETS.rigHistory}>
              <button id="undo" type="button" aria-keyshortcuts="Control+Z Meta+Z">
                Undo
              </button>
              <button id="redo" type="button" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">
                Redo
              </button>
            </span>
          </div>
          <div className="rig-session-actions" role="group" aria-label="Rig commands">
            <button
              id="rig-tools-open"
              data-guide-id={GUIDE_TARGETS.rigFileTools}
              type="button"
              aria-haspopup="dialog"
              onClick={() => openWorkspaceDialog('rig-tools-dialog')}
            >
              File tools
            </button>
            <button
              id="rig-help-open"
              type="button"
              aria-haspopup="dialog"
              onClick={() => openWorkspaceDialog('rig-help-dialog')}
            >
              Help
            </button>
            <button id="rig-reset-layout" type="button" onClick={inspector.reset}>
              Reset layout
            </button>
            <button
              ref={inspector.toggle}
              id="rig-inspector-toggle"
              className="workspace-inspector-toggle"
              type="button"
              aria-expanded={inspector.open}
              aria-controls="rig-inspector"
              onClick={inspector.toggleOpen}
            >
              Inspector
            </button>
            <div className="workspace-save">
              <button
                id="download-json"
                data-guide-id={GUIDE_TARGETS.rigDownload}
                className="workspace-primary"
                type="button"
              >
                Download rig.json
              </button>
            </div>
          </div>
          <div className="workspace-feedback">
            <span id="dirty-status" role="status" />
            <div id="validation" role="status" data-guide-id={GUIDE_TARGETS.rigValidation} />
            <div id="action-feedback" role="status" />
          </div>
          <div className="rig-recovery" role="group" aria-label="Rig draft recovery">
            <p id="rig-draft-status" role="status" />
            <button id="rig-download-retained-drafts" type="button" hidden>
              Download retained drafts
            </button>
          </div>
        </section>
        <aside
          ref={inspector.panel}
          id="rig-inspector"
          data-guide-inspector
          className="workspace-inspector inspector workspace-inspector-sections"
          inert={inspector.narrow && !inspector.open}
          aria-label="Selection inspector"
        >
          <div className="workspace-panel-heading">
            <h2>Inspector</h2>
            <button
              id="rig-inspector-close"
              className="workspace-inspector-close"
              type="button"
              onClick={inspector.close}
            >
              Close
            </button>
          </div>
          <details className="workspace-hierarchy" data-guide-id={GUIDE_TARGETS.rigHierarchy}>
            <summary>Hierarchy</summary>
            <div id="hierarchy" role="tree" />
            {attachments && <RigStructurePanel controller={attachments} />}
          </details>
          <details className="rig-selection-details" data-guide-id={GUIDE_TARGETS.rigSelection}>
            <summary>Selection details</summary>
            <section aria-label="Rig properties">
              <div id="inspector">Loading character…</div>
            </section>
          </details>
          {attachments && <RigIKPanel controller={attachments} />}
          {attachments && <FootContactMarkersPanel controller={attachments} />}
          {groundGuide && (
            <GroundGuideControls workspace={groundGuide} guideAnchors={false}>
              <p className="workspace-caption">
                Drag ↕ Ground in the preview to move the line. Escape cancels. Ground history is separate from rig
                edits.
              </p>
            </GroundGuideControls>
          )}
          {attachments && <AttachmentPanel controller={attachments} defaultOpen={false} />}
          {artwork && <ArtworkPanel controller={artwork} />}
          <details>
            <summary>Visibility</summary>
            <div id="visibility" />
            <label className="opacity-label">
              Artwork opacity{' '}
              <select id="opacity">
                <option value="1">100%</option>
                <option value="0.5">50%</option>
                <option value="0.25">25%</option>
              </select>
            </label>
          </details>
          <details>
            <summary>Session</summary>
            <div id="session-status" />
          </details>
          <details>
            <summary>Reset</summary>
            <div className="action-grid">
              <button id="reset-selected" type="button">
                Reset Selected
              </button>
              <button id="reset-rig" type="button">
                Reset Rig
              </button>
            </div>
          </details>
        </aside>
        <div
          id="rig-preview-divider"
          role="separator"
          tabIndex={0}
          aria-label="Rig preview width"
          aria-controls="editor-stage"
          aria-orientation="vertical"
          aria-valuemin={280}
          aria-valuemax={640}
          aria-valuenow={420}
          title="Drag to resize. Left/Right adjusts; Home/End selects the limits."
        />
        <section className="workspace-preview" aria-label="Rig preview">
          <div className="workspace-preview-options">
            <label>
              Facing{' '}
              <select id="rig-facing">
                <option value="right">Right</option>
                <option value="left">Left</option>
              </select>
            </label>
            <label>
              Pose{' '}
              <select id="rig-preview-pose" data-guide-id={GUIDE_TARGETS.rigPreviewPose}>
                <option value="">Bind pose</option>
              </select>
            </label>
            <label>
              Time (ms) <input id="rig-preview-time" type="number" step="any" min="0" defaultValue="0" />
            </label>
            <label>
              <input id="dim-selection" type="checkbox" /> Dim unselected artwork
            </label>
            <label data-guide-id={GUIDE_TARGETS.rigIKPreview}>
              <input id="ik-preview" type="checkbox" /> IK Preview
            </label>
          </div>
          <div id="rig-mode-hint" className="workspace-caption">
            Joint Editing · Wheel to zoom · Middle drag to pan
          </div>
          <div className="rig-preview-viewport">
            <div id="editor-stage" data-guide-id={GUIDE_TARGETS.rigCanvas} aria-label="Rig canvas" />
          </div>
        </section>
      </main>
      <WorkspaceDialog id="rig-tools-dialog" title="Rig file tools">
        <p>Export committed rig edits as JSON. Place the downloaded file in your character folder.</p>
        <div className="action-grid">
          <button id="validate-rig" type="button">
            Validate
          </button>
          <button id="copy-json" type="button">
            Copy rig JSON
          </button>
          <button id="log-json" type="button">
            Log rig JSON
          </button>
          <button id="reload-exported" type="button">
            Reload exported rig
          </button>
          <button id="reload-original" type="button">
            Reload original rig
          </button>
        </div>
        <label className="load-label">
          Load rig JSON <input id="load-json" type="file" accept=".json,application/json" />
        </label>
      </WorkspaceDialog>
      <WorkspaceDialog id="rig-help-dialog" title="Rig editor help">
        <RigHelp />
      </WorkspaceDialog>
    </>
  );
}
