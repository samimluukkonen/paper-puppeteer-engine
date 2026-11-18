import CircleHelp from 'lucide-react/icons/circle-help';
import Download from 'lucide-react/icons/download';
import Eye from 'lucide-react/icons/eye';
import FileJson from 'lucide-react/icons/file-json';
import Footprints from 'lucide-react/icons/footprints';
import Image from 'lucide-react/icons/image';
import Info from 'lucide-react/icons/info';
import Layers from 'lucide-react/icons/layers';
import LayoutTemplate from 'lucide-react/icons/layout-template';
import Link2 from 'lucide-react/icons/link-2';
import Network from 'lucide-react/icons/network';
import PanelRight from 'lucide-react/icons/panel-right';
import Redo2 from 'lucide-react/icons/redo-2';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Ruler from 'lucide-react/icons/ruler';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import Triangle from 'lucide-react/icons/triangle';
import Undo2 from 'lucide-react/icons/undo-2';
import type { ReactNode } from 'react';
import { EditorTabs } from '../../ui/EditorTabs.js';
import { EditorDraftControls, ViewHeader } from '../../ui/viewShell.js';
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
import { RIG_IDS, RIG_SESSION_IDS } from './elementIds.js';
import { FootContactMarkersPanel } from './FootContactMarkersPanel.js';
import { MeshGeometryPanel } from './MeshGeometryPanel.js';
import { RigHelp } from './RigHelp.js';
import { RigIKPanel } from './RigIKPanel.js';
import { RigStructurePanel } from './RigStructurePanel.js';

