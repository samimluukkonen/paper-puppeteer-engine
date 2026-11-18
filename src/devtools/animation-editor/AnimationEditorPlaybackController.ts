import { dispatchAnimationEvents, collectAnimationStartEvents, throwNotificationErrors } from '../../engine/core.js';
import type { AnimationPlaybackMode, FiredAnimationEvent } from '../../engine/data.js';
import type { AnimationEditorDocument, ReadonlyAnimation } from './AnimationEditorDocument.js';
import type { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import type { AnimationEditorSelection } from './AnimationEditorSelection.js';
import type { AnimationEditActions } from './AnimationEditSession.js';
import { collectEditorPlaybackEvents, getEditorEventClip } from './editorPlaybackEvents.js';
import { DEFAULT_KEYFRAME_FPS } from './timeline.js';
import type { Milliseconds, Seconds } from './timeUnits.js';
import { getValidatedEditorAnimation, validateEditedAnimation } from './validatedAnimation.js';

export const AUTHORED_FPS_MIN = 1;
export const AUTHORED_FPS_MAX = 240;
export const DEFAULT_AUTHORED_FPS = DEFAULT_KEYFRAME_FPS;

/** Facade-owned inputs the controller reads lazily at call time. */
export interface PlaybackActions {
  navigate(time: Seconds): void;
  isDragging(): boolean;
  authoringEnabled(): boolean;
  /** Playing replaces the motion-cleanup comparison with the authored clip. */
  cancelCleanupPreview(): boolean;
}

/** The public `state.playback` domain handle; only the facade seeks through the low-level clock setters. */
export type AnimationEditorPlaybackHandle = Omit<
  AnimationEditorPlaybackController,
  'setCurrentTime' | 'setCurrentTimeMilliseconds'
>;

/**
 * Coordinates the editor clock, temporary transforms, post-preview event delivery and the authored
 * playback metadata. Play, toggle, restart and advance check the authoring guard but are never batched:
 * subscribers must synchronize the pose before animation event callbacks run.
 */
export class AnimationEditorPlaybackController {
  private readonly eventListeners = new Set<(event: FiredAnimationEvent) => void>();

  constructor(
    private readonly document: AnimationEditorDocument,
    private readonly selection: AnimationEditorSelection,
    private readonly playback: AnimationEditorPlayback,
    private readonly session: AnimationEditActions,
    private readonly actions: PlaybackActions,
  ) {}

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

  /** Low-level navigation lets the session group gesture cancellation and notifications. */
  setCurrentTime(time: Seconds): boolean {
    const previous = this.playback.currentTime;
    const changed = this.playback.setCurrentTime(time);
    if (previous !== this.playback.currentTime) this.selection.clearDraft();
    return changed;
  }

  setCurrentTimeMilliseconds(time: Milliseconds): boolean {
    const previous = this.playback.currentTime;
    const changed = this.playback.setCurrentTimeMilliseconds(time);
    if (previous !== this.playback.currentTime) this.selection.clearDraft();
    return changed;
  }

  private notifyChange(previous: Seconds, changed: boolean): void {
    if (previous !== this.playback.currentTime) this.selection.clearDraft();
    if (changed) this.session.notify();
  }

  /** Preview preferences stay outside authored data and history. */
  setPreviewLoop(loop: boolean): void {
    this.notifyChange(this.playback.currentTime, this.playback.setPreviewLoop(loop));
  }

  setPlaybackSpeed(speed: number): boolean {
    const previous = this.playback.playbackSpeed;
    if (!this.playback.setPlaybackSpeed(speed)) return false;
    if (speed !== previous) this.session.notify();
    return true;
  }

  /** Keep playback intent while the pointer owns time; pause/play can still change that intent. */
  beginScrub(): void {
    this.session.run(undefined, () => {
      this.session.cancelActiveDrags();
      if (!this.document.workingAnimation) return;
      const cancelled = this.selection.clearDraft();
      if (this.playback.beginScrub() || cancelled) this.session.notify();
    });
  }

  endScrub(): void {
    this.notifyChange(this.playback.currentTime, this.playback.endScrub());
  }

  play(): void {
    if (!this.actions.authoringEnabled()) return;
    this.actions.cancelCleanupPreview();
    this.startPlayback();
  }

  private startPlayback(): void {
    const animation = this.document.workingAnimation;
    if (this.actions.isDragging() || this.playback.isPlaying || !animation) return;
    const events = this.prepareStartEvents(
      !this.playback.isScrubbing &&
        (this.playback.hasPendingStart || this.playback.currentTimeMilliseconds >= animation.duration),
    );
    if (!events || !this.playback.play()) return;
    this.selection.clearDraft();
    this.playback.consumeStart();
    this.notifyAndDispatchEvents(
      () => this.session.notify(),
      () => events,
    );
  }

  pause(): void {
    this.notifyChange(this.playback.currentTime, this.playback.pause());
  }

  togglePlayback(): void {
    if (!this.actions.authoringEnabled()) return;
    this.actions.cancelCleanupPreview();
    if (this.playback.isPlaying) this.pause();
    else this.startPlayback();
  }

  restart(): void {
    if (!this.actions.authoringEnabled()) return;
    const events = this.prepareStartEvents(this.playback.isPlaying && !this.playback.isScrubbing);
    if (!events) return;
    this.playback.requestStart();
    this.notifyAndDispatchEvents(
      () => this.actions.navigate(0),
      () => (this.playback.consumeStart() ? events : []),
    );
  }

  /** Phaser supplies elapsed milliseconds; the scene converts them to continuous seconds here. */
  advancePlayback(deltaSeconds: Seconds): void {
    if (!this.actions.authoringEnabled()) return;
    // Preflight crossings before advancing; subscribers synchronize the pose before callbacks run.
    let events: FiredAnimationEvent[] = [];
    const animation = this.document.workingAnimation;
    const rig = this.document.rig;
    if (
      this.playback.isPlaying &&
      !this.playback.isScrubbing &&
      Number.isFinite(deltaSeconds) &&
      deltaSeconds > 0 &&
      animation?.events?.length &&
      rig
    ) {
      try {
        events = collectEditorPlaybackEvents(
          getEditorEventClip(animation, rig, this.playback.previewLoop),
          this.playback.currentTimeMilliseconds,
          deltaSeconds,
          this.playback.playbackSpeed,
          this.eventListeners.size,
        );
      } catch (error) {
        this.document.reportError(error);
        this.session.notify();
        return;
      }
    }
    const previous = this.playback.currentTime;
    const changed = this.playback.advance(deltaSeconds);
    this.notifyAndDispatchEvents(
      () => this.notifyChange(previous, changed),
      () => events,
    );
  }

  /** Runtime-compatible notifications are delivered after preview subscribers synchronize the held pose. */
  onAnimationEvent(listener: (event: FiredAnimationEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Authored metadata edits use the same validated document/history boundary as key and event edits. */
  setAuthoredFPS(fps: number): boolean {
    return this.session.run(false, () => {
      if (this.document.workingAnimation?.playback?.mode !== 'stepped') return false;
      if (!Number.isFinite(fps) || fps < AUTHORED_FPS_MIN || fps > AUTHORED_FPS_MAX) {
        this.document.reportIssues([
          {
            severity: 'error',
            path: 'playback.fps',
            message: `Animation FPS must be a finite number from ${AUTHORED_FPS_MIN} to ${AUTHORED_FPS_MAX}.`,
          },
        ]);
        this.session.notify();
        return false;
      }
      return this.setAuthoredPlayback({ mode: 'stepped', fps });
    });
  }

  setAuthoredPlaybackMode(mode: AnimationPlaybackMode['mode']): boolean {
    return this.session.run(false, () => {
      const animation = this.document.workingAnimation;
      if (!animation || (mode !== 'smooth' && mode !== 'stepped')) return false;
      if (mode === (animation.playback?.mode ?? 'smooth')) return true;
      return this.setAuthoredPlayback(mode === 'smooth' ? { mode } : { mode, fps: DEFAULT_AUTHORED_FPS });
    });
  }

  private setAuthoredPlayback(playback: AnimationPlaybackMode): boolean {
    const source = this.document.workingAnimation;
    const rig = this.document.rig;
    if (!source || !rig) return false;
    let next: ReadonlyAnimation;
    try {
      getValidatedEditorAnimation(source, rig);
      next = validateEditedAnimation({ ...source, playback }, source, rig);
    } catch (error) {
      this.document.reportError(error);
      this.session.notify();
      return false;
    }
    return this.session.commit(() => next, { pause: false });
  }

  /** Bound start notifications before clocks, drafts, or playback intent change. */
  private prepareStartEvents(required: boolean): FiredAnimationEvent[] | undefined {
    const animation = this.document.workingAnimation;
    const rig = this.document.rig;
    if (!required || !animation?.events?.length || !rig) return [];
    try {
      return collectAnimationStartEvents(
        getEditorEventClip(animation, rig, this.playback.previewLoop),
        'base',
        this.eventListeners.size,
      );
    } catch (error) {
      this.document.reportError(error);
      this.session.notify();
      return undefined;
    }
  }

  /** Committed clocks own their events even if a preview/UI subscriber fails. Finish both notification phases. */
  private notifyAndDispatchEvents(notify: () => void, events: () => readonly FiredAnimationEvent[]): void {
    const errors: unknown[] = [];
    try {
      notify();
    } catch (error) {
      errors.push(error);
    }
    errors.push(...dispatchAnimationEvents(events(), this.eventListeners));
    throwNotificationErrors(errors, 'Animation editor playback notifications failed.');
  }
}
