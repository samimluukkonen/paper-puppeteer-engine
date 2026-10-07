import type { Rig } from '../../engine/Rig.js';
import type { TransformProperty } from '../../engine/types.js';
import { freezeData } from '../shared/editorData.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import type { AnimationEditorSelection } from './AnimationEditorSelection.js';
import { copyKeyframeSelection, pasteKeyframeClipboard, type KeyframeClipboard } from './keyframeClipboard.js';
import {
  findBonePropertyKeyframe,
  keyframeTimesMatch,
  moveBonePropertyKeyframe,
  removeBonePropertyKeyframe,
  removeBonePropertyKeyframes,
  setBonePropertyKeyframe,
} from './keyframes.js';
import { animationDurationSeconds, DEFAULT_KEYFRAME_FPS, snapKeyframeTime, type KeyframeSnapMode } from './timeline.js';
import type { KeyframeSelection } from './timelineTracks.js';

export interface KeyframeDrag {
  readonly key: KeyframeSelection;
  readonly previewTime: number;
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
    if (!this.actions.select(key)) return false;
    this.drag = Object.freeze({ key: this.selection.key!, previewTime: this.currentTime });
    this.actions.notify();
    return true;
  }
  previewKeyframeDrag(time: number, disableSnapping = false): boolean {
    if (!this.drag || !Number.isFinite(time)) return false;
    const previewTime = snapKeyframeTime(
      time,
      this.duration,
      disableSnapping ? 'none' : this.snapMode,
      this.keyframeFPS,
    );
    this.drag = Object.freeze({ key: this.drag.key, previewTime });
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
    const time = this.drag.key.time;
    this.drag = null;
    this.actions.updateTime(time);
    this.actions.notify();
    return true;
  }
  /** Explicit time moves are continuous seconds; only drag/nudge apply editor snapping. */
  moveSelectedKeyframe(time: number): boolean {
    const key = this.selection.key;
    if (!key || !Number.isFinite(time)) return false;
    time = Math.max(0, Math.min(time, this.duration));
    this.cancelKeyframeDrag();
    this.playback.pause();
    return this.editKeyframes((animation, rig) => {
      const next = moveBonePropertyKeyframe(animation, rig, key.boneId, key.property, key.time * 1000, time * 1000);
      const moved = findBonePropertyKeyframe(
        next,
        key.boneId,
        key.property,
        (next === animation ? key.time : time) * 1000,
      );
      if (moved) {
        this.selection.moveKey(key, { ...key, time: moved.time / 1000 });
        this.actions.updateTime(moved.time / 1000);
      }
      return next;
    }, key);
  }
  nudgeSelectedKeyframe(direction: -1 | 1, large = false): boolean {
    if (!this.selection.key || this.selectedKeys.length !== 1 || this.drag) return false;
    const step = this.snapMode === 'frame' ? 1 / this.keyframeFPS : 0.01;
    const time = this.selection.key.time + direction * step * (large ? 10 : 1);
    return this.moveSelectedKeyframe(snapKeyframeTime(time, this.duration, this.snapMode, this.keyframeFPS));
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
