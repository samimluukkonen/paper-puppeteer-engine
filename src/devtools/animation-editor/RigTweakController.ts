import type { AttachmentController } from '../rig-editor/AttachmentController.js';
import { RIG_IDS } from '../rig-editor/elementIds.js';
import { createHierarchyController } from '../rig-editor/HierarchyController.js';
import { createInspectorController } from '../rig-editor/InspectorController.js';
import type { RigEditor } from '../rig-editor/RigEditor.js';
import type { EditMode, GridSnap, RigEditorRecoverySnapshot, RotationSnap } from '../rig-editor/RigEditorState.js';
import { createSessionController } from '../rig-editor/SessionController.js';
import { DraftRecoveryControls } from '../shared/DraftRecoveryControls.js';
import { draftSource } from '../shared/draftSource.js';
import { requireElement } from '../shared/editorElements.js';
import { rigDraftKey } from '../shared/rigDraftSession.js';
import { Subscribers } from '../shared/subscriberNotifications.js';
import type { AnimationEditorScene } from './AnimationEditorScene.js';
import type { AnimationEditorState, EditorMode } from './AnimationEditorState.js';
import { ANIMATION_IDS, RIG_TWEAK_SESSION_IDS } from './elementIds.js';

interface RigTweakSnapshot {
  mode: EditorMode;
  ready: boolean;
  rigDirty: boolean;
  animationDirty: boolean;
}
const emptySnapshot: Readonly<RigTweakSnapshot> = Object.freeze({
  mode: 'animation',
  ready: false,
  rigDirty: false,
  animationDirty: false,
});
export const emptyRigTweakSnapshot = (): typeof emptySnapshot => emptySnapshot;
export const subscribeNoRigTweak = (): (() => void) => () => {};

/** Adapter for the existing rig tools. Animation and rig documents never share a history. */
export class RigTweakController {
  private state: AnimationEditorState | undefined;
  private editor: RigEditor | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly subscribers = new Subscribers({ label: 'Rig Tweak subscribers failed.' });
  private snapshot = emptySnapshot;
  private releaseUI: (() => void) | undefined;
  private renderUI: (() => void) | undefined;
  private bindDraft: (() => void) | undefined;
  private clearDraft: (() => void) | undefined;
  readonly subscribe = this.subscribers.subscribe;
  readonly getSnapshot = (): typeof emptySnapshot => this.snapshot;

  /**
   * @param options.projectHosted A project host keeps the authored rig, so rig-tweak drafts are not recovered
   *   locally.
   */
  constructor(
    private readonly attachments?: AttachmentController,
    private readonly options: { readonly projectHosted?: boolean } = {},
  ) {}

  setMode(mode: EditorMode): boolean {
    if (!this.state) return false;
    if (
      mode !== this.state.editorMode &&
      this.state.hasPendingAnimationEdits &&
      !window.confirm(
        'Discard uncommitted animation previews and change mode? Committed keys, rig edits and artwork will be kept.',
      )
    )
      return false;
    this.state.setEditorMode(mode);
    return true;
  }
  get hasUnsavedChanges(): boolean {
    return this.editor?.state.dirty ?? false;
  }

