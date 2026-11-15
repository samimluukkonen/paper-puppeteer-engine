import { transformProperties, type TransformProperty } from '../../engine/core.js';
import type { AnimationEditorDocument } from './AnimationEditorDocument.js';
import type { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import type { AnimationEditorSelection } from './AnimationEditorSelection.js';
import type { AnimationEditActions } from './AnimationEditSession.js';
import { findAnimationEvent, type AnimationEventRef } from './animationEvents.js';
import { findBonePropertyKeyframe } from './keyframeQueries.js';
import {
  keysInMarquee,
  resolveKey,
  sameKey,
  type KeyframeMarquee,
  type KeyframeSelectionModifiers,
} from './keyframeSelection.js';
import type { KeyframeSelection } from './timelineTracks.js';
import { toMilliseconds, toSeconds } from './timeUnits.js';

/** Selection transitions coordinate gestures and playback inside the session's notification boundary. */
export class AnimationEditorSelectionCommands {
  constructor(
    private readonly document: AnimationEditorDocument,
    private readonly selection: AnimationEditorSelection,
    private readonly playback: AnimationEditorPlayback,
    private readonly session: AnimationEditActions,
  ) {}

  private prepareSelection(): void {
    this.session.cancelActiveDrags();
    this.playback.pause();
    this.playback.endScrub();
  }

  /** Transient navigation only: preview sampling never dispatches authored events. */
  selectAnimationEvent(ref: AnimationEventRef): boolean {
    const event = findAnimationEvent(this.document.workingAnimation, ref);
    if (!event) return false;
    this.prepareSelection();
    this.selection.selectEvent(ref);
    this.session.updateTimeMilliseconds(event.time);
    this.session.notify();
    return true;
  }

  clearTimelineSelection(): void {
    this.session.cancelActiveDrags();
    const keys = this.selection.clearKey();
    const event = this.selection.clearEvent();
    const ik = this.selection.clearIKKey();
    if (keys || event || ik) this.session.notify();
  }

  /** Resolve identity through the central tolerance policy, then select and seek together. */
  selectKeyframe(selection: KeyframeSelection, modifiers: KeyframeSelectionModifiers = {}): boolean {
    const { boneId, property, time } = selection;
    const animation = this.document.workingAnimation;
    if (!this.document.rig?.hasBone(boneId) || !animation) return false;
    const key = findBonePropertyKeyframe(animation, boneId, property, toMilliseconds(time));
    if (!key) return false;
    this.prepareSelection();
    const clicked = Object.freeze({ boneId, property, time: toSeconds(key.time) });
    const anchor = this.selection.anchor;
    if (modifiers.range && anchor) {
      // Range stays anchored across repeated Shift-clicks. Cross-track Shift adds and makes the clicked key primary.
      const track = this.selection
        .tracks(this.document.workingAnimation)
        .find((row) => row.kind === 'property' && row.boneId === boneId && row.property === property);
      const range =
        anchor.boneId === boneId && anchor.property === property && track?.kind === 'property'
          ? track.keyframes.filter(
              (entry) =>
                entry.time >= Math.min(anchor.time, clicked.time) && entry.time <= Math.max(anchor.time, clicked.time),
            )
          : [...this.selection.keys, clicked];
      this.selection.setKeys(modifiers.additive ? [...this.selection.keys, ...range] : range, clicked);
      this.session.updateTimeMilliseconds(key.time);
    } else if (modifiers.additive) {
      const exists = this.selection.hasKey(clicked);
      this.selection.setKeys(
        exists ? this.selection.keys.filter((entry) => !sameKey(entry, clicked)) : [...this.selection.keys, clicked],
        this.selection.key,
      );
      // Add/toggle retains primary where possible; fallback primary never seeks.
    } else {
      this.selection.selectKey(clicked);
      this.session.updateTimeMilliseconds(key.time);
    }
    this.session.notify();
    return true;
  }

  clearKeyframeSelection(): void {
    this.session.cancelActiveDrags();
    if (this.selection.clearKey()) this.session.notify();
  }

  /** Resolve externally supplied references before installing transient box selection. */
  selectKeyframes(keys: readonly KeyframeSelection[], additive = false): void {
    this.prepareSelection();
    const resolved = keys.flatMap((key) => {
      const ref = resolveKey(this.document.workingAnimation, key);
      return ref ? [ref] : [];
    });
    const previous = this.selection.key;
    this.selection.setKeys(additive ? [...this.selection.keys, ...resolved] : resolved, previous);
    if (!additive && this.selection.key && (!previous || !sameKey(previous, this.selection.key)))
      this.session.updateTime(this.selection.key.time);
    this.session.notify();
  }

  selectKeyframeMarquee(box: KeyframeMarquee, additive = false): void {
    const visible = this.selection.visibility(this.document.workingAnimation).rows;
    this.selectKeyframes(keysInMarquee(this.selection.tracks(this.document.workingAnimation), box, visible), additive);
  }

  /** Previous/next authored key on the selected property, relative to the current playhead. */
  getAdjacentKeyframe(direction: -1 | 1): KeyframeSelection | undefined {
    return this.selection.adjacentKey(this.document.workingAnimation, this.playback.currentTime, direction);
  }

  selectAdjacentKeyframe(direction: -1 | 1): boolean {
    const key = this.getAdjacentKeyframe(direction);
    return key ? this.selectKeyframe(key) : false;
  }

  /** Authored snapshots are authoritative; history never restores transient selection. */
  reconcile(): void {
    this.selection.validateKey(this.document.workingAnimation);
    this.selection.validateEvent(this.document.workingAnimation);
  }

  setTimelineBoneExpanded(boneId: string, expanded: boolean): boolean {
    if (!this.document.rig?.hasBone(boneId)) return false;
    this.session.cancelActiveDrags();
    if (this.selection.setExpanded(boneId, expanded)) this.session.notify();
    return true;
  }

  /** Bone + property selection uses the same bone owner as hierarchy and preview picking. */
  selectTimelineProperty(boneId: string, property: TransformProperty): boolean {
    if (!this.document.rig?.hasBone(boneId) || !transformProperties.includes(property)) return false;
    this.session.cancelActiveDrags();
    if (this.selection.selectProperty(boneId, property)) this.session.notify();
    return true;
  }

  selectBone(id: string | null): boolean {
    if (id !== null && !this.document.rig?.hasBone(id)) return false;
    this.session.cancelActiveDrags();
    if (this.selection.selectBone(id)) this.session.notify();
    return true;
  }
}
