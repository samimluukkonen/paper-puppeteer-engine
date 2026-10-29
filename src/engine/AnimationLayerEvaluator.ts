import type { AnimationPlaybackMode, CompiledClip } from './AnimationClip.js';
import { quantizePlaybackTime } from './animationMath.js';
import { type AnimationPose, blendPose, blendPoseInto, ClipPoseBuffer } from './AnimationPose.js';
import { AnimationIKEvaluator, type IKAnimationPose } from './ik/AnimationIKPose.js';
import type { Joint } from './Joint.js';
import { evaluateMeshDeformation, blendMeshDeformation, type MeshDeformationPose } from './meshDeformation.js';
import type { PlaybackInstanceId, PlaybackOutcome } from './PlaybackLifecycle.js';
import { readonlyMap } from './readonlyData.js';
import type { Rig } from './Rig.js';
import type { RootMotionPolicy } from './rootMotion.js';
import { type AttachmentDefinition, type TransformProperty, transformProperties } from './types.js';

export interface AnimationState {
  playbackId: PlaybackInstanceId;
  outcome?: PlaybackOutcome;
  clip: CompiledClip;
  time: number;
  /** Unwrapped playback time, distinct from the local skeletal/event clock. */
  unwrappedTime: number;
  rootMotion: RootMotionPolicy;
  speed: number;
  playing: boolean;
}

export interface AnimationTransition {
  source: AnimationState | AnimationPose;
  elapsed: number;
  duration: number;
  ikSource?: IKAnimationPose;
  deformationSource?: MeshDeformationPose;
}

export interface AnimationLayer {
  state?: AnimationState;
  transition: AnimationTransition | undefined;
  mask?: ReadonlySet<string>;
  weight: number;
  stopped: boolean;
}

interface LayerBuffers {
  target: ClipPoseBuffer;
  source: ClipPoseBuffer;
  blended: AnimationPose;
}

/** Owns pose buffers and sparse property ownership; the player retains clocks and notifications. */
export class AnimationLayerEvaluator {
  deformation: MeshDeformationPose = new Map();
  private readonly workingPose: AnimationPose = new Map();
  private readonly emptyPose: AnimationPose = new Map();
  private readonly controlled = new Map<string, Set<TransformProperty>>();
  private controlDirty = true;
  private readonly layerBuffers = new WeakMap<AnimationLayer, LayerBuffers>();
  readonly ikEvaluator: AnimationIKEvaluator;
  private ikPlayback: AnimationPlaybackMode = { mode: 'smooth' };
  private sampleBuffer: ClipPoseBuffer | undefined;
  private meshAttachments: readonly AttachmentDefinition[];

  constructor(
    private readonly rig: Rig,
    private joints: ReadonlyMap<string, Joint>,
  ) {
    this.meshAttachments = rig.attachments;
    this.ikEvaluator = new AnimationIKEvaluator(
      rig,
      (clip, time) => this.sampleTime(clip, time, this.ikPlayback),
      (state, transition) => this.transitionWeight(state, transition, this.ikPlayback),
    );
    for (const bone of rig.bones) {
      if (!joints.has(bone.id)) throw new Error(`Missing joint "${bone.id}".`);
      this.workingPose.set(bone.id, { ...joints.get(bone.id)!.bindPose });
      this.controlled.set(bone.id, new Set());
    }
  }

  invalidate(): void {
    this.controlDirty = true;
  }

  sample(
    state: AnimationState,
    time: number,
    usePlayback: boolean,
    layers: ReadonlyMap<string, AnimationLayer>,
    playback: AnimationPlaybackMode,
  ): void {
    const clampedTime = Math.max(0, Math.min(time, state.clip.duration));
    this.sampleBuffer ??= new ClipPoseBuffer();
    const pose = this.sampleBuffer.evaluate(
      state.clip,
      usePlayback ? this.sampleTime(state.clip, clampedTime, playback) : clampedTime,
    );
    this.deformation = evaluateMeshDeformation(
      state.clip,
      usePlayback ? this.sampleTime(state.clip, clampedTime, playback) : clampedTime,
    );
    this.ikEvaluator.sample(state.clip, usePlayback ? this.sampleTime(state.clip, clampedTime, playback) : clampedTime);
    this.updateControlledProperties(layers);
    for (const [id, properties] of this.controlled) {
      const joint = this.joints.get(id)!;
      for (const property of properties) joint.pose[property] = joint.bindPose[property];
    }
    for (const [id, values] of pose) Object.assign(this.joints.get(id)!.pose, values);
  }

