import type { AnimationClip, AnimationEvent, AnimationPlaybackMode, CompiledClip } from './AnimationClip.js';
import { compileClip, ownCompiledClip } from './AnimationClip.js';
import { type AnimationLayer, AnimationLayerEvaluator, type AnimationState } from './AnimationLayerEvaluator.js';
import { dispatchAnimationEvents } from './animationNotifications.js';
import type { AnimationPose } from './AnimationPose.js';
import {
  advanceAnimationTime,
  assertAnimationEventBudget,
  collectAnimationEvents,
  collectAnimationStartEvents,
  countAnimationEvents,
} from './animationTimeline.js';
import type { Joint } from './Joint.js';
import { dispatchListeners, throwNotificationErrors } from './notifications.js';
import type { Rig } from './Rig.js';
import { assertFinite } from './types.js';

export interface PlayAnimationOptions {
  fadeDuration?: number;
  restart?: boolean;
  speed?: number;
  layer?: string;
}

export interface SampleAnimationOptions {
  /** Raw interpolation by default; playback respects clip overrides and the player's playback mode. */
  mode?: 'raw' | 'playback';
}

export interface FiredAnimationEvent extends AnimationEvent {
  clip: string;
  layer: string;
}

export interface AnimationCompletion {
  clip: string;
  layer: string;
}

function validateSpeed(speed: number): void {
  assertFinite(speed, 'Animation speed');
  if (speed < 0) throw new Error('Animation speed cannot be negative.');
}

/** Evaluates authored poses and layers. Puppet applies IK after this player writes the pose. */
export class AnimationPlayer {
  private readonly clips = new Map<string, CompiledClip>();
  private readonly layers = new Map<string, AnimationLayer>([
    ['base', { weight: 1, transition: undefined, stopped: false }],
  ]);
  private readonly eventListeners = new Set<(event: FiredAnimationEvent) => void>();
  private readonly completionListeners = new Set<(event: AnimationCompletion) => void>();
  private readonly poseEvaluator: AnimationLayerEvaluator;
  private playback: AnimationPlaybackMode = { mode: 'smooth' };
  private speed = 1;
  private paused = false;
  private disposed = false;

  constructor(
    private readonly rig: Rig,
    private joints: ReadonlyMap<string, Joint>,
    compiledClips: readonly CompiledClip[] = [],
  ) {
    // Reuse compiled tracks, but check their references against this player's rig.
    for (const clip of compiledClips) {
      if (this.clips.has(clip.name)) throw new Error(`Animation "${clip.name}" is already registered.`);
      for (const track of clip.tracks) {
        if (!rig.hasBone(track.bone))
          throw new Error(`Animation "${clip.name}" references unknown bone "${track.bone}".`);
      }
      this.clips.set(clip.name, ownCompiledClip(clip));
    }
    this.poseEvaluator = new AnimationLayerEvaluator(rig, joints);
  }

  get currentAnimation(): string | undefined {
    return this.layers.get('base')?.state?.clip.name;
  }
  get elapsedTime(): number {
    return this.layers.get('base')?.state?.time ?? 0;
  }
  /** Duration in milliseconds of the active base clip, or zero when none is selected. */
  get duration(): number {
    return this.layers.get('base')?.state?.clip.duration ?? 0;
  }
  get isPlaying(): boolean {
    return this.layers.get('base')?.state?.playing ?? false;
  }
  get isPaused(): boolean {
    return this.paused;
  }
  get isDisposed(): boolean {
    return this.disposed;
  }
  get playbackSpeed(): number {
    return this.speed;
  }
  /** Clip-specific speed multiplier of the active base animation, or 1 when none is selected. */
  get currentAnimationSpeed(): number {
    return this.layers.get('base')?.state?.speed ?? 1;
  }
  get playbackMode(): AnimationPlaybackMode {
    return { ...this.playback };
  }
  get transition(): { from: string; to: string; progress: number } | undefined {
    const layer = this.layers.get('base');
    const transition = layer?.transition;
    if (!transition || !layer?.state) return undefined;
    return {
      from: transition.source instanceof Map ? 'previous pose' : transition.source.clip.name,
      to: layer.state.clip.name,
      progress: this.poseEvaluator.transitionWeight(layer.state, transition, this.playback),
    };
  }

