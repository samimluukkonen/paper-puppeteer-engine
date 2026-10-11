import { sampleProperty, type CompiledClip } from '../AnimationClip.js';
import type { AnimationLayer, AnimationState, AnimationTransition } from '../AnimationLayerEvaluator.js';
import { interpolateNumber } from '../animationMath.js';
import { readonlyMap } from '../readonlyData.js';
import type { Rig } from '../Rig.js';
import { assertFinite } from '../types.js';
import { ikAnimationProperties } from './animationKeyframes.js';

/** Value and ownership weight; the unowned fraction resolves against the current procedural fallback. */
export interface IKAnimationChannel {
  readonly value: number;
  readonly weight: number;
}
const evaluationProperties = [...ikAnimationProperties, 'disabled'] as const;
export type IKAnimationValues = Readonly<Partial<Record<(typeof evaluationProperties)[number], IKAnimationChannel>>>;
export type IKAnimationPose = ReadonlyMap<string, IKAnimationValues>;
const emptyPose: IKAnimationPose = readonlyMap([]);

/** Pure sparse interpolation, using the same property sampler as bone tracks. Time is milliseconds. */
export function evaluateIKClip(clip: CompiledClip, time: number): IKAnimationPose {
  assertFinite(time, 'IK sample time');
  if (!clip.ikTracks?.length && !clip.disabledIKConstraints?.length) return emptyPose;
  const pose = new Map<string, IKAnimationValues>();
  for (const track of clip.ikTracks ?? []) {
    const values: Partial<Record<(typeof evaluationProperties)[number], IKAnimationChannel>> = {};
    for (const [property, keys] of track.properties)
      values[property] = Object.freeze({ value: sampleProperty(keys, time), weight: 1 });
    if (track.properties.size) pose.set(track.constraint, Object.freeze(values));
  }
  for (const id of clip.disabledIKConstraints ?? [])
    pose.set(id, Object.freeze({ disabled: Object.freeze({ value: 1, weight: 1 }) }));
  return pose.size ? readonlyMap(pose) : emptyPose;
}

/** Player-owned clips are immutable. Retain only the last sample for each source/target clock. */
class IKClipSample {
  private clip: CompiledClip | undefined;
  private time: number | undefined;
  private pose: IKAnimationPose = emptyPose;

  evaluate(clip: CompiledClip, time: number): IKAnimationPose {
    if (this.clip !== clip || this.time !== time) {
      this.pose = evaluateIKClip(clip, time);
      this.clip = clip;
      this.time = time;
    }
    return this.pose;
  }
}

interface LayerCache {
  target: IKClipSample;
  source: IKClipSample;
  fade?: {
    underlying: IKAnimationPose;
    source: IKAnimationPose;
    target: IKAnimationPose;
    weight: number;
    result: IKAnimationPose;
  };
  applied?: {
    underlying: IKAnimationPose;
    values: IKAnimationPose;
    mask: ReadonlySet<string> | undefined;
    weight: number;
    result: IKAnimationPose;
  };
}

function blendChannel(
  from: IKAnimationChannel | undefined,
  to: IKAnimationChannel | undefined,
  weight: number,
): IKAnimationChannel | undefined {
  const fromWeight = (from?.weight ?? 0) * (1 - weight);
  const toWeight = (to?.weight ?? 0) * weight;
  const ownership = fromWeight + toWeight;
  if (ownership === 0) return undefined;
  if (weight === 0) return from;
  if (weight === 1) return to;
  return Object.freeze({
    value: interpolateNumber(from?.value ?? to!.value, to?.value ?? from!.value, toWeight / ownership),
    weight: ownership,
  });
}

function blend(
  underlying: IKAnimationPose,
  source: IKAnimationPose,
  target: IKAnimationPose,
  weight: number,
): IKAnimationPose {
  if (!source.size && !target.size) return emptyPose;
  const result = new Map<string, IKAnimationValues>();
  for (const id of new Set([...source.keys(), ...target.keys()])) {
    const values: Partial<Record<(typeof evaluationProperties)[number], IKAnimationChannel>> = {};
    const from = source.get(id);
    const to = target.get(id);
    const fallback = underlying.get(id);
    for (const property of evaluationProperties) {
      if (!from?.[property] && !to?.[property]) continue;
      const channel = blendChannel(
        from?.[property] ?? fallback?.[property],
        to?.[property] ?? fallback?.[property],
        weight,
      );
      if (channel) values[property] = channel;
    }
    if (Object.keys(values).length) result.set(id, Object.freeze(values));
  }
  return readonlyMap(result);
}

