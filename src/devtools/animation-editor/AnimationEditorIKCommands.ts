import type { Point } from '../../engine/affineMath.js';
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
  private drag: { readonly constraintId: string; readonly draft: AnimationEditorSelection['ikDraft'] } | null = null;
  private readonly unavailable = new Map<string, string>();

  get ikTargetDrag() {
    return this.drag;
  }
  get ikManipulationDisabledReason(): string | null {
    return this.selectedIKConstraintId ? this.getIKManipulationDisabledReason(this.selectedIKConstraintId) : null;
  }
  getIKManipulationDisabledReason(id: string): string | null {
    return this.unavailable.get(id) ?? null;
  }
  setIKManipulationDisabledReason(id: string, reason: string | null): void {
    if ((this.unavailable.get(id) ?? null) === reason) return;
    if (this.drag?.constraintId === id) this.cancelIKTargetDrag();
    if (reason) this.unavailable.set(id, reason);
    else this.unavailable.delete(id);
    this.actions.notify();
  }
  beginIKTargetDrag(id: string): boolean {
    if (!this.working || this.unavailable.has(id) || !this.rig?.ik?.some((entry) => entry.name === id)) return false;
    this.actions.cancelTimelineDrag();
    if (id !== this.selectedIKConstraintId) this.selection.selectIK(id);
    this.actions.pause();
    this.actions.endScrub();
    this.drag = Object.freeze({ constraintId: id, draft: this.selection.ikDraft });
    this.selection.setIKExpanded(id, true);
    this.actions.notify();
    return true;
  }
  previewIKTargetDrag(point: Point): boolean {
    if (!this.drag || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    this.selection.setIKDraft('x', point.x);
    this.selection.setIKDraft('y', point.y);
    this.actions.notify();
    return true;
  }
  endIKTargetDrag(): boolean {
    if (!this.drag) return false;
    this.drag = null;
    this.actions.notify();
    return true;
  }
  cancelIKTargetDrag(): boolean {
    const drag = this.drag;
    if (!drag) return false;
    this.drag = null;
    this.selection.clearIKDraft();
    for (const property of ikAnimationProperties) {
      const value = drag.draft[property];
      if (value !== undefined) this.selection.setIKDraft(property, value);
    }
    this.actions.notify();
    return true;
  }
  /** Explicitly commit both target coordinates in one document/history installation. */
  commitIKTarget(): boolean {
    const id = this.selectedIKConstraintId;
    const values = this.selectedIKTargetValues;
    if (!id || !values || this.drag || this.ikManipulationDisabledReason) return false;
    return this.editIKKeys(
      (animation, rig) => {
        const time = this.playback.currentTimeMilliseconds;
        return setIKPropertyKeyframe(
          setIKPropertyKeyframe(animation, rig, id, 'x', time, values.x),
          rig,
          id,
          'y',
          time,
          values.y,
        );
      },
      () => {
        this.selection.clearIKDraftProperty('x');
        this.selection.clearIKDraftProperty('y');
      },
      true,
    );
  }

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
    this.cancelIKTargetDrag();
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
