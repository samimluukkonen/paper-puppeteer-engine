import type { AnimationClip } from '../../engine/AnimationClip.js';
import {
  ANIMATION_FORMAT_VERSION,
  inspectAnimationDefinition,
  type ValidationIssue,
} from '../../engine/externalData.js';
import type { Rig } from '../../engine/Rig.js';
import { animationFileSchema } from '../../engine/schemas.js';
import { freezeData, type ReadonlyEditorData } from '../shared/editorData.js';
import { SnapshotHistory } from '../shared/SnapshotHistory.js';
import { animationDurationSeconds, clampTime } from './timeline.js';

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
  private scrubbing = false;
  private saved = '';
  private issues: readonly ValidationIssue[] = [];
  private readonly snapshots = new WeakMap<ReadonlyAnimation, string>();
  private history = this.createHistory();

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
  get isScrubbing(): boolean {
    return this.scrubbing;
  }
  get loop(): boolean {
    return this.working?.loop ?? false;
  }
  get dirty(): boolean {
    return this.snapshot !== this.saved;
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
  private get snapshot(): string {
    return this.snapshotFor(this.working);
  }

  /** Immutable animation identities let status and history reuse serialization across scrubs and undo. */
  private snapshotFor(animation: ReadonlyAnimation | null): string {
    if (!animation) return '';
    let snapshot = this.snapshots.get(animation);
    if (snapshot === undefined) {
      snapshot = JSON.stringify(animation);
      this.snapshots.set(animation, snapshot);
    }
    return snapshot;
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
    return freezeData(animationFileSchema.parse({ ...result.data, version: ANIMATION_FORMAT_VERSION }));
  }

  /** Failed selections preserve the current working copy. Future authoring can explicitly discard changes. */
  selectAnimation(id: string | null, options: { discardChanges?: boolean } = {}): boolean {
    if (this.dirty && !options.discardChanges) {
      this.issues = [
        { severity: 'error', message: 'Unsaved animation changes; save or explicitly discard before selecting.' },
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
    this.time = 0;
    this.playing = false;
    this.scrubbing = false;
    this.issues = [];
    this.saved = this.snapshot;
    this.history = this.createHistory();
    this.notify();
    return true;
  }

  setCurrentTime(time: number): void {
    const next = clampTime(time, this.duration);
    const playing = this.playing && this.duration > 0 && (this.scrubbing || this.previewLoop || next < this.duration);
    if (next === this.time && playing === this.playing) return;
    this.time = next;
    this.playing = playing;
    this.notify();
  }

  /** Preview preferences stay outside authored data and history. */
  setPreviewLoop(loop: boolean): void {
    if (loop === this.previewLoopEnabled) return;
    this.previewLoopEnabled = loop;
    if (!loop && !this.scrubbing && this.time >= this.duration) this.playing = false;
    this.notify();
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
    if (!(this.duration > 0) || (!this.previewLoop && this.time >= this.duration)) this.playing = false;
    this.notify();
  }

  /** Resume the sole editor clock; a completed clip starts again at zero. */
  play(): void {
    if (this.playing || !this.working || !(this.duration > 0)) return;
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
    // Reduce large deltas before addition so they cannot overflow or swallow the held time.
    this.setCurrentTime(
      this.previewLoop ? (this.time + (deltaSeconds % duration)) % duration : this.time + deltaSeconds,
    );
  }

  /** Future authoring boundary: validate atomically, own a fresh JSON copy, and record one authored edit. */
  replaceWorkingAnimation(input: unknown): boolean {
    if (!this.working) return false;
    const next = this.inspect(input);
    if (!next) {
      this.notify();
      return false;
    }
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
    this.history.change(() => {
      this.working = next;
    });
    this.time = clampTime(this.time, this.duration);
    if (this.time >= this.duration) this.playing = false;
    this.notify();
    return true;
  }

  markSaved(): void {
    const entry = this.selectedId === null ? undefined : this.animations.get(this.selectedId);
    if (entry) entry.saved = this.working;
    this.saved = this.snapshot;
    this.notify();
  }

  private createHistory(): SnapshotHistory<ReadonlyAnimation | null> {
    return new SnapshotHistory(
      () => this.working,
      (entry) => {
        this.working = entry;
        this.time = clampTime(this.time, this.duration);
        if (this.time >= this.duration) this.playing = false;
      },
      (left, right) => this.snapshotFor(left) === this.snapshotFor(right),
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
