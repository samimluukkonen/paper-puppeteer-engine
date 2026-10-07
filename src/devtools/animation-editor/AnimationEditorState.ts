import type { AnimationClip, AnimationPlaybackMode, PropertyKeyframe } from '../../engine/AnimationClip.js';
import type { ValidationIssue } from '../../engine/externalData.js';
import type { Rig } from '../../engine/Rig.js';
import { type JointTransform, type TransformProperty, transformProperties } from '../../engine/types.js';
import { freezeData } from '../shared/editorData.js';
import {
  AnimationEditorDocument,
  type AnimationEditorStateOptions,
  type ReadonlyAnimation,
} from './AnimationEditorDocument.js';
import { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import { AnimationEditorSelection } from './AnimationEditorSelection.js';
import {
  findBonePropertyKeyframe,
  getEvaluatedBonePropertyValue,
  getEvaluatedBoneTransform,
  getKeyedPropertiesAtTime,
  hasKeyframeAtTime,
  keyframeTimesMatch,
  moveBonePropertyKeyframe,
  removeBonePropertyKeyframe,
  removeBonePropertyKeyframes,
  setBonePropertyKeyframe,
} from './keyframes.js';
import {
  keysInMarquee,
  resolveKey,
  sameKey,
  type KeyframeMarquee,
  type KeyframeSelectionModifiers,
} from './keyframeSelection.js';
import { animationDurationSeconds, DEFAULT_KEYFRAME_FPS, snapKeyframeTime, type KeyframeSnapMode } from './timeline.js';
import type { KeyframeSelection, TimelineTrack } from './timelineTracks.js';

export { PREVIEW_PLAYBACK_SPEEDS } from './AnimationEditorPlayback.js';
export const AUTHORED_FPS_MIN = 1;
export const AUTHORED_FPS_MAX = 240;
export const DEFAULT_AUTHORED_FPS = DEFAULT_KEYFRAME_FPS;

export type { AnimationEditorStateOptions, ReadonlyAnimation } from './AnimationEditorDocument.js';

export interface KeyframeDrag {
  readonly key: KeyframeSelection;
  readonly previewTime: number;
}

/** Coordinates authored edits with transient selection, drafts, gestures and preview playback. */
export class AnimationEditorState {
  private readonly document: AnimationEditorDocument;
  private readonly listeners = new Set<() => void>();
  private readonly playback = new AnimationEditorPlayback(() => this.duration);
  private readonly selection: AnimationEditorSelection;
  private drag: KeyframeDrag | null = null;
  private snapMode: KeyframeSnapMode = 'none';

  constructor(
    readonly rig?: Rig,
    animations: readonly AnimationClip[] = [],
    options: AnimationEditorStateOptions = {},
  ) {
    this.document = new AnimationEditorDocument(rig, animations, options);
    this.selection = new AnimationEditorSelection(rig);
  }

  private get working(): ReadonlyAnimation | null {
    return this.document.workingAnimation;
  }

  get animationIds(): readonly string[] {
    return this.document.animationIds;
  }
  get selectedBoneId(): string | null {
    return this.selection.boneId;
  }
  get selectedTimelineProperty(): TransformProperty | null {
    return this.selection.property;
  }
  get selectedKeyframe(): KeyframeSelection | null {
    return this.selection.key;
  }
  get selectedKeys(): readonly KeyframeSelection[] {
    return this.selection.keys;
  }
  get primaryKey(): KeyframeSelection | null {
    return this.selection.key;
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
    this.notify();
  }
  beginKeyframeDrag(key: KeyframeSelection): boolean {
    this.cancelKeyframeDrag();
    if (!this.selectKeyframe(key)) return false;
    this.drag = Object.freeze({ key: this.selection.key!, previewTime: this.currentTime });
    this.notify();
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
    this.updateTime(previewTime);
    this.notify();
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
    this.updateTime(time);
    this.notify();
    return true;
  }
  /** Explicit time moves are continuous seconds; only drag/nudge apply editor snapping. */
  moveSelectedKeyframe(time: number): boolean {
    const key = this.selection.key;
    if (!key || !Number.isFinite(time)) return false;
    time = Math.max(0, Math.min(time, this.duration));
    this.cancelKeyframeDrag();
    this.playback.pause();
    return this.editKeyframe(
      (animation, rig) => {
        const next = moveBonePropertyKeyframe(animation, rig, key.boneId, key.property, key.time * 1000, time * 1000);
        const moved = findBonePropertyKeyframe(
          next,
          key.boneId,
          key.property,
          (next === animation ? key.time : time) * 1000,
        );
        if (moved) {
          this.selection.moveKey(key, { ...key, time: moved.time / 1000 });
          this.updateTime(moved.time / 1000);
        }
        return next;
      },
      key.boneId,
      key.property,
      key.time,
    );
  }
  nudgeSelectedKeyframe(direction: -1 | 1, large = false): boolean {
    if (!this.selection.key || this.selectedKeys.length !== 1 || this.drag) return false;
    const step = this.snapMode === 'frame' ? 1 / this.keyframeFPS : 0.01;
    const time = this.selection.key.time + direction * step * (large ? 10 : 1);
    return this.moveSelectedKeyframe(snapKeyframeTime(time, this.duration, this.snapMode, this.keyframeFPS));
  }
  /** Resolve identity through the central tolerance policy, then select and seek in one notification. */
  selectKeyframe(selection: KeyframeSelection, modifiers: KeyframeSelectionModifiers = {}): boolean {
    const { boneId, property, time } = selection;
    if (!this.rig?.hasBone(boneId)) return false;
    const key = this.findBonePropertyKeyframe(boneId, property, time);
    if (!key) return false;
    this.cancelKeyframeDrag();
    this.playback.pause();
    this.playback.endScrub();
    const clicked = Object.freeze({ boneId, property, time: key.time / 1000 });
    const anchor = this.selection.anchor;
    if (modifiers.range && anchor) {
      // Range stays anchored across repeated Shift-clicks. Cross-track Shift adds and makes the clicked key primary.
      const track = this.timelineTracks.find(
        (row) => row.kind === 'property' && row.boneId === boneId && row.property === property,
      );
      const range =
        anchor.boneId === boneId && anchor.property === property && track?.kind === 'property'
          ? track.keyframes.filter(
              (entry) =>
                entry.time >= Math.min(anchor.time, clicked.time) && entry.time <= Math.max(anchor.time, clicked.time),
            )
          : [...this.selectedKeys, clicked];
      this.selection.setKeys(modifiers.additive ? [...this.selectedKeys, ...range] : range, clicked);
      this.updateTime(clicked.time);
    } else if (modifiers.additive) {
      const exists = this.selection.hasKey(clicked);
      this.selection.setKeys(
        exists ? this.selectedKeys.filter((entry) => !sameKey(entry, clicked)) : [...this.selectedKeys, clicked],
        this.primaryKey,
      );
      // Add/toggle retains primary where possible; fallback primary never seeks.
    } else {
      this.selection.selectKey(clicked);
      this.updateTime(clicked.time);
    }
    this.notify();
    return true;
  }
  clearKeyframeSelection(): void {
    this.cancelKeyframeDrag();
    if (this.selection.clearKey()) this.notify();
  }
  /** Resolve externally supplied references before installing transient box selection. */
  selectKeyframes(keys: readonly KeyframeSelection[], additive = false): void {
    this.cancelKeyframeDrag();
    this.playback.pause();
    this.playback.endScrub();
    const resolved = keys.flatMap((key) => {
      const ref = resolveKey(this.working, key);
      return ref ? [ref] : [];
    });
    const previous = this.primaryKey;
    this.selection.setKeys(additive ? [...this.selectedKeys, ...resolved] : resolved, previous);
    if (!additive && this.primaryKey && (!previous || !sameKey(previous, this.primaryKey)))
      this.updateTime(this.primaryKey.time);
    this.notify();
  }
  selectKeyframeMarquee(box: KeyframeMarquee, additive = false): void {
    this.selectKeyframes(keysInMarquee(this.timelineTracks, box), additive);
  }
  /** All selected authored properties are removed before installing one validated history snapshot. */
  deleteSelectedKeyframes(): boolean {
    this.cancelKeyframeDrag();
    if (!this.selectedKeys.length || !this.working || !this.rig) return false;
    this.playback.pause();
    let next = this.working;
    try {
      next = removeBonePropertyKeyframes(
        this.working,
        this.rig,
        this.selectedKeys.map((key) => ({ boneId: key.boneId, property: key.property, timeMs: key.time * 1000 })),
      );
    } catch (error) {
      this.document.reportError(error);
      this.notify();
      return false;
    }
    this.selection.clearKey();
    return this.installWorkingAnimation(freezeData(next));
  }
  /** Compatibility alias: deletion now operates on the whole selection. */
  deleteSelectedKeyframe(): boolean {
    return this.deleteSelectedKeyframes();
  }
  /** Previous/next authored key on the selected property, relative to the current playhead. */
  getAdjacentKeyframe(direction: -1 | 1): KeyframeSelection | undefined {
    return this.selection.adjacentKey(this.working, this.currentTime, direction);
  }
  selectAdjacentKeyframe(direction: -1 | 1): boolean {
    const key = this.getAdjacentKeyframe(direction);
    return key ? this.selectKeyframe(key) : false;
  }
  /** Authored snapshots are authoritative; history never restores transient selection. */
  private validateKeyframeSelection(): void {
    this.selection.validateKey(this.working);
  }
  /** Cached immutable editor rows: playback and selection never rebuild layout or authored-key queries. */
  get timelineTracks(): readonly TimelineTrack[] {
    return this.selection.tracks(this.working);
  }
  isTimelineBoneExpanded(boneId: string): boolean {
    return this.selection.isExpanded(boneId);
  }
  setTimelineBoneExpanded(boneId: string, expanded: boolean): boolean {
    if (!this.rig?.hasBone(boneId)) return false;
    this.cancelKeyframeDrag();
    if (this.selection.setExpanded(boneId, expanded)) this.notify();
    return true;
  }
  /** Atomic bone + property selection uses the same bone owner as hierarchy and preview picking. */
  selectTimelineProperty(boneId: string, property: TransformProperty): boolean {
    if (!this.rig?.hasBone(boneId) || !transformProperties.includes(property)) return false;
    this.cancelKeyframeDrag();
    if (this.selection.selectProperty(boneId, property)) this.notify();
    return true;
  }
  /** Editor-only prospective local values, never serialized or recorded in history. */
  get boneTransformDraft(): Readonly<Partial<JointTransform>> {
    return this.selection.draft;
  }
  get hasTemporaryTransform(): boolean {
    return this.selection.hasDraft;
  }
  get selectedBoneTransform(): JointTransform | undefined {
    const evaluated = this.selection.boneId ? this.getEvaluatedBoneTransform(this.selection.boneId) : undefined;
    return evaluated ? { ...evaluated, ...this.selection.draft } : undefined;
  }
  selectBone(id: string | null): boolean {
    if (id !== null && !this.rig?.hasBone(id)) return false;
    this.cancelKeyframeDrag();
    if (this.selection.selectBone(id)) this.notify();
    return true;
  }
  /** Focusing an authoring field pauses at the held time, even before the first input. */
  beginTransformEdit(): void {
    this.cancelKeyframeDrag();
    if (this.selection.boneId && this.working) this.pause();
  }
  setTemporaryBoneProperty(property: TransformProperty, value: number): boolean {
    if (!this.selection.boneId || !this.working || !transformProperties.includes(property) || !Number.isFinite(value))
      return false;
    this.cancelKeyframeDrag();
    this.playback.pause();
    this.selection.setDraft(property, value);
    this.notify();
    return true;
  }
  commitBoneProperty(property: TransformProperty): boolean {
    if (!this.selection.boneId || !transformProperties.includes(property)) return false;
    this.beginTransformEdit();
    const value = this.selectedBoneTransform?.[property];
    return value !== undefined && this.setBonePropertyKeyframe(this.selection.boneId, property, value);
  }
  deleteBonePropertyKey(property: TransformProperty): boolean {
    if (!this.selection.boneId || !transformProperties.includes(property)) return false;
    this.beginTransformEdit();
    return this.removeBonePropertyKeyframe(this.selection.boneId, property);
  }
  cancelTransformEdit(): void {
    if (!this.hasTemporaryTransform) return;
    this.clearTransformDraft();
    this.notify();
  }
  private clearTransformDraft(): boolean {
    return this.selection.clearDraft();
  }
  get selectedAnimationId(): string | null {
    return this.document.selectedAnimationId;
  }
  get selectedAnimationFilename(): string | undefined {
    return this.document.selectedAnimationFilename;
  }
  get sourceAnimation(): ReadonlyAnimation | null {
    return this.document.sourceAnimation;
  }
  get workingAnimation(): ReadonlyAnimation | null {
    return this.working;
  }
  get currentTime(): number {
    return this.playback.currentTime;
  }
  get duration(): number {
    return animationDurationSeconds(this.working);
  }
  get isPlaying(): boolean {
    return this.playback.isPlaying;
  }
  get previewLoop(): boolean {
    return this.playback.previewLoop;
  }
  get playbackSpeed(): number {
    return this.playback.playbackSpeed;
  }
  get isScrubbing(): boolean {
    return this.playback.isScrubbing;
  }
  get loop(): boolean {
    return this.working?.loop ?? false;
  }
  get dirty(): boolean {
    return this.document.dirty;
  }
  get validationIssues(): readonly ValidationIssue[] {
    return this.document.validationIssues;
  }
  get canUndo(): boolean {
    return this.document.canUndo;
  }
  get canRedo(): boolean {
    return this.document.canRedo;
  }
  get historyLength(): number {
    return this.document.historyLength;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Failed selections preserve the working copy; callers may explicitly discard authored changes. */
  selectAnimation(id: string | null, options: { discardChanges?: boolean } = {}): boolean {
    this.cancelKeyframeDrag();
    const selected = this.document.selectAnimation(id, options);
    if (selected) {
      this.selection.resetAnimation();
      this.playback.reset();
    }
    this.notify();
    return selected;
  }

  setCurrentTime(time: number): void {
    this.cancelKeyframeDrag();
    // Explicit navigation cancels drafts even when clamping leaves the playhead at the same endpoint.
    const cancelled = this.clearTransformDraft();
    if (this.updateTime(time) || cancelled) this.notify();
  }

  /** Clamp navigation and authored edits using the same loop and scrub playback intent. */
  private updateTime(time: number): boolean {
    const previous = this.currentTime;
    const changed = this.playback.setCurrentTime(time);
    if (previous !== this.currentTime) this.clearTransformDraft();
    return changed;
  }

  private notifyPlaybackChange(previous: number, changed: boolean): void {
    if (previous !== this.currentTime) this.clearTransformDraft();
    if (changed) this.notify();
  }

  /** Preview preferences stay outside authored data and history. */
  setPreviewLoop(loop: boolean): void {
    this.notifyPlaybackChange(this.currentTime, this.playback.setPreviewLoop(loop));
  }

  /** A preview preference, never serialized or recorded in authored history. */
  setPlaybackSpeed(speed: number): boolean {
    const previous = this.playbackSpeed;
    if (!this.playback.setPlaybackSpeed(speed)) return false;
    if (speed !== previous) this.notify();
    return true;
  }

  /** FPS only exists on stepped clips in the runtime format; keys and events retain millisecond times. */
  setAuthoredFPS(fps: number): boolean {
    if (this.working?.playback?.mode !== 'stepped') return false;
    if (!Number.isFinite(fps) || fps < AUTHORED_FPS_MIN || fps > AUTHORED_FPS_MAX) {
      this.document.reportIssues([
        {
          severity: 'error',
          path: 'playback.fps',
          message: `Animation FPS must be a finite number from ${AUTHORED_FPS_MIN} to ${AUTHORED_FPS_MAX}.`,
        },
      ]);
      this.notify();
      return false;
    }
    return this.installWorkingAnimation(freezeData({ ...this.working, playback: { mode: 'stepped', fps } }));
  }

  setAuthoredPlaybackMode(mode: AnimationPlaybackMode['mode']): boolean {
    if (!this.working || (mode !== 'smooth' && mode !== 'stepped')) return false;
    if (mode === (this.working.playback?.mode ?? 'smooth')) return true;
    return this.installWorkingAnimation(
      freezeData({
        ...this.working,
        playback: mode === 'smooth' ? { mode } : { mode, fps: DEFAULT_AUTHORED_FPS },
      }),
    );
  }

  /** State-facing authoring uses continuous seconds, defaulting to the sole editor clock. */
  setBonePropertyKeyframe(
    boneId: string,
    property: TransformProperty,
    value: number,
    timeSeconds = this.currentTime,
  ): boolean {
    return this.editKeyframe(
      (animation, rig) => setBonePropertyKeyframe(animation, rig, boneId, property, timeSeconds * 1000, value),
      boneId,
      property,
      timeSeconds,
    );
  }

  removeBonePropertyKeyframe(boneId: string, property: TransformProperty, timeSeconds = this.currentTime): boolean {
    return this.editKeyframe(
      (animation, rig) => {
        const key = findBonePropertyKeyframe(animation, boneId, property, timeSeconds * 1000);
        const next = removeBonePropertyKeyframe(animation, rig, boneId, property, timeSeconds * 1000);
        // Remove exact authored identity before nearby keys can be resolved through tolerance.
        if (next !== animation && key) this.selection.removeKey({ boneId, property, time: key.time / 1000 });
        return next;
      },
      boneId,
      property,
      timeSeconds,
    );
  }

  private editKeyframe(
    edit: (animation: ReadonlyAnimation, rig: Rig) => ReadonlyAnimation,
    boneId: string,
    property: TransformProperty,
    timeSeconds: number,
  ): boolean {
    if (!this.working || !this.rig) return false;
    let next: ReadonlyAnimation;
    try {
      next = edit(this.working, this.rig);
    } catch (error) {
      this.document.reportError(error);
      this.notify();
      return false;
    }
    // The mutation helper validated the result and shares only this state's owned frozen branches.
    if (
      boneId === this.selection.boneId &&
      keyframeTimesMatch(timeSeconds * 1000, this.currentTime * 1000) &&
      this.selection.draft[property] !== undefined
    ) {
      this.selection.clearDraftProperty(property);
    }
    return this.installWorkingAnimation(freezeData(next), true);
  }

  /** Queries never install animation snapshots or change validation, history, or dirty state.
   * Returned keyframe times are milliseconds, matching the external authored format.
   */
  findBonePropertyKeyframe(
    boneId: string,
    property: TransformProperty,
    timeSeconds = this.currentTime,
  ): PropertyKeyframe | undefined {
    return this.working ? findBonePropertyKeyframe(this.working, boneId, property, timeSeconds * 1000) : undefined;
  }

  hasKeyframeAtTime(boneId: string, property: TransformProperty, timeSeconds = this.currentTime): boolean {
    return this.working ? hasKeyframeAtTime(this.working, boneId, property, timeSeconds * 1000) : false;
  }

  getKeyedPropertiesAtTime(boneId: string, timeSeconds = this.currentTime): TransformProperty[] {
    return this.working ? getKeyedPropertiesAtTime(this.working, boneId, timeSeconds * 1000) : [];
  }

  getEvaluatedBonePropertyValue(
    boneId: string,
    property: TransformProperty,
    timeSeconds = this.currentTime,
  ): number | undefined {
    return this.working && this.rig
      ? getEvaluatedBonePropertyValue(this.working, this.rig, boneId, property, timeSeconds * 1000)
      : undefined;
  }

  getEvaluatedBoneTransform(boneId: string, timeSeconds = this.currentTime): JointTransform | undefined {
    return this.working && this.rig
      ? getEvaluatedBoneTransform(this.working, this.rig, boneId, timeSeconds * 1000)
      : undefined;
  }

  /** Keep playback intent while the pointer owns time; pause/play can still change that intent. */
  beginScrub(): void {
    this.cancelKeyframeDrag();
    if (!this.working) return;
    const cancelled = this.clearTransformDraft();
    if (this.playback.beginScrub() || cancelled) this.notify();
  }

  endScrub(): void {
    this.notifyPlaybackChange(this.currentTime, this.playback.endScrub());
  }

  /** Resume the sole editor clock; a completed clip starts again at zero. */
  play(): void {
    if (this.drag) return;
    if (!this.playback.play()) return;
    this.clearTransformDraft();
    this.notify();
  }

  pause(): void {
    this.notifyPlaybackChange(this.currentTime, this.playback.pause());
  }

  togglePlayback(): void {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  /** Rewind immediately, preserving whether playback is active. */
  restart(): void {
    this.setCurrentTime(0);
  }

  /** Phaser supplies elapsed milliseconds; the scene converts them to continuous seconds here. */
  advancePlayback(deltaSeconds: number): void {
    this.notifyPlaybackChange(this.currentTime, this.playback.advance(deltaSeconds));
  }

  /** Authored edit boundary: validate atomically, own a fresh JSON copy, and record one history entry. */
  replaceWorkingAnimation(input: unknown): boolean {
    if (!this.working) return false;
    const next = this.document.inspect(input);
    if (!next) {
      this.notify();
      return false;
    }
    return this.installWorkingAnimation(next);
  }

  /** Internal edits have already validated their changes and retain immutable unchanged branches. */
  private installWorkingAnimation(next: ReadonlyAnimation, retainDraft = false): boolean {
    this.cancelKeyframeDrag();
    if (!this.document.install(next)) {
      this.notify();
      return false;
    }
    if (!retainDraft) this.clearTransformDraft();
    this.updateTime(this.currentTime);
    this.validateKeyframeSelection();
    this.notify();
    return true;
  }

  /** Export committed authored data only; drafts, selection, history and preview preferences stay local. */
  exportJson(): string {
    return this.document.exportJson();
  }

  markSaved(): void {
    this.document.markSaved();
    this.notify();
  }

  undo(): boolean {
    return this.restoreHistory(() => this.document.undo());
  }
  redo(): boolean {
    return this.restoreHistory(() => this.document.redo());
  }
  private restoreHistory(restore: () => boolean): boolean {
    // Undo/redo is also a cancellation boundary when the requested history stack is empty.
    const cancelledDrag = this.cancelKeyframeDrag();
    const cancelled = this.clearTransformDraft() || cancelledDrag;
    const changed = restore();
    if (changed) {
      this.updateTime(this.currentTime);
      this.validateKeyframeSelection();
    }
    if (changed || cancelled) this.notify();
    return changed;
  }
}
