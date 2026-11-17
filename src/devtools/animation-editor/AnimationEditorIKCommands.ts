import {
  findIKPropertyKeyframe,
  setIKPropertyKeyframe,
  removeIKPropertyKeyframe,
  moveIKPropertyKeyframe,
  ikAnimationProperties,
  type IKAnimationProperty,
} from '../../engine/core.js';
import type { Point, PropertyKeyframe, Rig } from '../../engine/data.js';
import { assertJsonExportSize } from '../shared/jsonExportSize.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import type { AnimationEditorSelection } from './AnimationEditorSelection.js';
import type { AnimationEditActions } from './AnimationEditSession.js';
import { evaluateIKTarget } from './ikInspectorSampling.js';
import type { IKKeyframeSelection } from './ikTimeline.js';
import type { AnimationEditorTimelineSnapping } from './timelineSnapping.js';
import { type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';

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
    if (this.document.workingAnimation?.disabledIKConstraints?.includes(id))
      return 'This IK constraint is disabled for the baked animation.';
    return this.unavailable.get(id) ?? null;
  }
  setIKManipulationDisabledReason(id: string, reason: string | null): void {
    if ((this.unavailable.get(id) ?? null) === reason) return;
    if (this.drag?.constraintId === id) this.cancelIKTargetDrag();
    if (reason) this.unavailable.set(id, reason);
    else this.unavailable.delete(id);
    this.session.notify();
  }
  beginIKTargetDrag(id: string): boolean {
    if (!this.working || this.getIKManipulationDisabledReason(id) || !this.rig?.ik?.some((entry) => entry.name === id))
      return false;
    this.session.beginGesture();
    if (id !== this.selectedIKConstraintId) this.selection.selectIK(id);
    this.drag = Object.freeze({ constraintId: id, draft: this.selection.ikDraft });
    this.selection.setIKExpanded(id, true);
    this.session.notify();
    return true;
  }
  previewIKTargetDrag(point: Point): boolean {
    if (!this.drag || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    this.selection.setIKDraft('x', point.x);
    this.selection.setIKDraft('y', point.y);
    this.session.notify();
    return true;
  }
  endIKTargetDrag(): boolean {
    if (!this.drag) return false;
    this.drag = null;
    this.session.notify();
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
    this.session.notify();
    return true;
  }
  /** Explicitly commit both target coordinates in one document/history installation. */
  commitIKTarget(target?: Point): boolean {
    const id = this.selectedIKConstraintId;
    const values = target ?? this.selectedIKTargetValues;
    if (
      !id ||
      !values ||
      !Number.isFinite(values.x) ||
      !Number.isFinite(values.y) ||
      this.drag ||
      this.ikManipulationDisabledReason
    )
      return false;
    const time = this.playback.currentTimeMilliseconds;
    return this.editIKKeys(
      (animation, rig) =>
        setIKPropertyKeyframe(
          setIKPropertyKeyframe(animation, rig, id, 'x', time, values.x),
          rig,
          id,
          'y',
          time,
          values.y,
        ),
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
    private readonly snapping: AnimationEditorTimelineSnapping,
    private readonly session: AnimationEditActions,
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
    this.session.cancelActiveDrags();
    this.selection.selectIK(id, property);
    this.session.notify();
    return true;
  }
  setTimelineIKExpanded(id: string, expanded: boolean): boolean {
    if (!this.rig?.ik?.some((entry) => entry.name === id)) return false;
    this.session.cancelActiveDrags();
    if (this.selection.setIKExpanded(id, expanded)) this.session.notify();
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
    this.session.beginGesture();
    this.selection.selectIK(ref.constraintId, ref.property, Object.freeze({ ...ref, time: toSeconds(key.time) }));
    this.session.updateTimeMilliseconds(key.time);
    this.session.notify();
    return true;
  }
  cancelIKEdit(): void {
    this.cancelIKTargetDrag();
    if (this.selection.clearIKDraft()) this.session.notify();
  }
  beginIKEdit(): void {
    if (!this.selectedIKConstraintId || !this.working) return;
    this.session.beginGesture();
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
    this.session.notify();
    return true;
  }
  commitIKProperty(property: IKAnimationProperty): boolean {
    const id = this.selectedIKConstraintId;
    const value = this.selectedIKTargetValues?.[property];
    return id !== null && value !== undefined && this.setIKPropertyKeyframe(id, property, value);
  }
  setIKPropertyKeyframe(id: string, property: IKAnimationProperty, value: number, time = this.currentTime): boolean {
    const timeMs = this.playback.resolveTimeMilliseconds(time);
    return this.editIKKeys(
      (animation, rig) => setIKPropertyKeyframe(animation, rig, id, property, timeMs, value),
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
    const timeMs = this.playback.resolveTimeMilliseconds(time);
    return this.editIKKeys(
      (animation, rig) => removeIKPropertyKeyframe(animation, rig, id, property, timeMs),
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
    const destination = this.snapping.resolve(time, {
      playheadTime: this.currentTime === key.time ? NaN : this.currentTime,
      excludedKeys: [key],
      ...(time > key.time
        ? { minTime: key.time + Number.EPSILON * Math.max(1, key.time) * 2 }
        : time < key.time
          ? { maxTime: key.time - Number.EPSILON * Math.max(1, key.time) * 2 }
          : {}),
    }).time;
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
          this.session.updateTimeMilliseconds(moved.time);
        }
      },
    );
  }
  nudgeSelectedIKKeyframe(direction: -1 | 1, large = false): boolean {
    const key = this.selectedIKKeyframe;
    const step = this.snapping.settings.enabled && this.snapping.settings.frames ? 1 / this.snapping.fps : 0.01;
    return !!key && this.moveSelectedIKKeyframe(key.time + direction * step * (large ? 10 : 1));
  }
  /** Existing pure IK mutations install through the sole document/history boundary. */
  private editIKKeys(
    edit: (animation: ReadonlyAnimation, rig: Rig) => ReadonlyAnimation,
    after: (next: ReadonlyAnimation) => void,
    retainDraft = false,
  ): boolean {
    return this.session.commit(
      (animation, rig) => {
        const next = edit(animation, rig);
        assertJsonExportSize(next);
        return next;
      },
      { retainDraft, after },
    );
  }
}
