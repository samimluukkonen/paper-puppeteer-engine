/** Ids of the rig session controls; the rig editor and the animation editor's Rig Tweak panel each render a set. */
export interface RigSessionElementIds {
  readonly dirtyStatus: string;
  readonly sessionStatus: string;
  readonly validation: string;
  readonly actionFeedback: string;
  readonly undo: string;
  readonly redo: string;
  readonly resetSelected: string;
  readonly resetRig: string;
  readonly validateRig: string;
  readonly copyJson: string;
  readonly downloadJson: string;
  readonly logJson: string;
  readonly reloadExported: string;
  readonly reloadOriginal: string;
  readonly loadJson: string;
}

/**
 * Element ids the rig editor's controllers look up. The markup renders them from this table,
 * and `tests/editorElementIdContract.test.ts` checks that each one renders exactly once.
 * Ids that only a `<label htmlFor>` refers to stay literal in the markup.
 */
export const RIG_IDS = {
  // Workspace shell (the host is rendered by the character workspace in animation-editor/main.tsx)
  app: 'editor-app',
  stage: 'editor-stage',
  toolsOpen: 'rig-tools-open',
  modeHint: 'rig-mode-hint',
  previewDivider: 'rig-preview-divider',
  resetLayout: 'rig-reset-layout',
  rigInspector: 'rig-inspector',
  inspector: 'inspector',
  hierarchy: 'hierarchy',

  // Draft recovery
  draftStatus: 'rig-draft-status',
  downloadRetainedDrafts: 'rig-download-retained-drafts',
  clearRetainedDrafts: 'rig-clear-retained-drafts',

  // Editing and preview controls
  editMode: 'edit-mode',
  gridSnap: 'grid-snap',
  rotationSnap: 'rotation-snap',
  opacity: 'opacity',
  dimSelection: 'dim-selection',
  ikPreview: 'ik-preview',
  visibility: 'visibility',
  facing: 'rig-facing',
  previewPose: 'rig-preview-pose',
  previewTime: 'rig-preview-time',
  meshDiagnosticsStatus: 'rig-mesh-diagnostics-status',
} as const;

export const RIG_SESSION_IDS = {
  dirtyStatus: 'dirty-status',
  sessionStatus: 'session-status',
  validation: 'validation',
  actionFeedback: 'action-feedback',
  undo: 'undo',
  redo: 'redo',
  resetSelected: 'reset-selected',
  resetRig: 'reset-rig',
  validateRig: 'validate-rig',
  copyJson: 'copy-json',
  downloadJson: 'download-json',
  logJson: 'log-json',
  reloadExported: 'reload-exported',
  reloadOriginal: 'reload-original',
  loadJson: 'load-json',
} as const satisfies RigSessionElementIds;
