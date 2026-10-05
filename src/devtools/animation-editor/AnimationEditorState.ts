import type { AnimationClip, AnimationPlaybackMode, PropertyKeyframe } from '../../engine/AnimationClip.js';
import {
  ANIMATION_FORMAT_VERSION,
  AnimationValidationError,
  inspectAnimationDefinition,
  type ValidationIssue,
} from '../../engine/externalData.js';
import type { Rig } from '../../engine/Rig.js';
import { type JointTransform, type TransformProperty, transformProperties } from '../../engine/types.js';
import { equalEditorData, freezeData, type ReadonlyEditorData } from '../shared/editorData.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
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
import { animationDurationSeconds, clampTime } from './timeline.js';

export const PREVIEW_PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;
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
  private time = 0;
  private playing = false;
  private previewLoopEnabled = false;
  private speed = 1;
  private scrubbing = false;
  private saved: ReadonlyAnimation | null = null;
  private cachedDirty: boolean | undefined;
  private issues: readonly ValidationIssue[] = [];
  private history = this.createHistory();
  private selectedBone: string | null = null;
  private temporaryTransform: Readonly<Partial<JointTransform>> = Object.freeze({});

  constructor(
    readonly rig?: Rig,
    animations: readonly AnimationClip[] = [],
  ) {
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
    return this.selectedBone;
  }
  /** Editor-only prospective local values, never serialized or recorded in history. */
  get boneTransformDraft(): Readonly<Partial<JointTransform>> {
    return this.temporaryTransform;
  }
  get hasTemporaryTransform(): boolean {
    return Object.keys(this.temporaryTransform).length > 0;
  }
  get selectedBoneTransform(): JointTransform | undefined {
    const evaluated = this.selectedBone ? this.getEvaluatedBoneTransform(this.selectedBone) : undefined;
    return evaluated ? { ...evaluated, ...this.temporaryTransform } : undefined;
  }
  selectBone(id: string | null): boolean {
    if (id !== null && !this.rig?.hasBone(id)) return false;
    if (id !== this.selectedBone) {
      this.selectedBone = id;
      this.clearTransformDraft();
      this.notify();
    }
    return true;
  }
  /** Focusing an authoring field pauses at the held time, even before the first input. */
  beginTransformEdit(): void {
    if (this.selectedBone && this.working) this.pause();
  }
  setTemporaryBoneProperty(property: TransformProperty, value: number): boolean {
    if (!this.selectedBone || !this.working || !transformProperties.includes(property) || !Number.isFinite(value))
      return false;
    this.playing = false;
    this.temporaryTransform = Object.freeze({ ...this.temporaryTransform, [property]: value });
    this.notify();
    return true;
  }
  commitBoneProperty(property: TransformProperty): boolean {
    if (!this.selectedBone || !transformProperties.includes(property)) return false;
    this.beginTransformEdit();
    const value = this.selectedBoneTransform?.[property];
    return value !== undefined && this.setBonePropertyKeyframe(this.selectedBone, property, value);
  }
  deleteBonePropertyKey(property: TransformProperty): boolean {
    if (!this.selectedBone || !transformProperties.includes(property)) return false;
    this.beginTransformEdit();
    return this.removeBonePropertyKeyframe(this.selectedBone, property);
  }
  cancelTransformEdit(): void {
    if (!this.hasTemporaryTransform) return;
    this.clearTransformDraft();
    this.notify();
  }
  private clearTransformDraft(): void {
    if (this.hasTemporaryTransform) this.temporaryTransform = Object.freeze({});
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
    return this.time;
  }
  get duration(): number {
    return animationDurationSeconds(this.working);
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get previewLoop(): boolean {
    return this.previewLoopEnabled;
  }
  get playbackSpeed(): number {
    return this.speed;
  }
  get isScrubbing(): boolean {
    return this.scrubbing;
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
        { severity: 'error', message: 'Unsaved animation changes; undo edits or explicitly discard before selecting.' },
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
    this.clearTransformDraft();
    this.time = 0;
    this.playing = false;
    this.scrubbing = false;
    this.issues = [];
    this.saved = this.working;
    this.cachedDirty = false;
    this.history = this.createHistory();
    this.notify();
    return true;
  }

  setCurrentTime(time: number): void {
    if (this.updateTime(time)) this.notify();
  }

  /** Clamp navigation and authored edits using the same loop and scrub playback intent. */
  private updateTime(time: number): boolean {
    const next = clampTime(time, this.duration);
    const playing = this.playing && this.duration > 0 && (this.scrubbing || this.previewLoop || next < this.duration);
    if (next === this.time && playing === this.playing) return false;
    if (next !== this.time) this.clearTransformDraft();
    this.time = next;
    this.playing = playing;
    return true;
  }

  /** Preview preferences stay outside authored data and history. */
  setPreviewLoop(loop: boolean): void {
    if (loop === this.previewLoopEnabled) return;
    this.previewLoopEnabled = loop;
    this.updateTime(this.time);
    this.notify();
  }

  /** A preview preference, never serialized or recorded in authored history. */
  setPlaybackSpeed(speed: number): boolean {
    if (!PREVIEW_PLAYBACK_SPEEDS.some((value) => value === speed)) return false;
    if (speed !== this.speed) {
      this.speed = speed;
      this.notify();
    }
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
    timeSeconds = this.time,
  ): boolean {
    return this.editKeyframe(
      (animation, rig) => setBonePropertyKeyframe(animation, rig, boneId, property, timeSeconds * 1000, value),
      boneId,
      property,
      timeSeconds,
    );
  }

  removeBonePropertyKeyframe(boneId: string, property: TransformProperty, timeSeconds = this.time): boolean {
    return this.editKeyframe(
      (animation, rig) => removeBonePropertyKeyframe(animation, rig, boneId, property, timeSeconds * 1000),
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
      boneId === this.selectedBone &&
      keyframeTimesMatch(timeSeconds * 1000, this.time * 1000) &&
      this.temporaryTransform[property] !== undefined
    ) {
      const draft = { ...this.temporaryTransform };
      delete draft[property];
      this.temporaryTransform = Object.freeze(draft);
    }
    return this.installWorkingAnimation(freezeData(next), true);
  }

  /** Queries never install animation snapshots or change validation, history, or dirty state.
   * Returned keyframe times are milliseconds, matching the external authored format.
   */
  findBonePropertyKeyframe(
    boneId: string,
    property: TransformProperty,
    timeSeconds = this.time,
  ): PropertyKeyframe | undefined {
    return this.working ? findBonePropertyKeyframe(this.working, boneId, property, timeSeconds * 1000) : undefined;
  }

  hasKeyframeAtTime(boneId: string, property: TransformProperty, timeSeconds = this.time): boolean {
    return this.working ? hasKeyframeAtTime(this.working, boneId, property, timeSeconds * 1000) : false;
  }

  getKeyedPropertiesAtTime(boneId: string, timeSeconds = this.time): TransformProperty[] {
    return this.working ? getKeyedPropertiesAtTime(this.working, boneId, timeSeconds * 1000) : [];
  }

  getEvaluatedBonePropertyValue(
    boneId: string,
    property: TransformProperty,
    timeSeconds = this.time,
  ): number | undefined {
    return this.working && this.rig
      ? getEvaluatedBonePropertyValue(this.working, this.rig, boneId, property, timeSeconds * 1000)
      : undefined;
  }

  getEvaluatedBoneTransform(boneId: string, timeSeconds = this.time): JointTransform | undefined {
    return this.working && this.rig
      ? getEvaluatedBoneTransform(this.working, this.rig, boneId, timeSeconds * 1000)
      : undefined;
  }

  /** Keep playback intent while the pointer owns time; pause/play can still change that intent. */
  beginScrub(): void {
    if (this.scrubbing || !this.working) return;
    this.scrubbing = true;
    this.notify();
  }

  endScrub(): void {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    this.updateTime(this.time);
    this.notify();
  }

  /** Resume the sole editor clock; a completed clip starts again at zero. */
  play(): void {
    if (this.playing || !this.working || !(this.duration > 0)) return;
    this.clearTransformDraft();
    if (this.time >= this.duration) this.time = 0;
    this.playing = true;
    this.notify();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.notify();
  }

  togglePlayback(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Rewind immediately, preserving whether playback is active. */
  restart(): void {
    this.setCurrentTime(0);
  }

  /** Phaser supplies elapsed milliseconds; the scene converts them to continuous seconds here. */
  advancePlayback(deltaSeconds: number): void {
    if (!this.playing || this.scrubbing || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const duration = this.duration;
    if (!(duration > 0)) {
      this.setCurrentTime(0);
      return;
    }
    const distance = deltaSeconds * this.speed;
    // Reduce before addition; if scaling overflows, reduce real time by one preview loop first.
    const loopDistance = Number.isFinite(distance)
      ? distance % duration
      : (deltaSeconds % (duration / this.speed)) * this.speed;
    this.setCurrentTime(this.previewLoop ? (this.time + loopDistance) % duration : this.time + distance);
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
    this.updateTime(this.time);
    this.notify();
    return true;
  }

  markSaved(): void {
    const entry = this.selectedId === null ? undefined : this.animations.get(this.selectedId);
    if (entry) entry.saved = this.working;
    this.saved = this.working;
    this.cachedDirty = false;
    this.notify();
  }

  private createHistory(): SnapshotHistory<ReadonlyAnimation | null> {
    return new SnapshotHistory(
      () => this.working,
      (entry) => {
        this.clearTransformDraft();
        this.working = entry;
        this.cachedDirty = undefined;
        this.updateTime(this.time);
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
    const changed = restore();
    if (changed) {
      this.issues = [];
      this.notify();
    }
    return changed;
  }
}
