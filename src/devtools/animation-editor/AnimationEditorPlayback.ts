import { clampTime } from './timeline.js';

export const PREVIEW_PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;

/** Sole continuous editor clock; independent of authored data, history, and pose evaluation. */
export class AnimationEditorPlayback {
  private time = 0;
  private playing = false;
  private loop = false;
  private speed = 1;
  private scrubbing = false;

  constructor(private readonly duration: () => number) {}

  get currentTime(): number {
    return this.time;
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

  /** New animation sessions retain preview preferences but release clock and pointer state. */
  reset(): void {
    this.time = 0;
    this.playing = false;
    this.scrubbing = false;
  }

  /** Clamp navigation and duration edits using the same loop and scrub playback intent. */
  setCurrentTime(time: number): boolean {
    const duration = this.duration();
    const next = clampTime(time, duration);
    const playing = this.playing && duration > 0 && (this.scrubbing || this.loop || next < duration);
    if (next === this.time && playing === this.playing) return false;
    this.time = next;
    this.playing = playing;
    return true;
  }

  setPreviewLoop(loop: boolean): boolean {
    if (loop === this.loop) return false;
    this.loop = loop;
    this.setCurrentTime(this.time);
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
    this.setCurrentTime(this.time);
    return true;
  }

  /** Resume at the held time; a completed clip starts again at zero. */
  play(): boolean {
    const duration = this.duration();
    if (this.playing || !(duration > 0)) return false;
    if (this.time >= duration) this.time = 0;
    this.playing = true;
    return true;
  }

  pause(): boolean {
    if (!this.playing) return false;
    this.playing = false;
    return true;
  }

  advance(deltaSeconds: number): boolean {
    if (!this.playing || this.scrubbing || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return false;
    const duration = this.duration();
    if (!(duration > 0)) return this.setCurrentTime(0);
    const distance = deltaSeconds * this.speed;
    // Reduce before addition; if scaling overflows, reduce real time by one preview loop first.
    const loopDistance = Number.isFinite(distance)
      ? distance % duration
      : (deltaSeconds % (duration / this.speed)) * this.speed;
    return this.setCurrentTime(this.loop ? (this.time + loopDistance) % duration : this.time + distance);
  }
}
