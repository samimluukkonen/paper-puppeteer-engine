import type { AnimationClip, AnimationEvent, AnimationPlaybackMode, CompiledClip } from './AnimationClip.js';
import { compileClip } from './AnimationClip.js';
import { type AnimationPose, blendPose, evaluateClip } from './AnimationPose.js';
import type { Joint } from './Joint.js';
import type { Rig } from './Rig.js';
import { assertFinite, type TransformProperty, transformProperties } from './types.js';

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

interface AnimationState {
  clip: CompiledClip;
  time: number;
  speed: number;
  playing: boolean;
}

interface AnimationTransition {
  source: AnimationState | AnimationPose;
  elapsed: number;
  duration: number;
}

interface AnimationLayer {
  state?: AnimationState;
  transition: AnimationTransition | undefined;
  mask?: ReadonlySet<string>;
  weight: number;
  stopped: boolean;
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
  private playback: AnimationPlaybackMode = { mode: 'smooth' };
  private speed = 1;
  private paused = false;

  constructor(
    private readonly rig: Rig,
    private readonly joints: ReadonlyMap<string, Joint>,
  ) {
    for (const bone of rig.bones) {
      if (!joints.has(bone.id)) throw new Error(`Missing joint "${bone.id}".`);
    }
  }

  get currentAnimation(): string | undefined {
    return this.layers.get('base')?.state?.clip.name;
  }
  get elapsedTime(): number {
    return this.layers.get('base')?.state?.time ?? 0;
  }
  get isPlaying(): boolean {
    return this.layers.get('base')?.state?.playing ?? false;
  }
  get isPaused(): boolean {
    return this.paused;
  }
  get playbackSpeed(): number {
    return this.speed;
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
      progress: this.transitionWeight(layer.state, transition),
    };
  }

  getLayerAnimation(name: string): string | undefined {
    return this.layers.get(name)?.state?.clip.name;
  }
  getLayerWeight(name: string): number {
    return this.layers.get(name)?.weight ?? 0;
  }

  addAnimation(clip: AnimationClip): void {
    if (this.clips.has(clip.name)) throw new Error(`Animation "${clip.name}" is already registered.`);
    this.clips.set(clip.name, compileClip(clip, this.rig));
  }

  /** Existing play(name) semantics restart the clip. restart:false keeps an already active clip. */
  play(name: string, options: PlayAnimationOptions = {}): void {
    const clip = this.clips.get(name);
    if (!clip) throw new Error(`Unknown animation "${name}".`);
    const layerName = options.layer ?? 'base';
    if (!layerName) throw new Error('Layer name cannot be empty.');
    const fade = options.fadeDuration ?? 0;
    assertFinite(fade, 'Fade duration');
    if (fade < 0) throw new Error('Fade duration cannot be negative.');
    const speed = options.speed ?? 1;
    validateSpeed(speed);
    const layer = this.getOrCreateLayer(layerName);
    if (options.restart === false && layer.state?.clip.name === name) return;
    let source: AnimationState | AnimationPose | undefined;
    if (fade > 0) {
      if (layer.state)
        source = layer.transition ? this.evaluateLayer(layer, this.underlyingPose(layerName)) : { ...layer.state };
      else if (layerName !== 'base') source = new Map();
    }
    layer.state = { clip, time: 0, speed, playing: true };
    layer.transition = source ? { source, elapsed: 0, duration: fade } : undefined;
    layer.stopped = false;
    if (layerName === 'base' && !source) this.resetPose();
    this.applyCurrentPose();
    this.fireStartEvents(clip, layerName);
  }

  stop(): void {
    for (const layer of this.layers.values()) {
      if (layer.state) layer.state.playing = false;
      layer.stopped = true;
    }
  }
  restart(): void {
    const name = this.currentAnimation;
    if (name) this.play(name);
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  setSpeed(speed: number): void {
    validateSpeed(speed);
    this.speed = speed;
  }

  setPlaybackMode(mode: AnimationPlaybackMode): void {
    if (mode.mode === 'stepped') {
      assertFinite(mode.fps, 'Animation FPS');
      if (mode.fps <= 0) throw new Error('Animation FPS must be greater than zero.');
    } else if (mode.mode !== 'smooth') throw new Error('Unsupported playback mode.');
    this.playback = { ...mode };
    this.applyCurrentPose();
  }

  setLayerMask(name: string, bones: readonly string[]): void {
    if (name === 'base') throw new Error('The base layer cannot have a bone mask.');
    for (const id of bones) this.rig.getBone(id);
    const layer = this.getOrCreateLayer(name);
    this.resetLayerProperties(layer);
    layer.mask = new Set(bones);
    this.applyCurrentPose();
  }

  setLayerWeight(name: string, weight: number): void {
    if (name === 'base') throw new Error('The base layer weight is fixed at 1.');
    assertFinite(weight, 'Layer weight');
    if (weight < 0 || weight > 1) throw new Error('Layer weight must be between 0 and 1.');
    const layer = this.getOrCreateLayer(name);
    if (weight === 0 && layer.weight > 0) this.resetLayerProperties(layer);
    layer.weight = weight;
    this.applyCurrentPose();
  }

  clearLayer(name: string): void {
    if (name === 'base') throw new Error('The base layer cannot be cleared.');
    const layer = this.layers.get(name);
    if (layer) this.resetLayerProperties(layer);
    this.layers.delete(name);
    this.applyCurrentPose();
  }

  /** Remove clip and layer state without changing registered clips. */
  clearAllLayers(): void {
    this.layers.clear();
    this.layers.set('base', { weight: 1, transition: undefined, stopped: false });
  }

  onAnimationEvent(listener: (event: FiredAnimationEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onAnimationComplete(listener: (event: AnimationCompletion) => void): () => void {
    this.completionListeners.add(listener);
    return () => this.completionListeners.delete(listener);
  }

  resetPose(): void {
    for (const joint of this.joints.values()) joint.reset();
  }

  update(delta: number): void {
    assertFinite(delta, 'Animation delta');
    if (delta < 0) throw new Error('Animation delta cannot be negative.');
    if (
      this.paused ||
      ![...this.layers.values()].some((layer) => layer.state?.playing || (layer.transition && !layer.stopped))
    )
      return;
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
    for (const event of events) for (const listener of [...this.eventListeners]) listener(event);
    for (const event of completions) for (const listener of [...this.completionListeners]) listener(event);
    for (const layer of this.layers.values()) {
      if (layer.transition && layer.transition.elapsed >= layer.transition.duration) layer.transition = undefined;
    }
  }

  /** Sample only the base clip, clamping time without moving clocks or firing events. Excludes fades and layers. */
  sample(time: number, options: SampleAnimationOptions = {}): void {
    assertFinite(time, 'Sample time');
    const state = this.layers.get('base')?.state;
    if (!state) return;
    const clampedTime = Math.max(0, Math.min(time, state.clip.duration));
    const pose = evaluateClip(
      state.clip,
      options.mode === 'playback' ? this.sampleTime(state.clip, clampedTime) : clampedTime,
    );
    for (const [id, values] of pose) Object.assign(this.joints.get(id)!.pose, values);
  }

  /** Reapply the held authored pose; useful before external per-frame adjustments. */
  applyCurrentPose(): void {
    const base = this.layers.get('base');
    let pose: AnimationPose = this.bindPose();
    if (base?.state) pose = blendPose(pose, new Map(), this.evaluateLayer(base, pose), 1);
    for (const [name, layer] of this.layers) {
      if (name === 'base' || !layer.state || layer.weight === 0) continue;
      pose = blendPose(pose, new Map(), this.evaluateLayer(layer, pose), layer.weight, layer.mask);
    }
    const controlled = new Map<string, Set<TransformProperty>>();
    for (const layer of this.layers.values()) {
      this.markLayerControlled(controlled, layer);
    }
    for (const [id, values] of pose) {
      const joint = this.joints.get(id)!;
      for (const property of transformProperties) {
        if (!controlled.get(id)?.has(property)) values[property] = joint.pose[property];
      }
    }
    for (const [id, values] of pose) Object.assign(this.joints.get(id)!.pose, values);
  }

  private markLayerControlled(controlled: Map<string, Set<TransformProperty>>, layer: AnimationLayer): void {
    if (!layer.state || layer.weight === 0) return;
    this.markControlled(controlled, layer.state.clip, layer.mask);
    const source = layer.transition?.source;
    if (source && !(source instanceof Map)) this.markControlled(controlled, source.clip, layer.mask);
    else if (source instanceof Map) {
      for (const [id, values] of source) {
        if (layer.mask && !layer.mask.has(id)) continue;
        const properties = controlled.get(id) ?? new Set<TransformProperty>();
        for (const property of transformProperties) if (values[property] !== undefined) properties.add(property);
        controlled.set(id, properties);
      }
    }
  }

  private markControlled(
    controlled: Map<string, Set<TransformProperty>>,
    clip: CompiledClip,
    mask?: ReadonlySet<string>,
  ): void {
    for (const track of clip.tracks) {
      if (mask && !mask.has(track.bone)) continue;
      const properties = controlled.get(track.bone) ?? new Set<TransformProperty>();
      for (const property of track.properties.keys()) properties.add(property);
      controlled.set(track.bone, properties);
    }
  }

  private resetLayerProperties(layer: AnimationLayer): void {
    const controlled = new Map<string, Set<TransformProperty>>();
    this.markLayerControlled(controlled, layer);
    for (const [id, properties] of controlled) {
      const joint = this.joints.get(id)!;
      for (const property of properties) joint.pose[property] = joint.bindPose[property];
    }
  }

  private evaluateLayer(layer: AnimationLayer, underlying: AnimationPose): AnimationPose {
    const state = layer.state!;
    const target = evaluateClip(state.clip, this.sampleTime(state.clip, state.time));
    const transition = layer.transition;
    if (!transition) return target;
    const source =
      transition.source instanceof Map
        ? transition.source
        : evaluateClip(transition.source.clip, this.sampleTime(transition.source.clip, transition.source.time));
    return blendPose(underlying, source, target, this.transitionWeight(state, transition));
  }

  private transitionWeight(state: AnimationState, transition: AnimationTransition): number {
    const mode = state.clip.playback ?? this.playback;
    const blendTime =
      mode.mode === 'stepped' && transition.elapsed < transition.duration
        ? Math.floor((transition.elapsed + 1e-9) / (1000 / mode.fps)) * (1000 / mode.fps)
        : transition.elapsed;
    return Math.min(1, blendTime / transition.duration);
  }

  private bindPose(): AnimationPose {
    return new Map(this.rig.bones.map((bone) => [bone.id, { ...this.joints.get(bone.id)!.bindPose }]));
  }

  private underlyingPose(layerName: string): AnimationPose {
    let pose = this.bindPose();
    for (const [name, layer] of this.layers) {
      if (name === layerName) break;
      if (layer.state && layer.weight > 0)
        pose = blendPose(pose, new Map(), this.evaluateLayer(layer, pose), layer.weight, layer.mask);
    }
    return pose;
  }

  private sampleTime(clip: CompiledClip, time: number): number {
    const mode = clip.playback ?? this.playback;
    if (mode.mode === 'smooth' || (!clip.loop && time === clip.duration)) return time;
    const step = 1000 / mode.fps;
    return Math.floor((time + 1e-9) / step) * step;
  }

  private advance(
    state: AnimationState,
    delta: number,
    layer?: string,
    events?: FiredAnimationEvent[],
    completions?: AnimationCompletion[],
  ): void {
    const previous = state.time;
    const distance = delta * this.speed * state.speed;
    if (distance === 0) return;
    const end = state.clip.loop ? previous + distance : Math.min(previous + distance, state.clip.duration);
    if (layer && events) {
      const crossed: { time: number; marker: AnimationEvent }[] = [];
      for (const marker of state.clip.events) {
        const first = state.clip.loop ? Math.max(0, Math.floor((previous - marker.time) / state.clip.duration) + 1) : 0;
        const last = state.clip.loop ? Math.floor((end - marker.time) / state.clip.duration) : 0;
        for (let cycle = first; cycle <= last; cycle += 1) {
          const crossing = cycle * state.clip.duration + marker.time;
          if (crossing > previous && crossing <= end) crossed.push({ time: crossing, marker });
        }
      }
      crossed.sort((a, b) => a.time - b.time);
      for (const { marker } of crossed) events.push({ ...marker, clip: state.clip.name, layer });
    }
    state.time = state.clip.loop ? end % state.clip.duration : end;
    if (!state.clip.loop && end >= state.clip.duration) {
      state.playing = false;
      if (layer && completions) completions.push({ clip: state.clip.name, layer });
    }
  }

  private fireStartEvents(clip: CompiledClip, layer: string): void {
    for (const marker of clip.events) {
      if (marker.time === 0)
        for (const listener of [...this.eventListeners]) listener({ ...marker, clip: clip.name, layer });
    }
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
