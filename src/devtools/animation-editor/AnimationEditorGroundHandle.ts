import type Phaser from 'phaser';
import { editorWorldViewport } from '../shared/editorCamera.js';
import { groundGuideHandleHit } from '../shared/groundGuide.js';
import type { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import type { AnimationEditorState } from './AnimationEditorState.js';

/** Shared character-workspace ground-label gesture. Rig/animation drafts and the clock stay untouched. */
export class AnimationEditorGroundHandle {
  private pointerId: number | undefined;
  private offset = 0;
  private disposed = false;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeGuide: () => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly workspace: GroundGuideWorkspace,
    private readonly state: AnimationEditorState,
  ) {
    scene.input.on('pointermove', this.move);
    scene.input.on('pointerup', this.up);
    scene.input.on('pointerupoutside', this.up);
    window.addEventListener?.('keydown', this.keyDown, true);
    window.addEventListener?.('blur', this.cancel);
    window.addEventListener?.('pagehide', this.cancel);
    window.addEventListener?.('visibilitychange', this.visibilityChanged, true);
    let animation = state.selectedAnimationId;
    let revision = state.sessionRevision;
    let mode = state.editorMode;
    this.unsubscribe = state.subscribe(() => {
      if (mode !== state.editorMode || animation !== state.selectedAnimationId || revision !== state.sessionRevision)
        this.cancel();
      animation = state.selectedAnimationId;
      revision = state.sessionRevision;
      mode = state.editorMode;
    });
    this.unsubscribeGuide = workspace.subscribe(() => {
      if (!workspace.getSnapshot().dragging) this.pointerId = undefined;
    });
  }

  private world(pointer: Phaser.Input.Pointer) {
    const camera = this.scene.cameras.main;
    const view = editorWorldViewport(camera);
    return view
      ? {
          x: view.left + (pointer.x - (camera.x ?? 0)) / camera.zoom,
          y: view.top + (pointer.y - (camera.y ?? 0)) / camera.zoom,
        }
      : undefined;
  }

  pointerDown(pointer: Phaser.Input.Pointer): boolean {
    if (this.disposed) return false;
    if (this.pointerId !== undefined) return true;
    if (
      pointer.button !== 0 ||
      this.state.ik.ikTargetDrag ||
      this.state.keyframeDrag ||
      this.state.eventDrag ||
      this.state.isScrubbing
    )
      return false;
    const world = this.world(pointer);
    const guide = this.workspace.getSnapshot().guide;
    if (!world || !groundGuideHandleHit(guide, this.scene.cameras.main, world)) return false;
    this.offset = guide.y - world.y;
    if (!this.workspace.beginDrag()) return false;
    this.pointerId = pointer.id;
    return true;
  }

  get dragging(): boolean {
    return this.pointerId !== undefined;
  }

  private move = (pointer: Phaser.Input.Pointer): void => {
    if (this.disposed || pointer.id !== this.pointerId) return;
    const world = this.world(pointer);
    if (world) this.workspace.previewDrag(world.y + this.offset);
    else this.cancel();
  };
  private up = (pointer: Phaser.Input.Pointer): void => {
    if (this.disposed || pointer.id !== this.pointerId) return;
    this.move(pointer);
    this.pointerId = undefined;
    this.workspace.endDrag();
  };
  private cancel = (): void => {
    this.pointerId = undefined;
    this.workspace.cancelDrag();
  };
  private visibilityChanged = (): void => {
    if (document.visibilityState === 'hidden') this.cancel();
  };
  private keyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || this.pointerId === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  };
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
    this.unsubscribeGuide();
    this.scene.input.off('pointermove', this.move);
    this.scene.input.off('pointerup', this.up);
    this.scene.input.off('pointerupoutside', this.up);
    window.removeEventListener?.('keydown', this.keyDown, true);
    window.removeEventListener?.('blur', this.cancel);
    window.removeEventListener?.('pagehide', this.cancel);
    window.removeEventListener?.('visibilitychange', this.visibilityChanged, true);
  }
}
