import type { Rig } from '../../engine/Rig.js';
import type { ReadonlyAnimation } from './AnimationEditorDocument.js';
import { editGraphKey, graphKeys, type GraphChannel, type GraphKeyEdit, type GraphKeyRef } from './graphEditor.js';
import type { KeyframeSelection } from './timelineTracks.js';

export interface GraphGestureContext {
  readonly workingAnimation: ReadonlyAnimation | null;
  readonly rig: Rig | undefined;
  readonly animationAuthoringEnabled: boolean;
}

export interface GraphGestureActions {
  batch<Result>(command: () => Result): Result;
  install(animation: ReadonlyAnimation, retainDraft: boolean, selectedKeys?: readonly KeyframeSelection[]): boolean;
  cancelTimelineDrag(): boolean;
  clearTransformDraft(): void;
  pause(): void;
  selectCommittedKey(channel: GraphChannel, time: number): void;
  notify(): void;
}

/** Own a detached curve gesture; document history and cross-channel selection remain coordinated by the host. */
export class AnimationEditorGraphGestures {
  constructor(
    private readonly context: GraphGestureContext,
    private readonly actions: GraphGestureActions,
  ) {}

  get previewAnimation(): ReadonlyAnimation | undefined {
    return this.graphGesture?.preview;
  }
  private graphGesture: {
    readonly base: ReadonlyAnimation;
    readonly ref: GraphKeyRef;
    readonly preview: ReadonlyAnimation;
    readonly time: number;
  } | null = null;

  get graphEditActive(): boolean {
    return this.graphGesture !== null;
  }
  beginGraphEdit(ref: GraphKeyRef): boolean {
    if (
      !this.context.animationAuthoringEnabled ||
      !this.context.workingAnimation ||
      !this.context.rig ||
      !graphKeys(this.context.workingAnimation, ref.channel).some((key) => key.time / 1000 === ref.time)
    )
      return false;
    return this.actions.batch(() => {
      this.actions.cancelTimelineDrag();
      this.actions.clearTransformDraft();
      this.actions.pause();
      this.graphGesture = {
        base: this.context.workingAnimation!,
        ref: { channel: { ...ref.channel }, time: ref.time },
        preview: this.context.workingAnimation!,
        time: ref.time,
      };
      this.actions.notify();
      return true;
    });
  }
  previewGraphEdit(edit: GraphKeyEdit): boolean {
    const gesture = this.graphGesture;
    if (
      !gesture ||
      !this.context.rig ||
      gesture.base !== this.context.workingAnimation ||
      !this.context.animationAuthoringEnabled
    )
      return false;
    const preview = editGraphKey(gesture.base, this.context.rig, gesture.ref, edit);
    this.graphGesture = { ...gesture, preview, time: edit.time ?? gesture.ref.time };
    this.actions.notify();
    return true;
  }
  cancelGraphEdit(): boolean {
    if (!this.graphGesture) return false;
    this.graphGesture = null;
    this.actions.notify();
    return true;
  }
  commitGraphEdit(): boolean {
    const gesture = this.graphGesture;
    if (!gesture) return false;
    return this.actions.batch(() => {
      this.graphGesture = null;
      if (gesture.base !== this.context.workingAnimation) {
        this.actions.notify();
        return false;
      }
      const channel = gesture.ref.channel;
      const changed = this.actions.install(
        gesture.preview,
        false,
        channel.kind === 'bone' ? [{ boneId: channel.id, property: channel.property, time: gesture.time }] : undefined,
      );
      if (changed) this.actions.selectCommittedKey(channel, gesture.time);
      return changed;
    });
  }
  editGraphKey(ref: GraphKeyRef, edit: GraphKeyEdit): boolean {
    return this.actions.batch(() => {
      if (!this.beginGraphEdit(ref)) return false;
      try {
        this.previewGraphEdit(edit);
        return this.commitGraphEdit();
      } catch (error) {
        this.cancelGraphEdit();
        throw error;
      }
    });
  }
}
