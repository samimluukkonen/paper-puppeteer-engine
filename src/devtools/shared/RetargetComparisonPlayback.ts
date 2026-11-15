import type { Puppet } from '../../engine/runtime.js';

/** One view-only clock samples both ordinary Puppets. No clip evaluation or authored events live here. */
export class RetargetComparisonPlayback {
  time = 0;
  speed = 1;
  playing = false;
  constructor(
    readonly puppets: readonly [Puppet, Puppet],
    readonly duration: number,
  ) {}
  seek(time: number): void {
    if (!Number.isFinite(time)) return;
    this.time = Math.max(0, Math.min(this.duration, time));
    for (const puppet of this.puppets) {
      // The clock uses clamped local time even for an authored looping clip.
      const displacement = puppet.animationPlayer.sampleRootMotion(this.time);
      puppet.container.setPosition(displacement.x, displacement.y);
      puppet.sampleAnimation(this.time, { mode: 'playback' });
    }
  }
  toggle(): void {
    if (!this.playing && this.time >= this.duration) this.seek(0);
    this.playing = !this.playing;
  }
  scrub(time: number): void {
    this.playing = false;
    this.seek(time);
  }
  advance(delta: number): void {
    if (!this.playing || !Number.isFinite(delta) || delta < 0) return;
    this.seek(this.time + delta * this.speed);
    if (this.time >= this.duration) this.playing = false;
  }
}
