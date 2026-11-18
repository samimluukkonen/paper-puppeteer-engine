import { sampleRootMotion, type RootMotionOffset, type RootMotionProperty } from '../../engine/core.js';
import type { Rig } from '../../engine/data.js';
import type { ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditActions } from './AnimationEditSession.js';
import { motionPreviewSampleTime } from './motionPreview.js';
import { rootKeys, setRootKey, duplicateRootPropertyKey, type RootKeySelection } from './rootMotionEdits.js';
import type { RootLoopMode, WorldDisplacementMode } from './worldDisplacement.js';

export interface RootMotionContext {
  readonly workingAnimation: ReadonlyAnimation | null;
  readonly rig: Rig | undefined;
  readonly animationAuthoringEnabled: boolean;
  readonly currentTime: number;
  readonly currentTimeMilliseconds: number;
  readonly keyframes: { readonly keyframeFPS: number };
  readonly duration: number;
  readonly previewAnimation: ReadonlyAnimation | null;
  readonly previews: { readonly previewTimeMilliseconds: number };
}

/** The public `state.rootMotion` domain handle; the preview snapshot is read only by the facade. */
export type AnimationEditorRootMotionHandle = Omit<AnimationEditorRootMotion, 'previewAnimation'>;

/** Own root selection, view preferences and provisional XY edits; commits through the shared edit session. */
export class AnimationEditorRootMotion {
  constructor(
    private readonly context: RootMotionContext,
    private readonly session: AnimationEditActions,
  ) {}

  get previewAnimation(): ReadonlyAnimation | undefined {
    return this.rootGesture?.preview;
  }
  rootMotionSelected = false;
  rootMotionProperty: RootMotionProperty = 'x';
  selectedRootKey: RootKeySelection | null = null;
  rootMotionEditing = false;
  private displacementMode: WorldDisplacementMode = 'authored';
  private rootLoop: RootLoopMode = 'reset';
  get worldDisplacementMode(): WorldDisplacementMode {
    return this.displacementMode;
  }
  get rootLoopMode(): RootLoopMode {
    return this.rootLoop;
  }
  get rootMotionVisible(): boolean {
    return this.displacementMode === 'authored';
  }
  setWorldDisplacementView(mode: WorldDisplacementMode, loop = this.rootLoop): void {
    if (mode === this.displacementMode && loop === this.rootLoop) return;
    this.session.batch(() => {
      this.session.cancelActiveDrags();
      this.displacementMode = mode;
      this.rootLoop = loop;
      if (mode !== 'authored') this.rootMotionEditing = false;
      this.session.notify();
    });
  }
  rootTrajectoryVisible = true;
  private rootGesture: { base: ReadonlyAnimation; preview: ReadonlyAnimation; point?: RootMotionOffset } | null = null;