  /** Reapply layers while retaining manual edits outside their controlled properties. */
  applyCurrentPose(layers: ReadonlyMap<string, AnimationLayer>, playback: AnimationPlaybackMode): void {
    this.ikPlayback = playback;
    const base = layers.get('base');
    const pose = this.workingPose;
    for (const [id, values] of pose) {
      const bindPose = this.joints.get(id)!.bindPose;
      for (const property of transformProperties) values[property] = bindPose[property];
    }
    if (base?.state) blendPoseInto(pose, this.emptyPose, this.evaluateLayer(base, pose, playback), 1);
    for (const [name, layer] of layers) {
      if (name === 'base' || !layer.state || layer.weight === 0) continue;
      blendPoseInto(pose, this.emptyPose, this.evaluateLayer(layer, pose, playback), layer.weight, layer.mask);
    }
    this.updateControlledProperties(layers);
    const controlled = this.controlled;
    for (const [id, values] of pose) {
      const joint = this.joints.get(id)!;
      for (const property of transformProperties) {
        if (!controlled.get(id)?.has(property)) values[property] = joint.pose[property];
      }
    }
    for (const [id, values] of pose) Object.assign(this.joints.get(id)!.pose, values);
    this.ikEvaluator.apply(layers);
    this.refreshMeshDeformation(layers, playback);
  }

  /** Refresh masks after catalog weight edits without reapplying bones, IK, clocks or events. */
  updateMeshAttachments(
    attachments: readonly AttachmentDefinition[],
    layers: ReadonlyMap<string, AnimationLayer>,
    playback: AnimationPlaybackMode,
  ): void {
    this.meshAttachments = attachments;
    this.refreshMeshDeformation(layers, playback);
  }

  private refreshMeshDeformation(layers: ReadonlyMap<string, AnimationLayer>, playback: AnimationPlaybackMode): void {
    let deformation: MeshDeformationPose = new Map();
    for (const layer of layers.values()) deformation = this.applyDeformationLayer(deformation, layer, playback);
    this.deformation = readonlyMap(deformation);
  }

  private applyDeformationLayer(
    underlying: MeshDeformationPose,
    layer: AnimationLayer,
    playback: AnimationPlaybackMode,
  ): MeshDeformationPose {
    if (!layer.state || layer.weight === 0) return underlying;
    let value = this.evaluateDeformationLayer(layer, playback, underlying);
    // All weighted bones must be in the mask; unweighted legacy meshes require all bind slot bones.
    if (layer.mask)
      value = new Map(
        [...value].filter(([id]) => {
          const mesh = this.meshAttachments.find((entry) => entry.id === id);
          return (
            mesh?.type === 'mesh' &&
            mesh.vertices.every((vertex) =>
              vertex.influences
                ? vertex.influences.every((entry) => entry.weight === 0 || layer.mask!.has(entry.boneId))
                : mesh.bindPose.slots.every((slot) => layer.mask!.has(slot.bone)),
            )
          );
        }),
      );
    const target = new Map(underlying);
    for (const [id, offsets] of value) target.set(id, offsets);
    return blendMeshDeformation(underlying, target, layer.weight);
  }

  underlyingDeformation(
    layerName: string,
    layers: ReadonlyMap<string, AnimationLayer>,
    playback: AnimationPlaybackMode,
  ): MeshDeformationPose {
    let result: MeshDeformationPose = new Map();
    for (const [name, layer] of layers) {
      if (name === layerName) break;
      result = this.applyDeformationLayer(result, layer, playback);
    }
    return result;
  }

  evaluateDeformationLayer(
    layer: AnimationLayer,
    playback: AnimationPlaybackMode,
    underlying: MeshDeformationPose = new Map(),
  ): MeshDeformationPose {
    const state = layer.state!;
    const target = evaluateMeshDeformation(state.clip, this.sampleTime(state.clip, state.time, playback));
    const transition = layer.transition;
    if (!transition) return target;
    const source: MeshDeformationPose =
      transition.deformationSource ??
      (transition.source instanceof Map
        ? new Map()
        : evaluateMeshDeformation(
            transition.source.clip,
            this.sampleTime(transition.source.clip, transition.source.time, playback),
          ));
    const from = new Map(source),
      to = new Map(target);
    // Missing shape ownership fades against the lower layer, like sparse bone properties.
    for (const id of new Set([...source.keys(), ...target.keys()])) {
      if (!from.has(id)) from.set(id, underlying.get(id) ?? new Map());
      if (!to.has(id)) to.set(id, underlying.get(id) ?? new Map());
    }
    return blendMeshDeformation(from, to, this.transitionWeight(state, transition, playback));
  }

