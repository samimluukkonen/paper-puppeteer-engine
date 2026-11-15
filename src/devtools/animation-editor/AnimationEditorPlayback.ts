import { wrapAnimationTime } from '../../engine/core.js';
import type { AnimationEvent } from '../../engine/data.js';
import { clampTime } from './timeline.js';
import { type Milliseconds, type Seconds, toMilliseconds, toSeconds } from './timeUnits.js';

export const PREVIEW_PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;

/** Sole continuous editor clock; authored milliseconds avoid lossy event-boundary unit round trips. */
export class AnimationEditorPlayback {
  private time: Milliseconds = 0;
  private elapsed: Milliseconds = 0;
  private playing = false;
  private loop = false;
  private speed = 1;
  private scrubbing = false;
  private startPending = true;

  constructor(
    private readonly duration: () => Milliseconds,
    private readonly events: () => readonly AnimationEvent[] = () => [],
  ) {}

  get currentTime(): Seconds {
    return toSeconds(this.time);
  }
  get currentTimeMilliseconds(): Milliseconds {
    return this.time;
  }
  get elapsedTimeMilliseconds(): Milliseconds {
    return this.elapsed;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get previewLoop(): boolean {
    return this.loop;
  }
  get playbackSpeed(): number {
    return this.speed;
  }
  get isScrubbing(): boolean {
    return this.scrubbing;
  }
  get hasPendingStart(): boolean {
    return this.startPending && this.time === 0;
  }

  /** New animation sessions retain preview preferences but release clock and pointer state. */
  reset(): void {
    this.time = 0;
    this.elapsed = 0;
    this.playing = false;
    this.scrubbing = false;
    this.startPending = true;
  }

  /** Seconds remain the navigation API. Preserve an unchanged held millisecond timestamp exactly. */
  resolveTimeMilliseconds(time: Seconds): Milliseconds {
    const duration = this.duration();
    return time === this.currentTime ? this.time : time === toSeconds(duration) ? duration : toMilliseconds(time);
  }

  setCurrentTime(time: Seconds): boolean {
    const duration = this.duration();
    const next = clampTime(time, toSeconds(duration));
    return this.setCurrentTimeMilliseconds(this.resolveTimeMilliseconds(next));
  }

  setCurrentTimeMilliseconds(time: Milliseconds): boolean {
    const duration = this.duration();
    const next = clampTime(time, duration);
    const playing = this.playing && duration > 0 && (this.scrubbing || this.loop || next < duration);
    if (next === this.time && next === this.elapsed && playing === this.playing) return false;
    this.elapsed = next;
    if (next !== this.time) this.startPending = next === 0 && !this.scrubbing;
    this.time = next;
    this.playing = playing;
    return true;
  }

  setPreviewLoop(loop: boolean): boolean {
    if (loop === this.loop) return false;
    this.loop = loop;
    this.setCurrentTimeMilliseconds(this.time);
    return true;
  }

  /** Returns validity, including when an accepted speed is already selected. */
  setPlaybackSpeed(speed: number): boolean {
    if (!PREVIEW_PLAYBACK_SPEEDS.some((value) => value === speed)) return false;
    this.speed = speed;
    return true;
  }

  beginScrub(): boolean {
    if (this.scrubbing) return false;
    this.scrubbing = true;
    return true;
  }

  endScrub(): boolean {
    if (!this.scrubbing) return false;
    this.scrubbing = false;
    this.startPending = false;
    if (!this.loop && this.time >= this.duration()) this.playing = false;
    return true;
  }

  /** Resume at the held time; a completed clip starts again at zero. */
  play(): boolean {
    const duration = this.duration();
    if (this.playing || !(duration > 0)) return false;
    if (this.time >= duration) {
      this.time = 0;
      this.elapsed = 0;
      this.startPending = true;
    }
    this.playing = true;
    return true;
  }

  pause(): boolean {
    if (!this.playing) return false;
    this.playing = false;
    return true;
  }

  requestStart(): void {
    this.startPending = true;
  }

  /** A real playback start consumes this once; pause/resume and scrub release do not restart events. */
  consumeStart(): boolean {
    if (!this.playing || this.scrubbing || !this.startPending || this.time !== 0) return false;
    this.startPending = false;
    return true;
  }

  advance(deltaSeconds: Seconds): boolean {
    if (!this.playing || this.scrubbing || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return false;
    const duration = this.duration();
    if (!(duration > 0)) return this.setCurrentTimeMilliseconds(0);
    const distance = toMilliseconds(deltaSeconds) * this.speed;
    const previousElapsed = this.elapsed;
    const end = this.time + distance;
    let next = end;
    if (this.loop) {
      if (Number.isFinite(end)) next = wrapAnimationTime({ duration, events: this.events() }, end);
      else {
        // Event-free clocks retain finite wrapping even when scaling/addition overflows.
        const period = toSeconds(duration) / this.speed;
        const reduced = Number.isFinite(distance)
          ? distance % duration
          : period > 0
            ? toMilliseconds((deltaSeconds % period) * this.speed)
            : (toMilliseconds(deltaSeconds % duration) * this.speed) % duration;
        next = reduced >= duration - this.time ? reduced - (duration - this.time) : this.time + reduced;
      }
    }
    const changed = this.setCurrentTimeMilliseconds(next);
    // Retain an absolute clock for continuous root loops; pose/event timing stays clip-local.
    const elapsed = this.loop ? previousElapsed + distance : this.time;
    if (Number.isFinite(elapsed) && Number.isSafeInteger(Math.floor(elapsed / duration))) this.elapsed = elapsed;
    this.startPending = false;
    return changed || this.elapsed !== previousElapsed;
  }
}
