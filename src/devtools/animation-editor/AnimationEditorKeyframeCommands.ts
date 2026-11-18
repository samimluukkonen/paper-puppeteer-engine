import type { Rig, TransformProperty } from '../../engine/data.js';
import type { BoneSymmetryMapping } from '../shared/boneSymmetry.js';
import type { MirrorDirection } from '../shared/poseMirroring.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import type { AnimationEditorSelection } from './AnimationEditorSelection.js';
import type { AnimationEditActions } from './AnimationEditSession.js';
import { copyKeyframeSelection, pasteKeyframeClipboard, type KeyframeClipboard } from './keyframeClipboard.js';
import {
  constrainKeyframeMoveDelta,
  moveBonePropertyKeyframes,
  removeBonePropertyKeyframe,
  removeBonePropertyKeyframes,
  setBonePropertyKeyframe,
} from './keyframeEdits.js';
import {
  mirrorCurrentPoseToKeys,
  mirrorSelectedKeyframes,
  type KeyframeMirrorResult,
  type MirrorCurrentPoseOptions,
} from './keyframeMirroring.js';
import { findBonePropertyKeyframe } from './keyframeQueries.js';
import { retimeSelectedKeys, type RetimeOptions, type RetimeResult } from './keyframeRetiming.js';
import { keyframeTimesMatch } from './keyframeTargets.js';
import { animationDurationSeconds, type KeyframeSnapMode } from './timeline.js';
import type { TimelineClipboard } from './TimelineClipboard.js';
import type { AnimationEditorTimelineSnapping, TimelineSnapGuide } from './timelineSnapping.js';
import type { KeyframeSelection } from './timelineTracks.js';
import { type Milliseconds, type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';

export interface KeyframeDrag {
  readonly key: KeyframeSelection;
  readonly previewTime: Seconds;
  readonly originalKeys: readonly KeyframeSelection[];
  readonly originalPrimary: KeyframeSelection;
  readonly previewDelta: Seconds;
  readonly playheadTime: Seconds;
  readonly snapGuide: TimelineSnapGuide | null;
  readonly proposedTime: Seconds;
  readonly disableSnapping: boolean;
}

/** Facade-owned inputs: the rig-session symmetry mapping and the event drag a key drag replaces. */
export interface KeyframeCommandDeps {
  readonly symmetry: () => BoneSymmetryMapping | null;
  readonly cancelEventDrag: () => boolean;
}

/** The public `state.keyframes` domain handle; only the facade resets the session. */
export type AnimationEditorKeyframeHandle = Omit<AnimationEditorKeyframeCommands, 'resetSession'>;

/**
 * Owns keyframe mutation transactions and transient drag/nudge state; the session owns the commit ordering.
 * Guarded commands run through `session.run`; the drag cancel only batches. Edits whose only effect is
 * one `commit` (move, set, remove) rely on its guard.
 */
export class AnimationEditorKeyframeCommands {
  private drag: KeyframeDrag | null = null;

  constructor(
    private readonly document: AnimationEditorDocument,
    private readonly selection: AnimationEditorSelection,
    private readonly playback: AnimationEditorPlayback,
    private readonly session: AnimationEditActions,
    private readonly clipboard: TimelineClipboard,
    private readonly snapping: AnimationEditorTimelineSnapping,
    private readonly deps: KeyframeCommandDeps,
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
  private get selectedKeys(): readonly KeyframeSelection[] {
    return this.selection.keys;
  }

  /** Detached proposal: no document, selection, playback, draft or history changes. */
  previewKeyframeRetiming(options: RetimeOptions): RetimeResult<ReadonlyAnimation> {
    if (!this.working || !this.rig) throw new Error('Load a valid animation first.');
    const selected = this.selection.ikKeyframe ? [this.selection.ikKeyframe] : this.selectedKeys;
    if (!selected.length) throw new Error('Select keyframes to retime.');
    return retimeSelectedKeys(this.working, this.rig, selected, {
      ...options,
      playheadTimeMs: this.playback.currentTimeMilliseconds,
    });
  }

  /** Validate the complete candidate before changing transient editor state; install once for Undo/Redo. */
  retimeSelectedKeyframes(options: RetimeOptions): boolean {
    return this.session.run(false, () => {
      let result: RetimeResult<ReadonlyAnimation>;
      try {
        result = this.previewKeyframeRetiming(options);
      } catch (error) {
        this.document.reportError(error);
        this.session.notify();
        return false;
      }
      if (result.animation === this.working) return false;
      const primaryIndex = this.selection.key ? this.selectedKeys.indexOf(this.selection.key) : 0;
      const time = this.currentTime;
      // Set destination identities before the existing installation reconciliation resolves them.
      const first = result.keys[0]!;
      return this.session.commit(() => result.animation, {
        time,
        after: () => {
          if ('kind' in first) this.selection.setIKKey(first);
          else {
            const keys = result.keys.filter((key): key is KeyframeSelection => !('kind' in key));
            this.selection.setKeys(keys, keys[primaryIndex] ?? null);
          }
        },
      });
    });
  }

  /** Explicit authored mirror command; defaults to the selected bone or all mapped sources. */
  mirrorCurrentPoseToKeys(direction: MirrorDirection, options: MirrorCurrentPoseOptions = {}): boolean {
    return this.session.run(false, () => {
      const mapping = this.deps.symmetry();
      if (!mapping) return false;
      const boneIds = options.boneIds ?? (this.selection.boneId ? [this.selection.boneId] : undefined);
      return this.commitMirror((animation, rig) =>
        mirrorCurrentPoseToKeys(animation, rig, mapping, this.playback.currentTimeMilliseconds, direction, {
          ...options,
          ...(boneIds ? { boneIds } : {}),
        }),
      );
    });
  }

  mirrorSelectedKeyframes(direction: MirrorDirection): boolean {
    return this.session.run(false, () => {
      const mapping = this.deps.symmetry();
      if (!mapping) return false;
      const primary = this.selection.key;
      // Preserve the primary source's counterpart as the destination primary.
      const sources = primary ? [primary, ...this.selectedKeys.filter((key) => key !== primary)] : this.selectedKeys;
      return this.commitMirror((animation, rig) =>
        mirrorSelectedKeyframes(
          animation,
          rig,
          mapping,
          sources.map((key) => ({ boneId: key.boneId, property: key.property, timeMs: toMilliseconds(key.time) })),
          direction,
        ),
      );
    });
  }

  /** Build and validate before touching gestures, playback, drafts or selection. One install owns history/dirty. */
  private commitMirror(
    build: (animation: ReadonlyAnimation, rig: Rig) => KeyframeMirrorResult<ReadonlyAnimation>,
  ): boolean {
    if (!this.working || !this.rig) return false;
    let result: KeyframeMirrorResult<ReadonlyAnimation>;
    try {
      result = build(this.working, this.rig);
    } catch (error) {
      this.document.reportError(error);
      this.session.notify();
      return false;
    }
    if (!result.keys.length) return false;
    const time = this.currentTime;
    const keys = result.keys.map(({ boneId, property, timeMs }) => ({ boneId, property, time: toSeconds(timeMs) }));
    return this.session.commit(() => result.animation, { time, selectedKeys: keys });
  }

  get keyframeClipboard(): KeyframeClipboard | null {
    return this.clipboard.content?.kind === 'keyframes' ? this.clipboard.content.data : null;
  }
  /** Copy never touches clocks, drafts, authored history or the saved baseline. Empty copy retains the clipboard. */
  copySelectedKeyframes(): boolean {
    if (!this.working) return false;
    const clipboard = copyKeyframeSelection(this.working, this.selectedKeys);
    if (!clipboard) return false;
    this.clipboard.content = Object.freeze({ kind: 'keyframes', data: clipboard });
    this.session.notify();
    return true;
  }
  /** Bone keys never paste over an IK selection; IK channels have no keyframe clipboard. */
  pasteKeyframes(): boolean {
    return this.session.run(false, () => {
      if (this.selection.ikTarget?.constraintId) return false;
      const clipboard = this.keyframeClipboard;
      return clipboard ? this.pasteGroup(clipboard, this.currentTime) : false;
    });
  }
  /** Duplicate shares paste logic without overwriting the user's clipboard or seeking away from the playhead. */
  duplicateSelectedKeyframes(): boolean {
    return this.session.run(false, () => {
      if (this.selection.ikTarget?.constraintId || !this.working) return false;
      const group = copyKeyframeSelection(this.working, this.selectedKeys);
      if (!group) return false;
      const playback = this.working.playback;
      const step =
        playback?.mode === 'stepped' && Number.isFinite(playback.fps) && playback.fps > 0 ? 1 / playback.fps : 0.01;
      return this.pasteGroup(group, toSeconds(group.anchorTimeMs) + step);
    });
  }
  private pasteGroup(group: KeyframeClipboard, anchorTime: Seconds): boolean {
    if (!this.working || !this.rig || !group.entries.length) return false;
    let pasted: ReturnType<typeof pasteKeyframeClipboard<ReadonlyAnimation>>;
    try {
      pasted = pasteKeyframeClipboard(this.working, this.rig, group, toMilliseconds(anchorTime));
    } catch (error) {
      this.document.reportError(error);
      this.session.notify();
      return false;
    }
    const time = this.currentTime;
    return this.session.commit(() => pasted.animation, { time, selectedKeys: pasted.keys });
  }

  get keyframeDrag(): KeyframeDrag | null {
    return this.drag;
  }
  get keyframeSnapMode(): KeyframeSnapMode {
    return this.snapping.settings.enabled && this.snapping.settings.frames ? 'frame' : 'none';
  }
  get keyframeFPS(): number {
    return this.snapping.fps;
  }
  /** A key drag replaces any event drag, even when the key is already selected and no gesture begins. */
  beginKeyframeDrag(key: KeyframeSelection): boolean {
    return this.session.run(false, () => {
      this.deps.cancelEventDrag();
      return this.startKeyframeDrag(key);
    });
  }
  private startKeyframeDrag(key: KeyframeSelection): boolean {
    this.cancelKeyframeDrag();
    const playheadTime = this.currentTime;
    const originalPrimary = this.selection.key;
    const selected = this.selection.hasKey(key);
    if (selected) {
      this.session.stopPlayback();
      this.selection.setKeys(this.selectedKeys, key);
      this.session.updateTime(key.time);
    } else if (!this.session.selectKeyframe(key)) return false;
    const anchor = this.selection.key!;
    this.drag = Object.freeze({
      key: anchor,
      originalKeys: this.selectedKeys,
      originalPrimary: selected ? originalPrimary! : anchor,
      previewTime: anchor.time,
      previewDelta: 0,
      playheadTime,
      snapGuide: null,
      proposedTime: anchor.time,
      disableSnapping: false,
    });
    this.session.notify();
    return true;
  }
  previewKeyframeDrag(time: Seconds, disableSnapping = false): boolean {
    return this.session.run(false, () => this.updateKeyframeDrag(time, disableSnapping));
  }
  private updateKeyframeDrag(time: Seconds, disableSnapping: boolean): boolean {
    if (!this.drag || !Number.isFinite(time)) return false;
    const { originalKeys, key, playheadTime } = this.drag;
    const earliest = originalKeys.reduce((min, entry) => Math.min(min, entry.time), key.time);
    const latest = originalKeys.reduce((max, entry) => Math.max(max, entry.time), key.time);
    const result = this.snapping.resolve(time, {
      playheadTime,
      excludedKeys: originalKeys,
      disableSnapping,
      minTime: key.time - earliest,
      maxTime: this.duration - latest + key.time,
    });
    const deltaMs = this.movementDelta(originalKeys, key, result.time);
    const previewDelta = toSeconds(deltaMs);
    const previewTime = toSeconds(toMilliseconds(this.drag.key.time) + deltaMs);
    this.drag = Object.freeze({
      ...this.drag,
      previewTime,
      previewDelta,
      snapGuide: result.guide,
      proposedTime: time,
      disableSnapping,
    });
    this.session.updateTime(previewTime);
    this.session.notify();
    return true;
  }
  commitKeyframeDrag(): boolean {
    return this.session.run(false, () => {
      const drag = this.drag;
      if (!drag) return false;
      this.drag = null;
      return this.moveSelectedKeyframe(drag.previewTime);
    });
  }
  cancelKeyframeDrag(): boolean {
    return this.session.batch(() => {
      if (!this.drag) return false;
      const { key, originalKeys, originalPrimary } = this.drag;
      const time = key.time;
      this.drag = null;
      this.selection.setKeys(originalKeys, originalPrimary, false);
      this.session.updateTime(time);
      this.session.notify();
      return true;
    });
  }
  /** A new document session discards the gesture without restoring old navigation or notifying midway. */
  resetSession(): void {
    this.drag = null;
  }
  /** Constrain a single anchor delta in authored milliseconds. Drag snapping happens before this boundary. */
  private movementDelta(keys: readonly KeyframeSelection[], anchor: KeyframeSelection, time: Seconds): Milliseconds {
    const target = time;
    return constrainKeyframeMoveDelta(
      keys.map((key) => toMilliseconds(key.time)),
      toMilliseconds(target) - toMilliseconds(anchor.time),
      toMilliseconds(this.duration),
    );
  }
  /** Explicit time moves translate the selection relative to its primary, without snapping. */
  moveSelectedKeyframe(time: Seconds): boolean {
    if (!Number.isFinite(time)) return false;
    let pending: { anchor: KeyframeSelection; keys: KeyframeSelection[]; primaryIndex: number } | undefined;
    return this.session.commit(
      (animation, rig) => {
        const anchor = this.selection.key;
        if (!anchor) return undefined;
        const keys = this.selectedKeys;
        const primaryIndex = keys.indexOf(anchor);
        const delta = this.movementDelta(keys, anchor, time);
        const moved = moveBonePropertyKeyframes(
          animation,
          rig,
          keys.map((entry) => ({
            boneId: entry.boneId,
            property: entry.property,
            timeMs: toMilliseconds(entry.time),
          })),
          delta,
        );
        pending = {
          anchor,
          keys: moved.keys.map((entry) => ({
            boneId: entry.boneId,
            property: entry.property,
            time: toSeconds(entry.timeMs),
          })),
          primaryIndex,
        };
        return moved.animation;
      },
      {
        retainDraft: true,
        after: () => {
          const { anchor, keys, primaryIndex } = pending!;
          this.selection.setKeys(keys, keys[primaryIndex] ?? null);
          this.session.updateTime(this.selection.key!.time);
          if (
            anchor.boneId === this.selection.boneId &&
            keyframeTimesMatch(toMilliseconds(anchor.time), this.playback.currentTimeMilliseconds) &&
            this.selection.draft[anchor.property] !== undefined
          )
            this.selection.clearDraftProperty(anchor.property);
        },
      },
    );
  }
  nudgeSelectedKeyframe(direction: -1 | 1, large = false): boolean {
    if (!this.selection.key || this.drag) return false;
    const step = this.keyframeSnapMode === 'frame' ? 1 / this.keyframeFPS : 0.01;
    const anchor = this.selection.key;
    const time = toSeconds(toMilliseconds(anchor.time) + direction * toMilliseconds(step) * (large ? 10 : 1));
    const target = this.snapping.resolve(time, {
      playheadTime: this.currentTime === anchor.time ? NaN : this.currentTime,
      excludedKeys: this.selectedKeys,
      ...(direction > 0
        ? { minTime: anchor.time + Number.EPSILON * Math.max(1, anchor.time) * 2 }
        : { maxTime: anchor.time - Number.EPSILON * Math.max(1, anchor.time) * 2 }),
    }).time;
    const delta = this.movementDelta(this.selectedKeys, anchor, target);
    return this.moveSelectedKeyframe(toSeconds(toMilliseconds(anchor.time) + delta));
  }
  /** All selected authored properties are removed before installing one validated history snapshot. */
  deleteSelectedKeyframes(): boolean {
    return this.session.run(false, () => {
      this.cancelKeyframeDrag();
      if (!this.selectedKeys.length || !this.working || !this.rig) return false;
      return this.session.commit((animation, rig) => {
        const next = removeBonePropertyKeyframes(
          animation,
          rig,
          this.selectedKeys.map((key) => ({
            boneId: key.boneId,
            property: key.property,
            timeMs: toMilliseconds(key.time),
          })),
        );
        this.selection.clearKey();
        return next;
      });
    });
  }
  /** Authoring uses continuous seconds, defaulting to the sole editor clock. */
  setBonePropertyKeyframe(
    boneId: string,
    property: TransformProperty,
    value: number,
    timeSeconds = this.currentTime,
  ): boolean {
    return this.editKeyframes(
      (animation, rig) =>
        setBonePropertyKeyframe(
          animation,
          rig,
          boneId,
          property,
          this.playback.resolveTimeMilliseconds(timeSeconds),
          value,
        ),
      { boneId, property, time: timeSeconds },
    );
  }

  removeBonePropertyKeyframe(boneId: string, property: TransformProperty, timeSeconds = this.currentTime): boolean {
    return this.editKeyframes(
      (animation, rig) => {
        const key = findBonePropertyKeyframe(
          animation,
          boneId,
          property,
          this.playback.resolveTimeMilliseconds(timeSeconds),
        );
        const next = removeBonePropertyKeyframe(
          animation,
          rig,
          boneId,
          property,
          this.playback.resolveTimeMilliseconds(timeSeconds),
        );
        // Remove exact authored identity before nearby keys can be resolved through tolerance.
        if (next !== animation && key) this.selection.removeKey({ boneId, property, time: toSeconds(key.time) });
        return next;
      },
      { boneId, property, time: timeSeconds },
    );
  }

  /** Every command installs one validated snapshot; failures leave authored data and history intact. */
  private editKeyframes(
    edit: (animation: ReadonlyAnimation, rig: Rig) => ReadonlyAnimation,
    draftTarget?: KeyframeSelection,
  ): boolean {
    return this.session.commit(edit, {
      pause: false,
      retainDraft: draftTarget !== undefined,
      after: () => {
        // The mutation helper validated the result and shares only the document's owned frozen branches.
        if (
          draftTarget?.boneId === this.selection.boneId &&
          keyframeTimesMatch(toMilliseconds(draftTarget.time), this.playback.currentTimeMilliseconds) &&
          this.selection.draft[draftTarget.property] !== undefined
        ) {
          this.selection.clearDraftProperty(draftTarget.property);
        }
      },
    });
  }
}