  get rootMotionDragActive(): boolean {
    return this.rootGesture !== null;
  }
  get rootPosition(): RootMotionOffset {
    return (
      this.rootGesture?.point ??
      (this.context.previewAnimation
        ? sampleRootMotion(
            this.context.previewAnimation,
            motionPreviewSampleTime(this.context.previewAnimation, this.context.previews.previewTimeMilliseconds),
          )
        : { x: 0, y: 0 })
    );
  }
  setRootMotionView(patch: { editing?: boolean; visible?: boolean; trajectory?: boolean }): void {
    this.session.batch(() => {
      this.session.cancelActiveDrags();
      if (patch.editing !== undefined) this.rootMotionEditing = patch.editing;
      if (patch.visible !== undefined) this.displacementMode = patch.visible ? 'authored' : 'none';
      if (patch.visible === false) this.rootMotionEditing = false;
      if (patch.trajectory !== undefined) this.rootTrajectoryVisible = patch.trajectory;
      if (patch.editing === true) {
        this.displacementMode = 'authored';
        this.selectRootMotion(this.rootMotionProperty);
      }
      this.session.notify();
    });
  }
  selectRootMotion(property: RootMotionProperty = 'x', time?: number): boolean {
    if (!this.context.workingAnimation || !['x', 'y'].includes(property)) return false;
    if (
      time !== undefined &&
      !rootKeys(this.context.workingAnimation, property).some((key) => key.time / 1000 === time)
    )
      return false;
    return this.session.batch(() => {
      this.session.cancelActiveDrags();
      this.session.clearOtherSelection();
      this.rootMotionSelected = true;
      this.rootMotionProperty = property;
      this.selectedRootKey = time === undefined ? null : Object.freeze({ property, time });
      if (time !== undefined) {
        this.session.stopPlayback();
        this.session.updateTime(time);
      }
      this.session.notify();
      return true;
    });
  }
  setRootPosition(values: Partial<RootMotionOffset>, time = this.context.currentTime): boolean {
    if (!this.context.animationAuthoringEnabled || !this.context.workingAnimation || !this.context.rig) return false;
    return this.session.batch(() => {
      let next = this.context.workingAnimation!;
      for (const property of ['x', 'y'] as const)
        if (values[property] !== undefined)
          next = setRootKey(next, this.context.rig!, property, time * 1000, values[property]);
      return this.session.commit(() => next);
    });
  }
  addRootPositionKey(): boolean {
    return this.setRootPosition(this.rootPosition);
  }
  deleteRootKey(): boolean {
    const key = this.selectedRootKey;
    if (!key || !this.context.workingAnimation || !this.context.rig || !this.context.animationAuthoringEnabled)
      return false;
    return this.session.batch(() => {
      const next = setRootKey(
        this.context.workingAnimation!,
        this.context.rig!,
        key.property,
        key.time * 1000,
        undefined,
      );
      this.selectedRootKey = null;
      return this.session.commit(() => next, { pause: false });
    });
  }
  duplicateRootKey(time = this.context.currentTime): boolean {
    const key = this.selectedRootKey;
    if (!key || !this.context.workingAnimation || !this.context.rig || !this.context.animationAuthoringEnabled)
      return false;
    const destination = time === key.time ? time + 1 / this.context.keyframes.keyframeFPS : time;
    if (
      destination > this.context.duration ||
      rootKeys(this.context.workingAnimation, key.property).some((entry) => entry.time / 1000 === destination)
    )
      return false;
    return this.session.batch(() => {
      const next = duplicateRootPropertyKey(this.context.workingAnimation!, this.context.rig!, key, destination);
      if (!this.session.commit(() => next, { pause: false })) return false;
      return this.selectRootMotion(key.property, destination);
    });
  }
  beginRootMotionDrag(): boolean {
    if (
      !this.context.workingAnimation ||
      !this.context.animationAuthoringEnabled ||
      !this.rootMotionEditing ||
      !this.rootMotionVisible
    )
      return false;
    return this.session.batch(() => {
      this.session.beginGesture();
      this.session.clearTransformDraft();
      this.rootGesture = { base: this.context.workingAnimation!, preview: this.context.workingAnimation! };
      this.session.notify();
      return true;
    });
  }
  previewRootMotionDrag(point: RootMotionOffset): boolean {
    if (!this.rootGesture || !this.context.rig) return false;
    let next = setRootKey(this.rootGesture.base, this.context.rig, 'x', this.context.currentTimeMilliseconds, point.x);
    next = setRootKey(next, this.context.rig, 'y', this.context.currentTimeMilliseconds, point.y);
    this.rootGesture = { ...this.rootGesture, preview: next, point: { ...point } };
    this.session.notify();
    return true;
  }
  cancelRootMotionDrag(): boolean {
    if (!this.rootGesture) return false;
    this.rootGesture = null;
    this.session.notify();
    return true;
  }
  commitRootMotionDrag(): boolean {
    const gesture = this.rootGesture;
    if (!gesture) return false;
    return this.session.batch(() => {
      this.rootGesture = null;
      return (
        gesture.base === this.context.workingAnimation && this.session.commit(() => gesture.preview, { pause: false })
      );
    });
  }
}