export function RigEditorView({
  artwork,
  attachments,
  packages,
  groundGuide,
  header = true,
  afterHeader,
}: {
  artwork?: ArtworkController;
  attachments?: AttachmentController;
  packages?: PackageController;
  groundGuide?: GroundGuideWorkspace;
  header?: boolean;
  afterHeader?: ReactNode;
} = {}) {
  const inspector = useWorkspaceInspector();
  return (
    <>
      <ViewHeader view="rig" selectionId={header ? 'character-selection' : 'inactive-character-selection'} />
      <main className={`workspace-layout view-content ${inspector.open ? 'inspector-open' : ''}`}>
        <EditorTabs
          label="Rig editor controls"
          tabs={[
            {
              id: 'rig-edit',
              label: 'Edit',
              icon: 'edit',
              content: (
                <section className="workspace-command-bar" aria-label="Rig session">
                  <div className="rig-session-editing" role="group" aria-label="Rig editing controls">
                    <label>
                      Edit{' '}
                      <select id={RIG_IDS.editMode} data-guide-id={GUIDE_TARGETS.rigEditMode}>
                        <option value="joint">Joint Editing</option>
                        <option value="mesh">Edit Mesh Geometry</option>
                        <option value="weights">Paint Bone Weights</option>
                        <option value="sprite">Artwork Offset Editing</option>
                        <option value="origin">Sprite Origin Editing</option>
                        <option value="slot">Slot Transform Editing</option>
                      </select>
                    </label>
                    <label>
                      Grid{' '}
                      <select id={RIG_IDS.gridSnap}>
                        <option value="0">Off</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="5">5</option>
                        <option value="10">10</option>
                      </select>
                    </label>
                    <label>
                      Rotation snap{' '}
                      <select id={RIG_IDS.rotationSnap}>
                        <option value="0">Off</option>
                        <option value="1">1°</option>
                        <option value="5">5°</option>
                        <option value="15">15°</option>
                      </select>
                    </label>
                    <span className="rig-history" data-guide-id={GUIDE_TARGETS.rigHistory}>
                      <button id={RIG_SESSION_IDS.undo} type="button" aria-keyshortcuts="Control+Z Meta+Z">
                        <Undo2 size={16} aria-hidden="true" />
                        Undo
                      </button>
                      <button id={RIG_SESSION_IDS.redo} type="button" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">
                        <Redo2 size={16} aria-hidden="true" />
                        Redo
                      </button>
                    </span>
                  </div>
                  <div className="rig-session-actions" role="group" aria-label="Rig commands">
                    <button
                      id={RIG_IDS.toolsOpen}
                      title="Open file tools for import and export (Ctrl/Cmd+S)"
                      data-guide-id={GUIDE_TARGETS.rigFileTools}
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => openWorkspaceDialog('rig-tools-dialog')}
                    >
                      <FileJson size={16} aria-hidden="true" />
                      File tools
                    </button>
                    <button
                      id="rig-help-open"
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => openWorkspaceDialog('rig-help-dialog')}
                    >
                      <CircleHelp size={16} aria-hidden="true" />
                      Help
                    </button>
                    <button id={RIG_IDS.resetLayout} type="button" onClick={inspector.reset}>
                      <LayoutTemplate size={16} aria-hidden="true" />
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
                      <PanelRight size={16} aria-hidden="true" />
                      Inspector
                    </button>
                    <div className="workspace-save">
                      <button
                        id={RIG_SESSION_IDS.downloadJson}
                        data-guide-id={GUIDE_TARGETS.rigDownload}
                        className="workspace-primary"
                        type="button"
                      >
                        <Download size={16} aria-hidden="true" />
                        Download rig.json
                      </button>
                    </div>
                  </div>
                  <div className="workspace-feedback">
                    <span id={RIG_SESSION_IDS.dirtyStatus} role="status" />
                    <div id={RIG_SESSION_IDS.validation} role="status" data-guide-id={GUIDE_TARGETS.rigValidation} />
                    <div id={RIG_SESSION_IDS.actionFeedback} role="status" />
                  </div>
                </section>
              ),
            },
            ...(packages
              ? [
                  {
                    id: 'rig-package',
                    label: 'Character package',
                    icon: 'package' as const,
                    content: <PackagePanel controller={packages} />,
                  },
                ]
              : []),
            {
              id: 'rig-draft',
              label: 'Local draft',
              icon: 'draft',
              content: (
                <>
                  <EditorDraftControls>{afterHeader}</EditorDraftControls>
                  <div className="rig-recovery" role="group" aria-label="Rig draft recovery">
                    <p id={RIG_IDS.draftStatus} role="status" />
                    <button id={RIG_IDS.downloadRetainedDrafts} className="workspace-primary" type="button" hidden>
                      Download retained drafts
                    </button>
                    <button
                      id={RIG_IDS.clearRetainedDrafts}
                      className="workspace-danger"
                      type="button"
                      title="Permanently delete retained browser drafts for this rig"
                      hidden
                    >
                      Clear retained drafts
                    </button>
                  </div>
                </>
              ),
            },
          ]}
        />
        <aside
          ref={inspector.panel}
          id={RIG_IDS.rigInspector}
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
          <EditorTabs
            label="Rig inspector sections"
            controlsLabel="inspector sections"
            wrap
            tabs={[
              {
                id: 'rig-inspector-hierarchy',
                label: 'Hierarchy',
                icon: Network,
                content: (
                  <div className="workspace-hierarchy" data-guide-id={GUIDE_TARGETS.rigHierarchy}>
                    <div id={RIG_IDS.hierarchy} role="tree" />
                    {attachments && <RigStructurePanel controller={attachments} />}
                  </div>
                ),
              },
              {
                id: 'rig-inspector-selection',
                label: 'Selection details',
                icon: SlidersHorizontal,
                content: (
                  <div className="rig-selection-details" data-guide-id={GUIDE_TARGETS.rigSelection}>
                    <section aria-label="Rig properties">
                      <div id={RIG_IDS.inspector}>Loading character…</div>
                    </section>
                  </div>
                ),
              },
              ...(attachments
                ? [
                    {
                      id: 'rig-inspector-ik',
                      label: 'IK constraints',
                      icon: Link2,
                      content: <RigIKPanel controller={attachments} embedded />,
                    },
                    {
                      id: 'rig-inspector-contact-markers',
                      label: 'Foot contact markers',
                      icon: Footprints,
                      content: <FootContactMarkersPanel controller={attachments} embedded />,
                    },
                  ]
                : []),
              ...(groundGuide
                ? [
                    {
                      id: 'rig-inspector-ground',
                      label: 'Ground reference',
                      icon: Ruler,
                      content: (
                        <GroundGuideControls workspace={groundGuide} guideAnchors="rig" embedded>
                          <p className="workspace-caption">
                            Drag ↕ Ground in the preview to move the line. Escape cancels. Ground history is separate
                            from rig edits.
                          </p>
                        </GroundGuideControls>
                      ),
                    },
                  ]
                : []),
              ...(attachments
                ? [
                    {
                      id: 'rig-inspector-mesh',
                      label: 'Mesh geometry',
                      icon: Triangle,
                      content: <MeshGeometryPanel controller={attachments} embedded />,
                    },
                    {
                      id: 'rig-inspector-attachments',
                      label: 'Attachments & skins',
                      icon: Layers,
                      content: <AttachmentPanel controller={attachments} meshAuthoring embedded />,
                    },
                  ]
                : []),
              ...(artwork
                ? [
                    {
                      id: 'rig-inspector-artwork',
                      label: 'Artwork import & replacement',
                      icon: Image,
                      content: <ArtworkPanel controller={artwork} embedded />,
                    },
                  ]
                : []),
              {
                id: 'rig-inspector-visibility',
                label: 'Visibility',
                icon: Eye,
                content: (
                  <>
                    <div id={RIG_IDS.visibility} />
                    <label className="opacity-label">
                      Artwork opacity{' '}
                      <select id={RIG_IDS.opacity}>
                        <option value="1">100%</option>
                        <option value="0.5">50%</option>
                        <option value="0.25">25%</option>
                      </select>
                    </label>
                  </>
                ),
              },
              {
                id: 'rig-inspector-session',
                label: 'Session',
                icon: Info,
                content: <div id={RIG_SESSION_IDS.sessionStatus} />,
              },
              {
                id: 'rig-inspector-reset',
                label: 'Reset',
                icon: RotateCcw,
                content: (
                  <div className="action-grid">
                    <button id={RIG_SESSION_IDS.resetSelected} type="button">
                      Reset Selected
                    </button>
                    <button id={RIG_SESSION_IDS.resetRig} type="button">
                      Reset Rig
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </aside>
        <div
          id={RIG_IDS.previewDivider}
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
              <select id={RIG_IDS.facing}>
                <option value="right">Right</option>
                <option value="left">Left</option>
              </select>
            </label>
            <label>
              Pose{' '}
              <select id={RIG_IDS.previewPose} data-guide-id={GUIDE_TARGETS.rigPreviewPose}>
                <option value="">Bind pose</option>
              </select>
            </label>
            <label>
              Time (ms) <input id={RIG_IDS.previewTime} type="number" step="any" min="0" defaultValue="0" />
            </label>
            <label>
              <input id={RIG_IDS.dimSelection} type="checkbox" /> Dim unselected artwork
            </label>
            <label data-guide-id={GUIDE_TARGETS.rigIKPreview}>
              <input id={RIG_IDS.ikPreview} type="checkbox" /> IK Preview
            </label>
          </div>
          <div id={RIG_IDS.modeHint} className="workspace-caption">
            Joint Editing · Wheel to zoom · Middle drag to pan
          </div>
          <div className="rig-preview-viewport">
            <div id={RIG_IDS.stage} data-guide-id={GUIDE_TARGETS.rigCanvas} aria-label="Rig canvas" />
          </div>
        </section>
      </main>
      <WorkspaceDialog id="rig-tools-dialog" title="Rig file tools">
        <p>Export committed rig edits as JSON. Place the downloaded file in your character folder.</p>
        <div className="action-grid">
          <button id={RIG_SESSION_IDS.validateRig} type="button">
            Validate
          </button>
          <button id={RIG_SESSION_IDS.copyJson} type="button">
            Copy rig JSON
          </button>
          <button id={RIG_SESSION_IDS.logJson} type="button">
            Log rig JSON
          </button>
          <button id={RIG_SESSION_IDS.reloadExported} type="button">
            Reload exported rig
          </button>
          <button id={RIG_SESSION_IDS.reloadOriginal} type="button">
            Reload original rig
          </button>
        </div>
        <label className="load-label">
          Load rig JSON <input id={RIG_SESSION_IDS.loadJson} type="file" accept=".json,application/json" />
        </label>
      </WorkspaceDialog>
      <WorkspaceDialog id="rig-help-dialog" title="Rig editor help">
        <RigHelp />
      </WorkspaceDialog>
    </>
  );
}
