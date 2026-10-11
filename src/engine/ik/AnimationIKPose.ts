import { sampleProperty, type CompiledClip } from '../AnimationClip.js';
import type { AnimationLayer, AnimationState, AnimationTransition } from '../AnimationLayerEvaluator.js';
import { interpolateNumber } from '../animationMath.js';
import { readonlyMap } from '../readonlyData.js';
import type { Rig } from '../Rig.js';
import { assertFinite } from '../types.js';
import { ikAnimationProperties, type IKAnimationProperty } from './animationKeyframes.js';

/** Value and ownership weight; the unowned fraction resolves against the current procedural fallback. */
export interface IKAnimationChannel {
  readonly value: number;
  readonly weight: number;
}
export type IKAnimationValues = Readonly<Partial<Record<IKAnimationProperty, IKAnimationChannel>>>;
export type IKAnimationPose = ReadonlyMap<string, IKAnimationValues>;
const emptyPose: IKAnimationPose = readonlyMap([]);

/** Pure sparse interpolation, using the same property sampler as bone tracks. Time is milliseconds. */
export function evaluateIKClip(clip: CompiledClip, time: number): IKAnimationPose {
  assertFinite(time, 'IK sample time');
  if (!clip.ikTracks?.length) return emptyPose;
  const pose = new Map<string, IKAnimationValues>();
  for (const track of clip.ikTracks ?? []) {
    const values: Partial<Record<IKAnimationProperty, IKAnimationChannel>> = {};
    for (const [property, keys] of track.properties)
      values[property] = Object.freeze({ value: sampleProperty(keys, time), weight: 1 });
    if (track.properties.size) pose.set(track.constraint, Object.freeze(values));
  }
  return pose.size ? readonlyMap(pose) : emptyPose;
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
    const values: Partial<Record<IKAnimationProperty, IKAnimationChannel>> = {};
    for (const property of ikAnimationProperties) {
      if (!source.get(id)?.[property] && !target.get(id)?.[property]) continue;
      const fallback = underlying.get(id)?.[property];
      const channel = blendChannel(
        source.get(id)?.[property] ?? fallback,
        target.get(id)?.[property] ?? fallback,
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
  }
  sample(clip: CompiledClip, time: number): void {
    this.pose = evaluateIKClip(clip, time);
  }

  private layerPose(layer: AnimationLayer, underlying: IKAnimationPose): IKAnimationPose {
    const state = layer.state!;
    const target = evaluateIKClip(state.clip, this.sampleTime(state.clip, state.time));
    const transition = layer.transition;
    if (!transition) return target;
    const source =
      transition.source instanceof Map
        ? (transition.ikSource ?? emptyPose)
        : evaluateIKClip(transition.source.clip, this.sampleTime(transition.source.clip, transition.source.time));
    return blend(underlying, source, target, this.transitionWeight(state, transition));
  }

  private applyLayer(pose: IKAnimationPose, layer: AnimationLayer): IKAnimationPose {
    if (!layer.state || layer.weight === 0) return pose;
    const values = this.layerPose(layer, pose);
    if (!values.size) return pose;
    const filtered = layer.mask
      ? readonlyMap([...values].filter(([id]) => layer.mask!.has(this.roots.get(id)!)))
      : values;
    if (!filtered.size) return pose;
    return readonlyMap([...pose, ...blend(pose, pose, filtered, layer.weight)]);
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
