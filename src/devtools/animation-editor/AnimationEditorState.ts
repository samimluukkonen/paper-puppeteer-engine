import type { AnimationClip, AnimationPlaybackMode, PropertyKeyframe } from '../../engine/AnimationClip.js';
import {
  ANIMATION_FORMAT_VERSION,
  AnimationValidationError,
  inspectAnimationDefinition,
  parseAnimationClip,
  type ValidationIssue,
} from '../../engine/externalData.js';
import type { Rig } from '../../engine/Rig.js';
import { type JointTransform, type TransformProperty, transformProperties } from '../../engine/types.js';
import { equalEditorData, freezeData, type ReadonlyEditorData } from '../shared/editorData.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
import { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import { AnimationEditorSelection } from './AnimationEditorSelection.js';
import {
  findBonePropertyKeyframe,
  getEvaluatedBonePropertyValue,
  getEvaluatedBoneTransform,
  getKeyedPropertiesAtTime,
  hasKeyframeAtTime,
  keyframeTimesMatch,
  removeBonePropertyKeyframe,
  setBonePropertyKeyframe,
} from './keyframes.js';
import { animationDurationSeconds } from './timeline.js';
import type { KeyframeSelection, TimelineTrack } from './timelineTracks.js';

export { PREVIEW_PLAYBACK_SPEEDS } from './AnimationEditorPlayback.js';
export const AUTHORED_FPS_MIN = 1;
export const AUTHORED_FPS_MAX = 240;
export const DEFAULT_AUTHORED_FPS = 10;

/** Same external file fields; event data remains unknown to callers and is validated as JSON before ownership. */
export type ReadonlyAnimation = ReadonlyEditorData<AnimationClip> & {
  readonly version: typeof ANIMATION_FORMAT_VERSION;
};
type AnimationEntry = {
  source: ReadonlyAnimation | null;
  saved: ReadonlyAnimation | null;
  issues: readonly ValidationIssue[];
};

/** Owns animation data and navigation independently of the DOM and Phaser.
 * Authored replacements use the rig editor's snapshot history. Navigation never enters history.
 */
export class AnimationEditorState {
  private readonly animations = new Map<string, AnimationEntry>();
  private readonly listeners = new Set<() => void>();
  private source: ReadonlyAnimation | null = null;
  private working: ReadonlyAnimation | null = null;
  private selectedId: string | null = null;
  private readonly playback = new AnimationEditorPlayback(() => this.duration);
  private saved: ReadonlyAnimation | null = null;
  private cachedDirty: boolean | undefined;
  private issues: readonly ValidationIssue[] = [];
  private history = this.createHistory();
  private readonly selection: AnimationEditorSelection;

  constructor(
    readonly rig?: Rig,
    animations: readonly AnimationClip[] = [],
  ) {
    this.selection = new AnimationEditorSelection(rig);
    for (const animation of animations) {
      const file = this.inspect({ ...animation, version: ANIMATION_FORMAT_VERSION });
      this.animations.set(animation.name, { source: file, saved: file, issues: this.issues });
    }
    this.issues = [];
  }

  get animationIds(): readonly string[] {
    return [...this.animations.keys()];
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
  /** Resolve identity through the central tolerance policy, then select and seek in one notification. */
  selectKeyframe(selection: KeyframeSelection): boolean {
    const { boneId, property, time } = selection;
    if (!this.rig?.hasBone(boneId)) return false;
    const key = this.findBonePropertyKeyframe(boneId, property, time);
    if (!key) return false;
    this.playback.pause();
    this.playback.endScrub();
    this.selection.selectKey({ boneId, property, time: key.time / 1000 });
    this.updateTime(key.time / 1000);
    this.notify();
    return true;
  }
  clearKeyframeSelection(): void {
    if (this.selection.clearKey()) this.notify();
  }
  /** Delete the selected authored time even when the playhead has scrubbed elsewhere. */
  deleteSelectedKeyframe(): boolean {
    const key = this.selection.key;
    if (!key) return false;
    this.playback.pause();
    this.clearTransformDraft();
    return this.removeBonePropertyKeyframe(key.boneId, key.property, key.time);
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
    if (this.selection.setExpanded(boneId, expanded)) this.notify();
    return true;
  }
  /** Atomic bone + property selection uses the same bone owner as hierarchy and preview picking. */
  selectTimelineProperty(boneId: string, property: TransformProperty): boolean {
    if (!this.rig?.hasBone(boneId) || !transformProperties.includes(property)) return false;
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
    if (this.selection.selectBone(id)) this.notify();
    return true;
  }
  /** Focusing an authoring field pauses at the held time, even before the first input. */
  beginTransformEdit(): void {
    if (this.selection.boneId && this.working) this.pause();
  }
  setTemporaryBoneProperty(property: TransformProperty, value: number): boolean {
    if (!this.selection.boneId || !this.working || !transformProperties.includes(property) || !Number.isFinite(value))
      return false;
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
    return this.selectedId;
  }
  get sourceAnimation(): ReadonlyAnimation | null {
    return this.source;
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
    this.cachedDirty ??= !equalEditorData(this.working, this.saved);
    return this.cachedDirty;
  }
  get validationIssues(): readonly ValidationIssue[] {
    return this.issues;
  }
  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }
  get historyLength(): number {
    return this.history.length;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private inspect(input: unknown): ReadonlyAnimation | null {
    if (!this.rig) {
      this.issues = [{ severity: 'error', message: 'Load a character before selecting an animation.' }];
      return null;
    }
    const result = inspectAnimationDefinition(input, this.rig);
    this.issues = freezeData(result.issues);
    if (!result.data) return null;
    // The shared validator checks JSON compatibility and rig references before any clone is installed.
    return freezeData({ ...result.data, version: ANIMATION_FORMAT_VERSION });
  }

  /** Failed selections preserve the working copy; callers may explicitly discard authored changes. */
  selectAnimation(id: string | null, options: { discardChanges?: boolean } = {}): boolean {
    if (this.dirty && !options.discardChanges) {
      this.issues = [
        { severity: 'error', message: 'Unsaved animation changes; download, discard, or undo edits before selecting.' },
      ];
      this.notify();
      return false;
    }
    const entry = id === null ? undefined : this.animations.get(id);
    if (id !== null && !entry?.source) {
      this.issues = entry?.issues ?? [{ severity: 'error', message: `Animation "${id}" is missing.` }];
      this.notify();
      return false;
    }
    this.source = entry?.source ?? null;
    this.working = entry?.saved ? freezeData(structuredClone(entry.saved)) : null;
    this.selectedId = id;
    this.selection.resetAnimation();
    this.playback.reset();
    this.issues = [];
    this.saved = this.working;
    this.cachedDirty = false;
    this.history = this.createHistory();
    this.notify();
    return true;
  }

  setCurrentTime(time: number): void {
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
      this.issues = [
        {
          severity: 'error',
          path: 'playback.fps',
          message: `Animation FPS must be a finite number from ${AUTHORED_FPS_MIN} to ${AUTHORED_FPS_MAX}.`,
        },
      ];
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
        // Clear the key actually removed, even if a distinct nearby authored time is within tolerance.
        if (
          next !== animation &&
          this.selection.key?.boneId === boneId &&
          this.selection.key.property === property &&
          key !== undefined &&
          key.time / 1000 === this.selection.key.time
        )
          this.selection.clearKey();
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
      this.issues = freezeData(
        error instanceof AnimationValidationError
          ? error.issues
          : [{ severity: 'error' as const, message: error instanceof Error ? error.message : String(error) }],
      );
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
    if (!this.working) return;
    const cancelled = this.clearTransformDraft();
    if (this.playback.beginScrub() || cancelled) this.notify();
  }

  endScrub(): void {
    this.notifyPlaybackChange(this.currentTime, this.playback.endScrub());
  }

  /** Resume the sole editor clock; a completed clip starts again at zero. */
  play(): void {
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
    const next = this.inspect(input);
    if (!next) {
      this.notify();
      return false;
    }
    return this.installWorkingAnimation(next);
  }

  /** Internal edits have already validated their changes and retain immutable unchanged branches. */
  private installWorkingAnimation(next: ReadonlyAnimation, retainDraft = false): boolean {
    this.issues = [];
    if (next.name !== this.selectedId) {
      this.issues = [
        {
          severity: 'error',
          path: 'name',
          message: `Animation name must remain "${this.selectedId}"; renaming is not supported.`,
        },
      ];
      this.notify();
      return false;
    }
    if (!retainDraft) this.clearTransformDraft();
    if (!equalEditorData(this.working, next)) {
      this.history.change(() => {
        this.working = next;
        this.cachedDirty = undefined;
      });
    }
    this.updateTime(this.currentTime);
    this.validateKeyframeSelection();
    this.notify();
    return true;
  }

  /** Export committed authored data only; drafts, selection, history and preview preferences stay local. */
  exportJson(): string {
    if (!this.working || !this.rig) throw new Error('No animation is selected.');
    const animation = parseAnimationClip(this.working, this.rig);
    return `${JSON.stringify({ version: ANIMATION_FORMAT_VERSION, ...animation }, null, 2)}\n`;
  }

  markSaved(): void {
    const entry = this.selectedId === null ? undefined : this.animations.get(this.selectedId);
    if (entry) entry.saved = this.working;
    this.saved = this.working;
    this.cachedDirty = false;
    this.issues = [];
    this.notify();
  }

  private createHistory(): SnapshotHistory<ReadonlyAnimation | null> {
    return new SnapshotHistory(
      () => this.working,
      (entry) => {
        this.clearTransformDraft();
        this.working = entry;
        this.cachedDirty = undefined;
        this.updateTime(this.currentTime);
        this.validateKeyframeSelection();
      },
      equalEditorData,
    );
  }

  undo(): boolean {
    return this.restoreHistory(() => this.history.undo());
  }
  redo(): boolean {
    return this.restoreHistory(() => this.history.redo());
  }
  private restoreHistory(restore: () => boolean): boolean {
    // Undo/redo is also a cancellation boundary when the requested history stack is empty.
    const cancelled = this.clearTransformDraft();
    const changed = restore();
    if (changed) this.issues = [];
    if (changed || cancelled) this.notify();
    return changed;
  }
}
