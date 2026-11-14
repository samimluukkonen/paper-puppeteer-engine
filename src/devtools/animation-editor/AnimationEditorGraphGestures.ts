import type { Rig } from '../../engine/Rig.js';
import type { ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditActions } from './AnimationEditSession.js';
import { editGraphKey, graphKeys, type GraphKeyEdit, type GraphKeyRef } from './graphEditor.js';

export interface GraphGestureContext {
  readonly workingAnimation: ReadonlyAnimation | null;
  readonly rig: Rig | undefined;
  readonly animationAuthoringEnabled: boolean;
}

/** Own a detached curve gesture; the session owns the commit ordering, history and cross-channel selection. */
export class AnimationEditorGraphGestures {
  constructor(
    private readonly context: GraphGestureContext,
    private readonly session: AnimationEditActions,
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
    return this.session.batch(() => {
      this.session.cancelActiveDrags();
      this.session.clearTransformDraft();
      this.session.pause();
      this.graphGesture = {
        base: this.context.workingAnimation!,
        ref: { channel: { ...ref.channel }, time: ref.time },
        preview: this.context.workingAnimation!,
        time: ref.time,
      };
      this.session.notify();
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
    this.session.notify();
    return true;
  }
  cancelGraphEdit(): boolean {
    if (!this.graphGesture) return false;
    this.graphGesture = null;
    this.session.notify();
    return true;
  }
  commitGraphEdit(): boolean {
    const gesture = this.graphGesture;
    if (!gesture) return false;
    return this.session.batch(() => {
      this.graphGesture = null;
      if (gesture.base !== this.context.workingAnimation) {
        this.session.notify();
        return false;
      }
      const channel = gesture.ref.channel;
      const changed = this.session.commit(() => gesture.preview, {
        pause: false,
        ...(channel.kind === 'bone'
          ? { selectedKeys: [{ boneId: channel.id, property: channel.property, time: gesture.time }] }
          : {}),
      });
      if (changed) this.session.selectCommittedKey(channel, gesture.time);
      return changed;
    });
  }
  editGraphKey(ref: GraphKeyRef, edit: GraphKeyEdit): boolean {
    return this.session.batch(() => {
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