  getLayerAnimation(name: string): string | undefined {
    return this.layers.get(name)?.state?.clip.name;
  }
  getLayerWeight(name: string): number {
    return this.layers.get(name)?.weight ?? 0;
  }

  addAnimation(clip: AnimationClip): void {
    this.assertActive();
    if (this.clips.has(clip.name)) throw new Error(`Animation "${clip.name}" is already registered.`);
    this.clips.set(clip.name, compileClip(clip, this.rig));
  }

  /** Restart the clip unless restart:false keeps it active. Host hooks prepare after validation
   * and synchronize the evaluated pose before time-zero events are delivered.
   */
  play(name: string, options: PlayAnimationOptions = {}, preparePose?: () => void, synchronizePose?: () => void): void {
    this.assertActive();
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`Unknown animation "${name}".`);
    const layerName = options.layer ?? 'base';
    if (!layerName) throw new Error('Layer name cannot be empty.');
    const fade = options.fadeDuration ?? 0;
    assertFinite(fade, 'Fade duration');
    if (fade < 0) throw new Error('Fade duration cannot be negative.');
    const speed = options.speed ?? 1;
    validateSpeed(speed);
    if (options.restart === false && this.layers.get(layerName)?.state?.clip.name === name) {
      synchronizePose?.();
      return;
    }
    preparePose?.();
    const layer = this.getOrCreateLayer(layerName);
    let source: AnimationState | AnimationPose | undefined;
    if (fade > 0) {
      if (layer.state)
        source = layer.transition
          ? this.poseEvaluator.evaluateLayer(
              layer,
              this.poseEvaluator.underlyingPose(layerName, this.layers, this.playback),
              this.playback,
              true,
            )
          : { ...layer.state };
      else if (layerName !== 'base') source = new Map();
    }
    if (layerName !== 'base' && !source) this.poseEvaluator.resetLayerProperties(layer);
    layer.state = { clip, time: 0, speed, playing: true };
    layer.transition = source ? { source, elapsed: 0, duration: fade } : undefined;
    layer.stopped = false;
    this.poseEvaluator.invalidate();
    if (layerName === 'base' && !source) this.resetPose();
    this.applyCurrentPose();
    synchronizePose?.();
    this.fireStartEvents(clip, layerName);
  }

  stop(): void {
    this.assertActive();
    for (const layer of this.layers.values()) {
      if (layer.state) layer.state.playing = false;
      layer.stopped = true;
    }
  }
  /** Restart every selected layer together, preserving speeds, masks, weights, and pause state. */
  restart(preparePose?: () => void, synchronizePose?: () => void): void {
    this.assertActive();
    if (![...this.layers.values()].some((layer) => layer.state)) {
      synchronizePose?.();
      return;
    }
    preparePose?.();
    this.resetPose();
    const events: FiredAnimationEvent[] = [];
    for (const [name, layer] of this.layers) {
      if (!layer.state) continue;
      layer.state = { ...layer.state, time: 0, playing: true };
      layer.transition = undefined;
      layer.stopped = false;
      for (const event of collectAnimationStartEvents(layer.state.clip, name)) events.push(event);
    }
    this.poseEvaluator.invalidate();
    this.applyCurrentPose();
    synchronizePose?.();
    this.dispatchNotifications(events, []);
  }
  pause(): void {
    this.assertActive();
    this.paused = true;
  }
  resume(): void {
    this.assertActive();
    this.paused = false;
  }
  setSpeed(speed: number): void {
    this.assertActive();
    validateSpeed(speed);
    this.speed = speed;
  }

  setPlaybackMode(mode: AnimationPlaybackMode, preparePose?: () => void): void {
    this.assertActive();
    if (mode.mode === 'stepped') {
      assertFinite(mode.fps, 'Animation FPS');
      if (mode.fps <= 0) throw new Error('Animation FPS must be greater than zero.');
    } else if (mode.mode !== 'smooth') throw new Error('Unsupported playback mode.');
    preparePose?.();
    this.playback = { ...mode };
    this.applyCurrentPose();
  }

  setLayerMask(name: string, bones: readonly string[], preparePose?: () => void): void {
    this.assertActive();
    if (!name) throw new Error('Layer name cannot be empty.');
    if (name === 'base') throw new Error('The base layer cannot have a bone mask.');
    for (const id of bones) this.rig.getBone(id);
    preparePose?.();
    const layer = this.getOrCreateLayer(name);
    this.poseEvaluator.resetLayerProperties(layer);
    layer.mask = new Set(bones);
    this.poseEvaluator.invalidate();
    this.applyCurrentPose();
  }

  setLayerWeight(name: string, weight: number, preparePose?: () => void): void {
    this.assertActive();
    if (!name) throw new Error('Layer name cannot be empty.');
    if (name === 'base') throw new Error('The base layer weight is fixed at 1.');
    assertFinite(weight, 'Layer weight');
    if (weight < 0 || weight > 1) throw new Error('Layer weight must be between 0 and 1.');
    preparePose?.();
    const layer = this.getOrCreateLayer(name);
    if (weight === 0 && layer.weight > 0) this.poseEvaluator.resetLayerProperties(layer);
    layer.weight = weight;
    this.poseEvaluator.invalidate();
    this.applyCurrentPose();
  }

  clearLayer(name: string, preparePose?: () => void): void {
    this.assertActive();
    if (!name) throw new Error('Layer name cannot be empty.');
    if (name === 'base') throw new Error('The base layer cannot be cleared.');
    preparePose?.();
    const layer = this.layers.get(name);
    if (layer) this.poseEvaluator.resetLayerProperties(layer);
    this.layers.delete(name);
    this.poseEvaluator.invalidate();
    this.applyCurrentPose();
  }

  /** Remove clip and layer state without changing registered clips. */
  clearAllLayers(): void {
    this.assertActive();
    this.layers.clear();
    this.layers.set('base', { weight: 1, transition: undefined, stopped: false });
    this.poseEvaluator.invalidate();
  }

  onAnimationEvent(listener: (event: FiredAnimationEvent) => void): () => void {
    this.assertActive();
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onAnimationComplete(listener: (event: AnimationCompletion) => void): () => void {
    this.assertActive();
    this.completionListeners.add(listener);
    return () => this.completionListeners.delete(listener);
  }

  resetPose(): void {
    this.assertActive();
    for (const joint of this.joints.values()) joint.reset();
  }

  /** Advance playback and return whether this call evaluated the authored pose.
   * The optional preparation callback runs after validation, before clocks or poses change.
   * Paused or stopped playback does not invoke it.
   * The synchronization callback runs after evaluation and before notifications.
   */
  update(delta: number, preparePose?: () => void, synchronizePose?: () => void): boolean {
    if (this.disposed) return false;
    assertFinite(delta, 'Animation delta');
    if (delta < 0) throw new Error('Animation delta cannot be negative.');
    if (this.paused) return false;
    let advancing = false;
    for (const layer of this.layers.values()) {
      if (layer.state?.playing || (layer.transition && !layer.stopped)) {
        advancing = true;
        break;
      }
    }
    if (!advancing) return false;
    // Validate every clock and the total catch-up work before mutating any layer.
    let eventCount = 0;
    for (const layer of this.layers.values()) {
      const state = layer.state;
      if (state?.playing) {
        const end = advanceAnimationTime(state, delta, this.speed);
        eventCount += countAnimationEvents(state.clip, state.time, end);
        assertAnimationEventBudget(eventCount);
      }
      const source = layer.transition?.source;
      if (!layer.stopped && source && !(source instanceof Map) && source.playing)
        advanceAnimationTime(source, delta, this.speed);
    }
    preparePose?.();
    const events: FiredAnimationEvent[] = [];
    const completions: AnimationCompletion[] = [];
    for (const [name, layer] of this.layers) {
      if (!layer.state) continue;
      const state = layer.state;
      if (state.playing) this.advance(state, delta, name, events, completions);
      if (layer.transition && !layer.stopped) {
        const source = layer.transition.source;
        if (!(source instanceof Map) && source.playing) this.advance(source, delta);
        layer.transition.elapsed = Math.min(layer.transition.duration, layer.transition.elapsed + delta);
      }
    }
    this.applyCurrentPose();
    try {
      synchronizePose?.();
    } finally {
      for (const layer of this.layers.values()) {
        if (layer.transition && layer.transition.elapsed >= layer.transition.duration) {
          layer.transition = undefined;
          this.poseEvaluator.invalidate();
        }
      }
    }
    this.dispatchNotifications(events, completions);
    return true;
  }

  /** Sample only the base clip, clamping time without moving clocks or firing events.
   * Reset properties owned by fades/layers to bind values; retain untracked manual edits.
   */
  sample(time: number, options: SampleAnimationOptions = {}, preparePose?: () => void): void {
    this.assertActive();
    assertFinite(time, 'Sample time');
    const state = this.layers.get('base')?.state;
    if (!state) return;
    preparePose?.();
    this.poseEvaluator.sample(state, time, options.mode === 'playback', this.layers, this.playback);
  }

  /** Reapply the held authored pose; useful before external per-frame adjustments. */
  applyCurrentPose(): void {
    this.assertActive();
    this.poseEvaluator.applyCurrentPose(this.layers, this.playback);
  }

  private advance(
    state: AnimationState,
    delta: number,
    layer?: string,
    events?: FiredAnimationEvent[],
    completions?: AnimationCompletion[],
  ): void {
    const previous = state.time;
    const end = advanceAnimationTime(state, delta, this.speed);
    if (end === previous) return;
    if (layer && events) {
      for (const event of collectAnimationEvents(state.clip, previous, end, layer)) events.push(event);
    }
    state.time = state.clip.loop ? end % state.clip.duration : end;
    if (!state.clip.loop && end >= state.clip.duration) {
      state.playing = false;
      if (layer && completions) completions.push({ clip: state.clip.name, layer });
    }
  }

  private fireStartEvents(clip: CompiledClip, layer: string): void {
    this.dispatchNotifications(collectAnimationStartEvents(clip, layer), []);
  }

  /** Listener failures must not prevent other markers or completion notifications. */
  private dispatchNotifications(
    events: readonly FiredAnimationEvent[],
    completions: readonly AnimationCompletion[],
  ): void {
    const errors = dispatchAnimationEvents(events, this.eventListeners, () => !this.disposed);
    for (const event of completions) {
      for (const error of dispatchListeners(
        this.completionListeners,
        (listener) => listener({ ...event }),
        () => !this.disposed,
      ))
        errors.push(error);
    }
    throwNotificationErrors(errors, 'Animation listeners failed.');
  }

  /** Release listeners, clips, layers, and joint references without changing the host's held pose. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.eventListeners.clear();
    this.completionListeners.clear();
    this.clips.clear();
    this.layers.clear();
    this.poseEvaluator.dispose();
    this.joints = new Map();
    this.playback = { mode: 'smooth' };
    this.speed = 1;
    this.paused = false;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('AnimationPlayer has been disposed.');
  }

  private getOrCreateLayer(name: string): AnimationLayer {
    let layer = this.layers.get(name);
    if (!layer) {
      layer = { weight: 1, transition: undefined, stopped: false };
      this.layers.set(name, layer);
    }
    return layer;
  }
}
