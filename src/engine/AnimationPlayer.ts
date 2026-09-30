import type { AnimationClip, CompiledClip } from './AnimationClip.js';
import { compileClip, sampleProperty } from './AnimationClip.js';
import type { Joint } from './Joint.js';
import type { Rig } from './Rig.js';
import { assertFinite } from './types.js';

/** Sampling is separate from the clock, leaving room for stepped poses later. */
export class AnimationPlayer {
  private readonly clips = new Map<string, CompiledClip>();
  private current: CompiledClip | undefined;
  private time = 0;
  private playing = false;

  constructor(
    private readonly rig: Rig,
    private readonly joints: ReadonlyMap<string, Joint>,
  ) {
    for (const bone of rig.bones) {
      if (!joints.has(bone.id)) throw new Error(`Missing joint "${bone.id}".`);
    }
  }

  get currentAnimation(): string | undefined {
    return this.current?.name;
  }
  get elapsedTime(): number {
    return this.time;
  }
  get isPlaying(): boolean {
    return this.playing;
  }

  addAnimation(clip: AnimationClip): void {
    if (this.clips.has(clip.name)) throw new Error(`Animation "${clip.name}" is already registered.`);
    this.clips.set(clip.name, compileClip(clip, this.rig));
  }

  /** Playing the same clip again deliberately restarts it. */
  play(name: string): void {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`Unknown animation "${name}".`);
    this.current = clip;
    this.time = 0;
    this.playing = true;
    this.resetPose();
    this.sample(0);
  }

  stop(): void {
    this.playing = false;
  }

  restart(): void {
    if (this.current) this.play(this.current.name);
  }

  resetPose(): void {
    for (const joint of this.joints.values()) joint.reset();
  }

  update(delta: number): void {
    assertFinite(delta, 'Animation delta');
    if (delta < 0) throw new Error('Animation delta cannot be negative.');
    if (!this.playing || !this.current) return;
    this.time += delta;
    if (this.current.loop) {
      this.time %= this.current.duration;
    } else if (this.time >= this.current.duration) {
      this.time = this.current.duration;
      this.playing = false;
    }
    this.sample(this.time);
  }

  /** Samples a pose without advancing playback; missing properties keep their pose. */
  sample(time: number): void {
    assertFinite(time, 'Sample time');
    if (!this.current) return;
    const clampedTime = Math.max(0, Math.min(time, this.current.duration));
    for (const track of this.current.tracks) {
      const joint = this.joints.get(track.bone);
      if (!joint) continue;
      for (const [property, keys] of track.properties) {
        joint.pose[property] = sampleProperty(keys, clampedTime);
      }
    }
  }
}