/** Shares player layer clocks, masks and fade timing; never advances time or dispatches events. */
export class AnimationIKEvaluator {
  private pose: IKAnimationPose = emptyPose;
  private readonly roots: ReadonlyMap<string, string>;
  private layerCaches = new WeakMap<AnimationLayer, LayerCache>();
  private sampleCache = new IKClipSample();
  constructor(
    rig: Rig,
    private readonly sampleTime: (clip: CompiledClip, time: number) => number,
    private readonly transitionWeight: (state: AnimationState, transition: AnimationTransition) => number,
  ) {
    this.roots = new Map((rig.ik ?? []).map((constraint) => [constraint.name, constraint.rootBone]));
  }

  get current(): IKAnimationPose {
    return this.pose;
  }
  clear(): void {
    this.pose = emptyPose;
    this.layerCaches = new WeakMap();
    this.sampleCache = new IKClipSample();
  }
  sample(clip: CompiledClip, time: number): void {
    this.pose = this.sampleCache.evaluate(clip, time);
  }

  private cacheFor(layer: AnimationLayer): LayerCache {
    let cache = this.layerCaches.get(layer);
    if (!cache) {
      cache = { target: new IKClipSample(), source: new IKClipSample() };
      this.layerCaches.set(layer, cache);
    }
    return cache;
  }

  private layerPose(layer: AnimationLayer, underlying: IKAnimationPose): IKAnimationPose {
    const state = layer.state!;
    const cache = this.cacheFor(layer);
    const target = cache.target.evaluate(state.clip, this.sampleTime(state.clip, state.time));
    const transition = layer.transition;
    if (!transition) return target;
    const source =
      transition.source instanceof Map
        ? (transition.ikSource ?? emptyPose)
        : cache.source.evaluate(
            transition.source.clip,
            this.sampleTime(transition.source.clip, transition.source.time),
          );
    const weight = this.transitionWeight(state, transition);
    const previous = cache.fade;
    if (
      previous?.underlying === underlying &&
      previous.source === source &&
      previous.target === target &&
      previous.weight === weight
    )
      return previous.result;
    const result = blend(underlying, source, target, weight);
    cache.fade = { underlying, source, target, weight, result };
    return result;
  }

  private applyLayer(pose: IKAnimationPose, layer: AnimationLayer): IKAnimationPose {
    if (!layer.state || layer.weight === 0) return pose;
    const values = this.layerPose(layer, pose);
    if (!values.size) return pose;
    const cache = this.cacheFor(layer);
    const previous = cache.applied;
    // Player masks are replaced rather than mutated; identity covers all mask changes.
    if (
      previous?.underlying === pose &&
      previous.values === values &&
      previous.mask === layer.mask &&
      previous.weight === layer.weight
    )
      return previous.result;
    const filtered = layer.mask
      ? readonlyMap([...values].filter(([id]) => layer.mask!.has(this.roots.get(id)!)))
      : values;
    const result = !filtered.size
      ? pose
      : !pose.size && layer.weight === 1
        ? filtered
        : readonlyMap([...pose, ...blend(pose, pose, filtered, layer.weight)]);
    cache.applied = { underlying: pose, values, mask: layer.mask, weight: layer.weight, result };
    return result;
  }

  /** Snapshot only the interrupted layer's owned channels, before replacing its state. */
  snapshotLayer(name: string, layers: ReadonlyMap<string, AnimationLayer>): IKAnimationPose {
    let underlying: IKAnimationPose = emptyPose;
    for (const [id, layer] of layers) {
      if (id === name) return this.layerPose(layer, underlying);
      underlying = this.applyLayer(underlying, layer);
    }
    return emptyPose;
  }

  apply(layers: ReadonlyMap<string, AnimationLayer>): void {
    let pose: IKAnimationPose = emptyPose;
    for (const layer of layers.values()) pose = this.applyLayer(pose, layer);
    this.pose = pose;
  }
}
