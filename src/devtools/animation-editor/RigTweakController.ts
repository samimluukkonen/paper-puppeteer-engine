import { projectEditorContext } from '../project/projectBridge.js';
import type { AttachmentController } from '../rig-editor/AttachmentController.js';
import { createHierarchyController } from '../rig-editor/HierarchyController.js';
import { createInspectorController } from '../rig-editor/InspectorController.js';
import type { RigEditor } from '../rig-editor/RigEditor.js';
import type { EditMode, GridSnap, RigEditorRecoverySnapshot, RotationSnap } from '../rig-editor/RigEditorState.js';
import { createSessionController } from '../rig-editor/SessionController.js';
import { DraftRecoveryControls } from '../shared/DraftRecoveryControls.js';
import { draftSource } from '../shared/draftSource.js';
import { rigDraftKey } from '../shared/rigDraftSession.js';
import { Subscribers } from '../shared/subscriberNotifications.js';
import type { AnimationEditorScene } from './AnimationEditorScene.js';
import type { AnimationEditorState, EditorMode } from './AnimationEditorState.js';

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

  constructor(private readonly attachments?: AttachmentController) {}

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
    const recoveryControls = new DraftRecoveryControls<RigEditorRecoverySnapshot>(
      [
        app.querySelector<HTMLElement>('#tweak-rig-draft-status')!,
        ...Array.from(app.parentElement?.querySelectorAll<HTMLElement>('#editor-app #rig-draft-status') ?? []),
      ],
      [
        app.querySelector<HTMLButtonElement>('#tweak-rig-download-retained-drafts')!,
        ...Array.from(
          app.parentElement?.querySelectorAll<HTMLButtonElement>('#editor-app #rig-download-retained-drafts') ?? [],
        ),
      ],
      [
        app.querySelector<HTMLButtonElement>('#tweak-rig-clear-retained-drafts')!,
        ...Array.from(
          app.parentElement?.querySelectorAll<HTMLButtonElement>('#editor-app #rig-clear-retained-drafts') ?? [],
        ),
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
        idPrefix: 'tweak-',
        stageSelector: '#animation-stage',
        dirtyLabel: 'Rig',
        sessionFormat: 'table',
        hasPendingChanges: () => getScene().hasPendingArtworkProposal,
      },
    );
    const inspector = createInspectorController(
      app.querySelector<HTMLElement>('#tweak-inspector')!,
      session.updateStatus,
    );
    const hierarchy = createHierarchyController(app.querySelector<HTMLElement>('#tweak-hierarchy')!);
    const lifetime = new AbortController();
    for (const id of ['edit-mode', 'grid-snap', 'rotation-snap'] as const) {
      app.querySelector<HTMLSelectElement>(`#tweak-${id}`)!.addEventListener(
        'change',
        (event) => {
          const editor = this.editor;
          if (!editor || this.state?.editorMode !== 'rig-tweak') return;
          editor.cancelGesture();
          const value = (event.target as HTMLSelectElement).value;
          if (id === 'edit-mode') editor.state.editMode = value as EditMode;
          if (id === 'grid-snap') editor.state.gridSnap = Number(value) as GridSnap;
          if (id === 'rotation-snap') editor.state.rotationSnap = Number(value) as RotationSnap;
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
      app.querySelector<HTMLSelectElement>('#tweak-edit-mode')!.value = editor.state.editMode;
      app.querySelector<HTMLSelectElement>('#tweak-grid-snap')!.value = String(editor.state.gridSnap);
      app.querySelector<HTMLSelectElement>('#tweak-rotation-snap')!.value = String(editor.state.rotationSnap);
    };
    this.bindDraft = () => {
      if (projectEditorContext()) return;
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
