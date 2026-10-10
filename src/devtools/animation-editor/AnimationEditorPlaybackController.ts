import { dispatchAnimationEvents } from '../../engine/animationNotifications.js';
import type { FiredAnimationEvent } from '../../engine/AnimationPlayer.js';
import { collectAnimationStartEvents } from '../../engine/animationTimeline.js';
import { throwNotificationErrors } from '../../engine/notifications.js';
import type { AnimationEditorDocument } from './AnimationEditorDocument.js';
import type { AnimationEditorPlayback } from './AnimationEditorPlayback.js';
import type { AnimationEditorSelection } from './AnimationEditorSelection.js';
import { collectEditorPlaybackEvents, getEditorEventClip } from './editorPlaybackEvents.js';
import type { Milliseconds, Seconds } from './timeUnits.js';

interface PlaybackActions {
  notify(): void;
  navigate(time: Seconds): void;
  isDragging(): boolean;
}

/** Coordinates the editor clock, temporary transforms, and post-preview event delivery. */
export class AnimationEditorPlaybackController {
  private readonly eventListeners = new Set<(event: FiredAnimationEvent) => void>();

  constructor(
    private readonly document: AnimationEditorDocument,
    private readonly selection: AnimationEditorSelection,
    private readonly playback: AnimationEditorPlayback,
    private readonly actions: PlaybackActions,
  ) {}

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
    if (changed) this.actions.notify();
  }

  setPreviewLoop(loop: boolean): void {
    this.notifyChange(this.playback.currentTime, this.playback.setPreviewLoop(loop));
  }

  setPlaybackSpeed(speed: number): boolean {
    const previous = this.playback.playbackSpeed;
    if (!this.playback.setPlaybackSpeed(speed)) return false;
    if (speed !== previous) this.actions.notify();
    return true;
  }

  beginScrub(): void {
    if (!this.document.workingAnimation) return;
    const cancelled = this.selection.clearDraft();
    if (this.playback.beginScrub() || cancelled) this.actions.notify();
  }

  endScrub(): void {
    this.notifyChange(this.playback.currentTime, this.playback.endScrub());
  }

  play(): void {
    if (this.actions.isDragging() || !this.playback.play()) return;
    this.selection.clearDraft();
    const events = this.startEvents();
    this.actions.notify();
    this.dispatchEvents(events);
  }

  pause(): void {
    this.notifyChange(this.playback.currentTime, this.playback.pause());
  }

  togglePlayback(): void {
    if (this.playback.isPlaying) this.pause();
    else this.play();
  }

  restart(): void {
    this.playback.requestStart();
    this.actions.navigate(0);
    this.dispatchEvents(this.startEvents());
  }

  /** Preflight crossings before advancing; subscribers synchronize the pose before callbacks run. */
  advancePlayback(deltaSeconds: Seconds): void {
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
        );
      } catch (error) {
        this.document.reportError(error);
        this.actions.notify();
        return;
      }
    }
    this.notifyChange(this.playback.currentTime, this.playback.advance(deltaSeconds));
    this.dispatchEvents(events);
  }

  onAnimationEvent(listener: (event: FiredAnimationEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private startEvents(): FiredAnimationEvent[] {
    const animation = this.document.workingAnimation;
    const rig = this.document.rig;
    return this.playback.consumeStart() && animation && rig
      ? collectAnimationStartEvents(getEditorEventClip(animation, rig, this.playback.previewLoop), 'base')
      : [];
  }

  private dispatchEvents(events: readonly FiredAnimationEvent[]): void {
    const errors = dispatchAnimationEvents(events, this.eventListeners);
    throwNotificationErrors(errors, 'Animation editor event listeners failed.');
  }
}
