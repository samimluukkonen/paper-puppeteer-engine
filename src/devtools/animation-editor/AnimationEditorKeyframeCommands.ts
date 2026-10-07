import type { Rig } from '../../engine/Rig.js';
import type { TransformProperty } from '../../engine/types.js';
import { freezeData } from '../shared/editorData.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import type { AnimationEditorSelection } from './AnimationEditorSelection.js';
import { copyKeyframeSelection, pasteKeyframeClipboard, type KeyframeClipboard } from './keyframeClipboard.js';
import {
  constrainKeyframeMoveDelta,
  moveBonePropertyKeyframes,
  removeBonePropertyKeyframe,
  removeBonePropertyKeyframes,
  setBonePropertyKeyframe,
} from './keyframeEdits.js';
import { findBonePropertyKeyframe } from './keyframeQueries.js';
import { keyframeTimesMatch } from './keyframeTargets.js';
import { animationDurationSeconds, DEFAULT_KEYFRAME_FPS, snapKeyframeTime, type KeyframeSnapMode } from './timeline.js';
import type { KeyframeSelection } from './timelineTracks.js';

export interface KeyframeDrag {
  readonly key: KeyframeSelection;
  readonly previewTime: number;
  readonly originalKeys: readonly KeyframeSelection[];
  readonly originalPrimary: KeyframeSelection;
  readonly previewDelta: number;
}

interface KeyframeCommandActions {
  select(key: KeyframeSelection): boolean;
  updateTime(time: number): boolean;
  install(animation: ReadonlyAnimation, retainDraft?: boolean, selectedKeys?: readonly KeyframeSelection[]): boolean;
  notify(): void;
}

/** Owns keyframe mutation transactions and transient drag/nudge state; the session coordinates navigation. */
export class AnimationEditorKeyframeCommands {
  private drag: KeyframeDrag | null = null;
  private snapMode: KeyframeSnapMode = 'none';
  private clipboard: KeyframeClipboard | null = null;

  constructor(
    private readonly document: AnimationEditorDocument,
    private readonly selection: AnimationEditorSelection,
    private readonly playback: AnimationEditorPlayback,
    private readonly actions: KeyframeCommandActions,
  ) {}

  private get working(): ReadonlyAnimation | null {
    return this.document.workingAnimation;
  }
  private get rig(): Rig | undefined {
    return this.document.rig;
  }
  private get currentTime(): number {
    return this.playback.currentTime;
  }
  private get duration(): number {
    return animationDurationSeconds(this.working);
  }
  private get selectedKeys(): readonly KeyframeSelection[] {
    return this.selection.keys;
  }

  get keyframeClipboard(): KeyframeClipboard | null {
    return this.clipboard;
  }
  /** Copy never touches clocks, drafts, authored history or the saved baseline. Empty copy retains the clipboard. */
  copySelectedKeyframes(): boolean {
    if (!this.working) return false;
    const clipboard = copyKeyframeSelection(this.working, this.selectedKeys);
    if (!clipboard) return false;
    this.clipboard = clipboard;
    this.actions.notify();
    return true;
  }
  pasteKeyframes(): boolean {
    return this.clipboard ? this.pasteGroup(this.clipboard, this.currentTime) : false;
  }
  /** Duplicate shares paste logic without overwriting the user's clipboard or seeking away from the playhead. */
  duplicateSelectedKeyframes(): boolean {
    if (!this.working) return false;
    const group = copyKeyframeSelection(this.working, this.selectedKeys);
    if (!group) return false;
    const playback = this.working.playback;
    const step =
      playback?.mode === 'stepped' && Number.isFinite(playback.fps) && playback.fps > 0 ? 1 / playback.fps : 0.01;
    return this.pasteGroup(group, group.anchorTimeMs / 1000 + step);
  }
  private pasteGroup(group: KeyframeClipboard, anchorTime: number): boolean {
    if (!this.working || !this.rig || !group.entries.length) return false;
    let pasted: ReturnType<typeof pasteKeyframeClipboard<ReadonlyAnimation>>;
    try {
      pasted = pasteKeyframeClipboard(this.working, this.rig, group, anchorTime * 1000);
    } catch (error) {
      this.document.reportError(error);
      this.actions.notify();
      return false;
    }
    const time = this.currentTime;
    this.cancelKeyframeDrag();
    this.playback.pause();
    this.playback.endScrub();
    this.actions.updateTime(time);
    return this.actions.install(freezeData(pasted.animation), false, pasted.keys);
  }