  private updateControlledProperties(layers: ReadonlyMap<string, AnimationLayer>): void {
    if (!this.controlDirty) return;
    for (const properties of this.controlled.values()) properties.clear();
    for (const layer of layers.values()) this.markLayerControlled(this.controlled, layer);
    this.controlDirty = false;
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

  resetLayerProperties(layer: AnimationLayer): void {
    const controlled = new Map<string, Set<TransformProperty>>();
    this.markLayerControlled(controlled, layer);
    for (const [id, properties] of controlled) {
      const joint = this.joints.get(id)!;
      for (const property of properties) joint.pose[property] = joint.bindPose[property];
    }
  }

  /** Reuse per-layer buffers; interrupted fades request an independent snapshot with sparse ownership. */
  evaluateLayer(
    layer: AnimationLayer,
    underlying: AnimationPose,
    playback: AnimationPlaybackMode,
    snapshot = false,
  ): AnimationPose {
    let buffers = this.layerBuffers.get(layer);
    if (!buffers) {
      buffers = { target: new ClipPoseBuffer(), source: new ClipPoseBuffer(), blended: new Map() };
      this.layerBuffers.set(layer, buffers);
    }
    const state = layer.state!;
    const target = buffers.target.evaluate(state.clip, this.sampleTime(state.clip, state.time, playback));
    const transition = layer.transition;
    if (!transition) return snapshot ? new Map([...target].map(([id, values]) => [id, { ...values }])) : target;
    const source =
      transition.source instanceof Map
        ? transition.source
        : buffers.source.evaluate(
            transition.source.clip,
            this.sampleTime(transition.source.clip, transition.source.time, playback),
          );
    for (const [id, values] of underlying) {
      const output = buffers.blended.get(id) ?? {};
      Object.assign(output, values);
      buffers.blended.set(id, output);
    }
    blendPoseInto(buffers.blended, source, target, this.transitionWeight(state, transition, playback));
    if (!snapshot) return buffers.blended;
    // Copy only properties owned by the fade, excluding underlying fallback properties.
    const pose: AnimationPose = new Map();
    for (const [id, values] of source) pose.set(id, { ...values });
    for (const [id, values] of target) pose.set(id, { ...pose.get(id), ...values });
    for (const [id, values] of pose) {
      for (const property of transformProperties) {
        if (values[property] !== undefined) values[property] = buffers.blended.get(id)![property]!;
      }
    }
    return pose;
  }

  transitionWeight(state: AnimationState, transition: AnimationTransition, playback: AnimationPlaybackMode): number {
    const mode = state.clip.playback ?? playback;
    const blendTime =
      transition.elapsed < transition.duration ? quantizePlaybackTime(transition.elapsed, mode) : transition.elapsed;
    return Math.min(1, blendTime / transition.duration);
  }

  private bindPose(): AnimationPose {
    return new Map(this.rig.bones.map((bone) => [bone.id, { ...this.joints.get(bone.id)!.bindPose }]));
  }

  underlyingPose(
    layerName: string,
    layers: ReadonlyMap<string, AnimationLayer>,
    playback: AnimationPlaybackMode,
  ): AnimationPose {
    let pose = this.bindPose();
    for (const [name, layer] of layers) {
      if (name === layerName) break;
      if (layer.state && layer.weight > 0)
        pose = blendPose(pose, new Map(), this.evaluateLayer(layer, pose, playback), layer.weight, layer.mask);
    }
    return pose;
  }

  private sampleTime(clip: CompiledClip, time: number, playback: AnimationPlaybackMode): number {
    const mode = clip.playback ?? playback;
    if (!clip.loop && time === clip.duration) return time;
    return quantizePlaybackTime(time, mode);
  }

  dispose(): void {
    this.ikEvaluator.clear();
    this.deformation = new Map();
    this.sampleBuffer = undefined;
    this.workingPose.clear();
    this.emptyPose.clear();
    this.controlled.clear();
    this.joints = new Map();
  }
}
