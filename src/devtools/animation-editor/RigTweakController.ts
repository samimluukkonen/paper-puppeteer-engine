import { dispatchListeners, throwNotificationErrors } from '../../engine/notifications.js';
import { createHierarchyController } from '../rig-editor/HierarchyController.js';
import { createInspectorController } from '../rig-editor/InspectorController.js';
import type { RigEditor } from '../rig-editor/RigEditor.js';
import type { EditMode, GridSnap, RigEditorRecoverySnapshot, RotationSnap } from '../rig-editor/RigEditorState.js';
import { createSessionController } from '../rig-editor/SessionController.js';
import { DraftRecoveryControls } from '../shared/DraftRecoveryControls.js';
import { draftSource } from '../shared/draftSource.js';
import { rigDraftKey } from '../shared/rigDraftSession.js';
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
  private readonly listeners = new Set<() => void>();
  private snapshot = emptySnapshot;
  private releaseUI: (() => void) | undefined;
  private renderUI: (() => void) | undefined;
  private bindDraft: (() => void) | undefined;
  private clearDraft: (() => void) | undefined;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): typeof emptySnapshot => this.snapshot;

  setMode(mode: EditorMode): void {
    this.state?.setEditorMode(mode);
  }
  get hasUnsavedChanges(): boolean {
    return this.editor?.state.dirty ?? false;
  }

  initialize(app: HTMLElement, getScene: () => AnimationEditorScene): void {
    const recoveryControls = new DraftRecoveryControls<RigEditorRecoverySnapshot>(
      app.querySelector<HTMLElement>('#rig-draft-status')!,
      app.querySelector<HTMLButtonElement>('#rig-download-retained-drafts')!,
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
      { stageSelector: '#animation-stage', dirtyLabel: 'Rig' },
    );
    const inspector = createInspectorController(app.querySelector<HTMLElement>('#inspector')!, session.updateStatus);
    const hierarchy = createHierarchyController(app.querySelector<HTMLElement>('#hierarchy')!);
    const lifetime = new AbortController();
    for (const id of ['edit-mode', 'grid-snap', 'rotation-snap'] as const) {
      app.querySelector<HTMLSelectElement>(`#${id}`)!.addEventListener(
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
      app.querySelector<HTMLSelectElement>('#edit-mode')!.value = editor.state.editMode;
      app.querySelector<HTMLSelectElement>('#grid-snap')!.value = String(editor.state.gridSnap);
      app.querySelector<HTMLSelectElement>('#rotation-snap')!.value = String(editor.state.rotationSnap);
    };
    this.bindDraft = () => {
      const editor = this.editor;
      if (!editor) return;
      recovery.bind({
        key: rigDraftKey(window.location.pathname, getScene().characterId, getScene().rigFilename),
        source: draftSource({ name: editor.state.name, rig: editor.state.workingCopy }),
        label: 'rig',
        snapshot: () => editor.state.recoverySnapshot,
        dirty: () => editor.state.dirty,
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
    this.renderUI?.();
    this.publish();
  }
  private publish(): void {
    const next = {
      mode: this.state?.editorMode ?? 'animation',
      ready: !!this.state,
      rigDirty: this.editor?.state.dirty ?? false,
      animationDirty: this.state?.dirty ?? false,
    };
    if (Object.keys(next).every((key) => next[key as keyof typeof next] === this.snapshot[key as keyof typeof next]))
      return;
    this.snapshot = Object.freeze(next);
    throwNotificationErrors(
      dispatchListeners(this.listeners, (listener) => listener()),
      'Rig Tweak subscribers failed.',
    );
  }
  unbind(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.clearDraft?.();
    this.state = undefined;
    this.editor = undefined;
    this.publish();
  }
  dispose(): void {
    this.unbind();
    this.releaseUI?.();
    this.releaseUI = undefined;
    this.renderUI = undefined;
    this.bindDraft = undefined;
    this.clearDraft = undefined;
    this.listeners.clear();
  }
}
