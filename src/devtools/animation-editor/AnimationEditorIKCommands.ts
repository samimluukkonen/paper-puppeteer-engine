import type { PropertyKeyframe } from '../../engine/AnimationClip.js';
import {
  findIKPropertyKeyframe,
  setIKPropertyKeyframe,
  removeIKPropertyKeyframe,
  moveIKPropertyKeyframe,
  ikAnimationProperties,
  type IKAnimationProperty,
} from '../../engine/ik/animationKeyframes.js';
import type { Rig } from '../../engine/Rig.js';
import { freezeData } from '../shared/editorData.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorKeyframeCommands } from './AnimationEditorKeyframeCommands.js';
import type { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import type { AnimationEditorSelection } from './AnimationEditorSelection.js';
import { evaluateIKTarget } from './ikInspectorSampling.js';
import type { IKKeyframeSelection } from './ikTimeline.js';
import { animationDurationSeconds, snapKeyframeTime } from './timeline.js';
import { type Milliseconds, type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';

interface IKCommandActions {
  cancelTimelineDrag(): boolean;
  pause(): void;
  endScrub(): void;
  updateTimeMilliseconds(time: Milliseconds): boolean;
  install(animation: ReadonlyAnimation, retainDraft?: boolean): boolean;
  notify(): void;
}

/** Owns IK selection, drafts and key edits using the session's existing clock and document history. */
export class AnimationEditorIKCommands {
  constructor(
    private readonly document: AnimationEditorDocument,
    private readonly selection: AnimationEditorSelection,
    private readonly playback: AnimationEditorPlayback,
    private readonly keyframes: Pick<AnimationEditorKeyframeCommands, 'keyframeSnapMode' | 'keyframeFPS'>,
    private readonly actions: IKCommandActions,
  ) {}

  private get working(): ReadonlyAnimation | null {
    return this.document.workingAnimation;
  }
  private get rig(): Rig | undefined {
    return this.document.rig;
  }
  private get currentTime(): Seconds {
    return this.playback.currentTime;
  }
  private get duration(): Seconds {
    return animationDurationSeconds(this.working);
  }

  get selectedIKConstraintId(): string | null {
    return this.selection.ikTarget?.constraintId ?? null;
  }
  get selectedIKProperty(): IKAnimationProperty | null {
    return this.selection.ikTarget?.property ?? null;
  }
  get selectedIKKeyframe(): IKKeyframeSelection | null {
    return this.selection.ikKeyframe;
  }
  get ikTargetDraft() {
    return this.selection.ikDraft;
  }
  get selectedIKTargetValues() {
    const id = this.selectedIKConstraintId;
    const values =
      id && this.working && this.rig
        ? evaluateIKTarget(this.working, this.rig, id, this.playback.currentTimeMilliseconds)
        : undefined;
    return values ? Object.freeze({ ...values, ...this.selection.ikDraft }) : undefined;
  }
  selectIKConstraint(id: string, property: IKAnimationProperty | null = null): boolean {
    if (
      !this.rig?.ik?.some((entry) => entry.name === id) ||
      (property !== null && !ikAnimationProperties.includes(property))
    )
      return false;
    this.actions.cancelTimelineDrag();
    this.selection.selectIK(id, property);
    this.actions.notify();
    return true;
  }
  setTimelineIKExpanded(id: string, expanded: boolean): boolean {
    if (!this.rig?.ik?.some((entry) => entry.name === id)) return false;
    this.actions.cancelTimelineDrag();
    if (this.selection.setIKExpanded(id, expanded)) this.actions.notify();
    return true;
  }
  isTimelineIKExpanded(id: string): boolean {
    return this.selection.isIKExpanded(id);
  }
  findIKPropertyKeyframe(
    id: string,
    property: IKAnimationProperty,
    time = this.currentTime,
  ): PropertyKeyframe | undefined {
    return this.working && this.rig
      ? findIKPropertyKeyframe(this.working, this.rig, id, property, this.playback.resolveTimeMilliseconds(time))
      : undefined;
  }
  selectIKKeyframe(ref: IKKeyframeSelection): boolean {
    if (ref.kind !== 'ik') return false;
    let key: PropertyKeyframe | undefined;
    try {
      key = this.findIKPropertyKeyframe(ref.constraintId, ref.property, ref.time);
    } catch {
      return false;
    }
    if (!key) return false;
    this.actions.cancelTimelineDrag();
    this.actions.pause();
    this.actions.endScrub();
    this.selection.selectIK(ref.constraintId, ref.property, Object.freeze({ ...ref, time: toSeconds(key.time) }));
    this.actions.updateTimeMilliseconds(key.time);
    this.actions.notify();
    return true;
  }
  cancelIKEdit(): void {
    if (this.selection.clearIKDraft()) this.actions.notify();
  }
  beginIKEdit(): void {
    if (!this.selectedIKConstraintId || !this.working) return;
    this.actions.cancelTimelineDrag();
    this.actions.pause();
    this.actions.endScrub();
  }
  setTemporaryIKProperty(property: IKAnimationProperty, value: number): boolean {
    if (
      !this.selectedIKConstraintId ||
      !this.working ||
      !ikAnimationProperties.includes(property) ||
      !Number.isFinite(value) ||
      (property === 'mix' && (value < 0 || value > 1))
    )
      return false;
    this.beginIKEdit();
    this.selection.setIKDraft(property, value);
    this.actions.notify();
    return true;
  }
  commitIKProperty(property: IKAnimationProperty): boolean {
    const id = this.selectedIKConstraintId;
    const value = this.selectedIKTargetValues?.[property];
    return id !== null && value !== undefined && this.setIKPropertyKeyframe(id, property, value);
  }
  setIKPropertyKeyframe(id: string, property: IKAnimationProperty, value: number, time = this.currentTime): boolean {
    return this.editIKKeys(
      (animation, rig) =>
        setIKPropertyKeyframe(animation, rig, id, property, this.playback.resolveTimeMilliseconds(time), value),
      () => {
        if (id === this.selectedIKConstraintId && time === this.currentTime)
          this.selection.clearIKDraftProperty(property);
      },
      true,
    );
  }
  deleteIKPropertyKey(property: IKAnimationProperty): boolean {
    const id = this.selectedIKConstraintId;
    return id !== null && this.removeIKPropertyKeyframe(id, property);
  }
  removeIKPropertyKeyframe(id: string, property: IKAnimationProperty, time = this.currentTime): boolean {
    let key: PropertyKeyframe | undefined;
    try {
      key = this.findIKPropertyKeyframe(id, property, time);
    } catch {
      return false;
    }
    return this.editIKKeys(
      (animation, rig) =>
        removeIKPropertyKeyframe(animation, rig, id, property, this.playback.resolveTimeMilliseconds(time)),
      () => {
        const selected = this.selectedIKKeyframe;
        if (
          selected?.constraintId === id &&
          selected.property === property &&
          key &&
          selected.time === toSeconds(key.time)
        )
          this.selection.clearIKKey();
        if (id === this.selectedIKConstraintId) this.selection.clearIKDraftProperty(property);
      },
      true,
    );
  }
  deleteSelectedIKKeyframe(): boolean {
    const key = this.selectedIKKeyframe;
    return !!key && this.removeIKPropertyKeyframe(key.constraintId, key.property, key.time);
  }
  moveSelectedIKKeyframe(time: Seconds): boolean {
    const key = this.selectedIKKeyframe;
    if (!key || !Number.isFinite(time)) return false;
    const destination = snapKeyframeTime(
      time,
      this.duration,
      this.keyframes.keyframeSnapMode,
      this.keyframes.keyframeFPS,
    );
    return this.editIKKeys(
      (animation, rig) =>
        moveIKPropertyKeyframe(
          animation,
          rig,
          key.constraintId,
          key.property,
          toMilliseconds(key.time),
          toMilliseconds(destination),
        ),
      (next) => {
        const moved =
          this.rig &&
          findIKPropertyKeyframe(next, this.rig, key.constraintId, key.property, toMilliseconds(destination));
        if (moved) {
          this.selection.setIKKey(Object.freeze({ ...key, time: toSeconds(moved.time) }));
          this.actions.updateTimeMilliseconds(moved.time);
        }
      },
    );
  }
  nudgeSelectedIKKeyframe(direction: -1 | 1, large = false): boolean {
    const key = this.selectedIKKeyframe;
    const step = this.keyframes.keyframeSnapMode === 'frame' ? 1 / this.keyframes.keyframeFPS : 0.01;
    return !!key && this.moveSelectedIKKeyframe(key.time + direction * step * (large ? 10 : 1));
  }
  /** Existing pure IK mutations install through the sole document/history boundary. */
  private editIKKeys(
    edit: (animation: ReadonlyAnimation, rig: Rig) => ReadonlyAnimation,
    after: (next: ReadonlyAnimation) => void,
    retainDraft = false,
  ): boolean {
    if (!this.working || !this.rig) return false;
    let next: ReadonlyAnimation;
    try {
      next = edit(this.working, this.rig);
    } catch (error) {
      this.document.reportError(error);
      this.actions.notify();
      return false;
    }
    this.actions.cancelTimelineDrag();
    this.actions.pause();
    this.actions.endScrub();
    after(next);
    return this.actions.install(freezeData(next), retainDraft);
  }
}