  initialize(app: HTMLElement, getScene: () => AnimationEditorScene): void {
    // The rig view shares this recovery; the character workspace renders it beside the animation view.
    const rigApp = requireElement(app.parentElement ?? document, RIG_IDS.app, HTMLElement);
    const recoveryControls = new DraftRecoveryControls<RigEditorRecoverySnapshot>(
      [
        requireElement(app, ANIMATION_IDS.tweakRigDraftStatus, HTMLElement),
        requireElement(rigApp, RIG_IDS.draftStatus, HTMLElement),
      ],
      [
        requireElement(app, ANIMATION_IDS.tweakRigDownloadRetainedDrafts, HTMLButtonElement),
        requireElement(rigApp, RIG_IDS.downloadRetainedDrafts, HTMLButtonElement),
      ],
      [
        requireElement(app, ANIMATION_IDS.tweakRigClearRetainedDrafts, HTMLButtonElement),
        requireElement(rigApp, RIG_IDS.clearRetainedDrafts, HTMLButtonElement),
      ],
    );
    const recovery = recoveryControls.recovery;
    const session = createSessionController(
      app,
      getScene,
      () => {
        recovery.update();
        this.publish();
      },
      {},
      {
        ids: RIG_TWEAK_SESSION_IDS,
        stageId: ANIMATION_IDS.stage,
        dirtyLabel: 'Rig',
        sessionFormat: 'table',
        hasPendingChanges: () => getScene().hasPendingArtworkProposal,
      },
    );
    const inspector = createInspectorController(
      requireElement(app, ANIMATION_IDS.tweakInspector, HTMLElement),
      session.updateStatus,
    );
    const hierarchy = createHierarchyController(requireElement(app, ANIMATION_IDS.tweakHierarchy, HTMLElement));
    const lifetime = new AbortController();
    for (const [id, setting] of [
      [ANIMATION_IDS.tweakEditMode, 'edit-mode'],
      [ANIMATION_IDS.tweakGridSnap, 'grid-snap'],
      [ANIMATION_IDS.tweakRotationSnap, 'rotation-snap'],
    ] as const) {
      requireElement(app, id, HTMLSelectElement).addEventListener(
        'change',
        (event) => {
          const editor = this.editor;
          if (!editor || this.state?.editorMode !== 'rig-tweak') return;
          editor.cancelGesture();
          const value = (event.target as HTMLSelectElement).value;
          if (setting === 'edit-mode') editor.state.editMode = value as EditMode;
          if (setting === 'grid-snap') editor.state.gridSnap = Number(value) as GridSnap;
          if (setting === 'rotation-snap') editor.state.rotationSnap = Number(value) as RotationSnap;
          editor.refresh();
        },
        { signal: lifetime.signal },
      );
    }
    this.renderUI = () => {
      const editor = this.editor;
      if (!editor) return;
      session.updateStatus(editor);
      if (this.state?.editorMode === 'rig-tweak') {
        inspector.render(editor);
        hierarchy.render(editor);
      }
      requireElement(app, ANIMATION_IDS.tweakEditMode, HTMLSelectElement).value = editor.state.editMode;
      requireElement(app, ANIMATION_IDS.tweakGridSnap, HTMLSelectElement).value = String(editor.state.gridSnap);
      requireElement(app, ANIMATION_IDS.tweakRotationSnap, HTMLSelectElement).value = String(editor.state.rotationSnap);
    };
    this.bindDraft = () => {
      if (this.options.projectHosted) return;
      const editor = this.editor;
      if (!editor) return;
      // Older draft identities stored name beside the rig. Preserve that source fingerprint format.
      const { name: _name, ...rig } = editor.state.workingCopy;
      recovery.bind({
        key: rigDraftKey(window.location.pathname, getScene().characterId, getScene().rigFilename),
        source: draftSource({
          name: editor.state.name,
          rig,
          standaloneSkins: editor.state.standaloneSkins,
        }),
        label: 'rig',
        snapshot: () => editor.state.recoverySnapshot,
        dirty: () => editor.state.dirty,
        committed: () => !editor.state.validationPending,
        data: (snapshot) => editor.state.createRecoveryDraft(snapshot),
        validate: (data) => editor.state.canRestoreDraft(data),
        restore: (data) => {
          const restored = editor.state.restoreDraft(data);
          if (restored) editor.refresh(false);
          return restored;
        },
      });
    };
    this.clearDraft = () => recovery.unbind();
    this.releaseUI = () => {
      lifetime.abort();
      recoveryControls.dispose();
      inspector.dispose();
      hierarchy.dispose();
      session.dispose();
    };
  }

  bind(state: AnimationEditorState, editor: RigEditor): void {
    this.unbind();
    this.state = state;
    this.editor = editor;
    this.unsubscribe = state.subscribe(() => {
      if (state.editorMode !== this.snapshot.mode) this.refresh();
      else this.publish();
    });
    this.bindDraft?.();
    this.refresh();
  }
  refresh(): void {
    if (this.editor) this.attachments?.bind(this.editor);
    this.renderUI?.();
    this.publish();
  }
  private publish(): void {
    const next = {
      mode: this.state?.editorMode ?? 'animation',
      ready: !!this.state,
      rigDirty: this.editor?.state.rigDirty ?? false,
      animationDirty: this.state?.dirty ?? false,
    };
    if (Object.keys(next).every((key) => next[key as keyof typeof next] === this.snapshot[key as keyof typeof next]))
      return;
    this.snapshot = Object.freeze(next);
    this.subscribers.notify();
  }
  unbind(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.clearDraft?.();
    this.state = undefined;
    this.editor = undefined;
    this.attachments?.unbind();
    this.publish();
  }
  dispose(): void {
    this.unbind();
    this.releaseUI?.();
    this.releaseUI = undefined;
    this.renderUI = undefined;
    this.bindDraft = undefined;
    this.clearDraft = undefined;
    this.subscribers.clear();
  }
}