  get keyframeDrag(): KeyframeDrag | null {
    return this.drag;
  }
  get keyframeSnapMode(): KeyframeSnapMode {
    return this.snapMode;
  }
  get keyframeFPS(): number {
    const playback = this.working?.playback;
    return playback?.mode === 'stepped' ? playback.fps : DEFAULT_KEYFRAME_FPS;
  }
  setKeyframeSnapMode(mode: KeyframeSnapMode): void {
    if ((mode !== 'none' && mode !== 'frame') || mode === this.snapMode) return;
    this.snapMode = mode;
    this.actions.notify();
  }
  beginKeyframeDrag(key: KeyframeSelection): boolean {
    this.cancelKeyframeDrag();
    const originalPrimary = this.selection.key;
    const selected = this.selection.hasKey(key);
    if (selected) {
      this.playback.pause();
      this.playback.endScrub();
      this.selection.setKeys(this.selectedKeys, key);
      this.actions.updateTime(key.time);
    } else if (!this.actions.select(key)) return false;
    const anchor = this.selection.key!;
    this.drag = Object.freeze({
      key: anchor,
      originalKeys: this.selectedKeys,
      originalPrimary: selected ? originalPrimary! : anchor,
      previewTime: anchor.time,
      previewDelta: 0,
    });
    this.actions.notify();
    return true;
  }
  previewKeyframeDrag(time: number, disableSnapping = false): boolean {
    if (!this.drag || !Number.isFinite(time)) return false;
    const deltaMs = this.movementDelta(this.drag.originalKeys, this.drag.key, time, disableSnapping);
    const previewDelta = deltaMs / 1000;
    const previewTime = (this.drag.key.time * 1000 + deltaMs) / 1000;
    this.drag = Object.freeze({ ...this.drag, previewTime, previewDelta });
    this.actions.updateTime(previewTime);
    this.actions.notify();
    return true;
  }
  commitKeyframeDrag(): boolean {
    const drag = this.drag;
    if (!drag) return false;
    this.drag = null;
    return this.moveSelectedKeyframe(drag.previewTime);
  }
  cancelKeyframeDrag(): boolean {
    if (!this.drag) return false;
    const { key, originalKeys, originalPrimary } = this.drag;
    const time = key.time;
    this.drag = null;
    this.selection.setKeys(originalKeys, originalPrimary, false);
    this.actions.updateTime(time);
    this.actions.notify();
    return true;
  }
  /** Snap the anchor once, then constrain a single delta in authored milliseconds. */
  private movementDelta(
    keys: readonly KeyframeSelection[],
    anchor: KeyframeSelection,
    time: number,
    disableSnapping = false,
  ): number {
    const target = snapKeyframeTime(time, this.duration, disableSnapping ? 'none' : this.snapMode, this.keyframeFPS);
    return constrainKeyframeMoveDelta(
      keys.map((key) => key.time * 1000),
      target * 1000 - anchor.time * 1000,
      this.duration * 1000,
    );
  }
  /** Explicit time moves translate the selection relative to its primary, without snapping. */
  moveSelectedKeyframe(time: number): boolean {
    if (!Number.isFinite(time)) return false;
    this.cancelKeyframeDrag();
    const key = this.selection.key;
    if (!key) return false;
    this.playback.pause();
    this.playback.endScrub();
    const keys = this.selectedKeys;
    const primaryIndex = keys.indexOf(key);
    const delta = this.movementDelta(keys, key, time, true);
    return this.editKeyframes((animation, rig) => {
      const moved = moveBonePropertyKeyframes(
        animation,
        rig,
        keys.map((entry) => ({
          boneId: entry.boneId,
          property: entry.property,
          timeMs: entry.time * 1000,
        })),
        delta,
      );
      const selection = moved.keys.map((entry) => ({
        boneId: entry.boneId,
        property: entry.property,
        time: entry.timeMs / 1000,
      }));
      this.selection.setKeys(selection, selection[primaryIndex] ?? null);
      this.actions.updateTime(this.selection.key!.time);
      return moved.animation;
    }, key);
  }
  nudgeSelectedKeyframe(direction: -1 | 1, large = false): boolean {
    if (!this.selection.key || this.drag) return false;
    const step = this.snapMode === 'frame' ? 1 / this.keyframeFPS : 0.01;
    const anchor = this.selection.key;
    const time = (anchor.time * 1000 + direction * step * 1000 * (large ? 10 : 1)) / 1000;
    const delta = this.movementDelta(this.selectedKeys, anchor, time);
    return this.moveSelectedKeyframe((anchor.time * 1000 + delta) / 1000);
  }
  /** All selected authored properties are removed before installing one validated history snapshot. */
  deleteSelectedKeyframes(): boolean {
    this.cancelKeyframeDrag();
    if (!this.selectedKeys.length || !this.working || !this.rig) return false;
    this.playback.pause();
    return this.editKeyframes((animation, rig) => {
      const next = removeBonePropertyKeyframes(
        animation,
        rig,
        this.selectedKeys.map((key) => ({ boneId: key.boneId, property: key.property, timeMs: key.time * 1000 })),
      );
      this.selection.clearKey();
      return next;
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
      (animation, rig) => setBonePropertyKeyframe(animation, rig, boneId, property, timeSeconds * 1000, value),
      { boneId, property, time: timeSeconds },
    );
  }

  removeBonePropertyKeyframe(boneId: string, property: TransformProperty, timeSeconds = this.currentTime): boolean {
    return this.editKeyframes(
      (animation, rig) => {
        const key = findBonePropertyKeyframe(animation, boneId, property, timeSeconds * 1000);
        const next = removeBonePropertyKeyframe(animation, rig, boneId, property, timeSeconds * 1000);
        // Remove exact authored identity before nearby keys can be resolved through tolerance.
        if (next !== animation && key) this.selection.removeKey({ boneId, property, time: key.time / 1000 });
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
    this.cancelKeyframeDrag();
    if (!this.working || !this.rig) return false;
    let next: ReadonlyAnimation;
    try {
      next = edit(this.working, this.rig);
    } catch (error) {
      this.document.reportError(error);
      this.actions.notify();
      return false;
    }
    // The mutation helper validated the result and shares only the document's owned frozen branches.
    if (
      draftTarget?.boneId === this.selection.boneId &&
      keyframeTimesMatch(draftTarget.time * 1000, this.currentTime * 1000) &&
      this.selection.draft[draftTarget.property] !== undefined
    ) {
      this.selection.clearDraftProperty(draftTarget.property);
    }
    return this.actions.install(freezeData(next), draftTarget !== undefined);
  }
}
