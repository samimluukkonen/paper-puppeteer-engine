import { evaluateCurveProgress, type PropertyCurve } from './animationCurves.js';
import { interpolateNumber } from './animationMath.js';
import { isFullyFrozen, readonlyMap } from './readonlyData.js';
import { assertFinite } from './types.js';
import type { RigDefinition } from './types.js';
import type { ValidationIssue } from './validation.js';

export interface VertexOffset {
  readonly x: number;
  readonly y: number;
}
/** A sparse shape snapshot. Omitted vertices mean zero, including between neighboring keys. */
export interface MeshDeformationKey {
  readonly time: number;
  readonly offsets: Readonly<Record<string, VertexOffset>>;
  /** Outgoing segment, shared by every vertex/axis in this shape. Default: linear. */
  readonly curve?: PropertyCurve;
}
/** Attachment IDs, independent of active skins and vertex array order. */
export type MeshDeformationTracks = Readonly<Record<string, readonly MeshDeformationKey[]>>;
export type MeshVertexOffsets = ReadonlyMap<string, VertexOffset>;
export type MeshDeformationPose = ReadonlyMap<string, MeshVertexOffsets>;
const emptyKeys: readonly MeshDeformationKey[] = Object.freeze([]);
export function getMeshDeformationTrack(
  clip: { readonly deformationTracks?: MeshDeformationTracks },
  id: string,
): readonly MeshDeformationKey[] {
  return clip.deformationTracks && Object.hasOwn(clip.deformationTracks, id) ? clip.deformationTracks[id]! : emptyKeys;
}
const zero: VertexOffset = Object.freeze({ x: 0, y: 0 });
/** Shared immutable neutral results, including clips with no deformation ownership. */
export const emptyMeshVertexOffsets: MeshVertexOffsets = readonlyMap([]);
export const emptyMeshDeformation: MeshDeformationPose = readonlyMap([]);

type MutableOffset = { x: number; y: number };
interface CompiledShapeSegment {
  readonly indices: readonly number[];
  readonly from: readonly VertexOffset[];
  readonly to: readonly VertexOffset[];
}
interface CompiledShapeTrack {
  readonly keys: readonly MeshDeformationKey[];
  readonly vertices: readonly string[];
  readonly segments: readonly CompiledShapeSegment[];
}
const compiledShapes = new WeakMap<readonly MeshDeformationKey[], CompiledShapeTrack>();

/** Compile sparse neighboring shapes, rather than a dense key-by-vertex matrix. */
function compileShapeTrack(keys: readonly MeshDeformationKey[]): CompiledShapeTrack {
  const cached = compiledShapes.get(keys);
  if (cached) return cached;
  const vertices: string[] = [];
  const indices = new Map<string, number>();
  const segments = keys.map((next, index): CompiledShapeSegment => {
    const previous = keys[Math.max(0, index - 1)]!;
    const ids = new Set([...Object.keys(previous.offsets), ...Object.keys(next.offsets)]);
    const segment: { indices: number[]; from: VertexOffset[]; to: VertexOffset[] } = {
      indices: [],
      from: [],
      to: [],
    };
    for (const id of ids) {
      let vertex = indices.get(id);
      if (vertex === undefined) {
        vertex = vertices.length;
        vertices.push(id);
        indices.set(id, vertex);
      }
      segment.indices.push(vertex);
      segment.from.push(Object.hasOwn(previous.offsets, id) ? previous.offsets[id]! : zero);
      segment.to.push(Object.hasOwn(next.offsets, id) ? next.offsets[id]! : zero);
    }
    return segment;
  });
  const compiled = { keys, vertices, segments };
  // Public helpers also accept mutable authored keys; only immutable layouts can be cached.
  if (isFullyFrozen(keys)) compiledShapes.set(keys, compiled);
  return compiled;
}

class ShapeSampleBuffer {
  readonly offsets = new Map<string, VertexOffset>();
  private readonly values: MutableOffset[];
  private segment: CompiledShapeSegment | undefined;

  constructor(private readonly track: CompiledShapeTrack) {
    this.values = track.vertices.map(() => ({ x: 0, y: 0 }));
  }

  sample(time: number): MeshVertexOffsets {
    const { keys, segments, vertices } = this.track;
    if (!keys.length) return emptyMeshVertexOffsets;
    let low = 0;
    let high = keys.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (keys[middle]!.time < time) low = middle + 1;
      else high = middle;
    }
    const nextIndex = Math.min(low, keys.length - 1);
    const next = keys[nextIndex]!;
    const previous = keys[Math.max(0, nextIndex - 1)]!;
    const progress =
      previous === next || time >= next.time
        ? 1
        : evaluateCurveProgress(previous.curve, (time - previous.time) / (next.time - previous.time));
    const segment = segments[nextIndex]!;
    if (this.segment !== segment) {
      this.offsets.clear();
      this.segment = segment;
    }
    for (let index = 0; index < segment.indices.length; index++) {
      const vertex = segment.indices[index]!;
      const a = segment.from[index]!;
      const b = segment.to[index]!;
      const value = this.values[vertex]!;
      value.x = interpolateNumber(a.x, b.x, progress);
      value.y = interpolateNumber(a.y, b.y, progress);
      if (value.x !== 0 || value.y !== 0) this.offsets.set(vertices[vertex]!, value);
      else this.offsets.delete(vertices[vertex]!);
    }
    return this.offsets.size ? this.offsets : emptyMeshVertexOffsets;
  }
}

/** Private live samples. Callers must snapshot before retaining values across evaluations. */
export class MeshDeformationClipBuffer {
  private clip: { readonly deformationTracks?: MeshDeformationTracks } | undefined;
  private tracks: { id: string; buffer: ShapeSampleBuffer }[] = [];
  private readonly pose = new Map<string, MeshVertexOffsets>();

  evaluate(clip: { readonly deformationTracks?: MeshDeformationTracks }, time: number): MeshDeformationPose {
    assertFinite(time, 'Mesh deformation sample time');
    if (clip !== this.clip) {
      this.clip = clip;
      this.pose.clear();
      this.tracks = Object.entries(clip.deformationTracks ?? {}).map(([id, keys]) => ({
        id,
        buffer: new ShapeSampleBuffer(compileShapeTrack(keys)),
      }));
    }
    for (const track of this.tracks) this.pose.set(track.id, track.buffer.sample(time));
    return this.pose.size ? this.pose : emptyMeshDeformation;
  }
}

class VertexBlendBuffer {
  readonly offsets = new Map<string, VertexOffset>();
  private readonly values = new Map<string, MutableOffset>();

  blend(from: MeshVertexOffsets, to: MeshVertexOffsets, weight: number): MeshVertexOffsets {
    for (const id of this.offsets.keys()) if (!from.has(id) && !to.has(id)) this.offsets.delete(id);
    for (const id of from.keys()) this.write(id, from.get(id)!, to.get(id) ?? zero, weight);
    for (const id of to.keys()) if (!from.has(id)) this.write(id, zero, to.get(id)!, weight);
    return this.offsets.size ? this.offsets : emptyMeshVertexOffsets;
  }

  private write(id: string, from: VertexOffset, to: VertexOffset, weight: number): void {
    let value = this.values.get(id);
    if (!value) {
      value = { x: 0, y: 0 };
      this.values.set(id, value);
    }
    value.x = interpolateNumber(from.x, to.x, weight);
    value.y = interpolateNumber(from.y, to.y, weight);
    this.offsets.set(id, value);
  }
}

/** Reusable blending storage. Output never aliases another buffer's mutable offset objects. */
export class MeshDeformationBlendBuffer {
  private readonly pose = new Map<string, MeshVertexOffsets>();
  private readonly meshes = new Map<string, VertexBlendBuffer>();

  blend(
    from: MeshDeformationPose,
    to: MeshDeformationPose,
    weight: number,
    underlying: MeshDeformationPose = emptyMeshDeformation,
  ): MeshDeformationPose {
    for (const id of this.pose.keys()) if (!from.has(id) && !to.has(id)) this.pose.delete(id);
    for (const [id, offsets] of from)
      this.write(id, offsets, to.get(id) ?? underlying.get(id) ?? emptyMeshVertexOffsets, weight);
    for (const [id, offsets] of to)
      if (!from.has(id)) this.write(id, underlying.get(id) ?? emptyMeshVertexOffsets, offsets, weight);
    return this.pose.size ? this.pose : emptyMeshDeformation;
  }

  apply(
    underlying: MeshDeformationPose,
    value: MeshDeformationPose,
    weight: number,
    eligible?: ReadonlySet<string>,
  ): MeshDeformationPose {
    for (const id of this.pose.keys())
      if (!underlying.has(id) && (!value.has(id) || (eligible && !eligible.has(id)))) this.pose.delete(id);
    for (const [id, offsets] of underlying) {
      const target = !eligible || eligible.has(id) ? value.get(id) : undefined;
      this.write(id, offsets, target ?? offsets, weight);
    }
    for (const [id, offsets] of value)
      if (!underlying.has(id) && (!eligible || eligible.has(id)))
        this.write(id, emptyMeshVertexOffsets, offsets, weight);
    return this.pose.size ? this.pose : emptyMeshDeformation;
  }

  private write(id: string, from: MeshVertexOffsets, to: MeshVertexOffsets, weight: number): void {
    let buffer = this.meshes.get(id);
    if (!buffer) {
      buffer = new VertexBlendBuffer();
      this.meshes.set(id, buffer);
    }
    if (weight <= 0) this.pose.set(id, buffer.blend(from, from, 0));
    else if (weight >= 1) this.pose.set(id, buffer.blend(to, to, 1));
    else this.pose.set(id, buffer.blend(from, to, weight));
  }
}

function snapshotVertexOffsets(offsets: MeshVertexOffsets): MeshVertexOffsets {
  if (!offsets.size) return emptyMeshVertexOffsets;
  return readonlyMap([...offsets].map(([id, value]) => [id, Object.freeze({ x: value.x, y: value.y })] as const));
}

/** Detach public results and interrupted fades from the private live buffers. */
export function snapshotMeshDeformation(pose: MeshDeformationPose): MeshDeformationPose {
  if (!pose.size) return emptyMeshDeformation;
  return readonlyMap([...pose].map(([id, offsets]) => [id, snapshotVertexOffsets(offsets)] as const));
}

export function sampleMeshDeformation(keys: readonly MeshDeformationKey[], time: number): MeshVertexOffsets {
  assertFinite(time, 'Mesh deformation sample time');
  if (!keys.length) return emptyMeshVertexOffsets;
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle]!.time < time) low = middle + 1;
    else high = middle;
  }
  const next = keys[Math.min(low, keys.length - 1)]!;
  const previous = keys[Math.max(0, low - 1)]!;
  const progress =
    previous === next || time >= next.time
      ? 1
      : evaluateCurveProgress(previous.curve, (time - previous.time) / (next.time - previous.time));
  const result = new Map<string, VertexOffset>();
  const sample = (id: string): void => {
    const from = Object.hasOwn(previous.offsets, id) ? previous.offsets[id]! : zero;
    const to = Object.hasOwn(next.offsets, id) ? next.offsets[id]! : zero;
    const x = interpolateNumber(from.x, to.x, progress);
    const y = interpolateNumber(from.y, to.y, progress);
    if (x !== 0 || y !== 0) result.set(id, Object.freeze({ x, y }));
  };
  for (const id in previous.offsets) if (Object.hasOwn(previous.offsets, id)) sample(id);
  for (const id in next.offsets)
    if (Object.hasOwn(next.offsets, id) && !Object.hasOwn(previous.offsets, id)) sample(id);
  return result.size ? readonlyMap(result) : emptyMeshVertexOffsets;
}

export function evaluateMeshDeformation(
  clip: { readonly deformationTracks?: MeshDeformationTracks },
  time: number,
): MeshDeformationPose {
  assertFinite(time, 'Mesh deformation sample time');
  let pose: Map<string, MeshVertexOffsets> | undefined;
  for (const id in clip.deformationTracks) {
    if (!Object.hasOwn(clip.deformationTracks, id)) continue;
    pose ??= new Map();
    pose.set(id, sampleMeshDeformation(clip.deformationTracks[id]!, time));
  }
  return pose ? readonlyMap(pose) : emptyMeshDeformation;
}

/** Used for existing layer weights/fades; missing corrections always resolve to neutral. */
export function blendMeshDeformation(
  a: MeshDeformationPose,
  b: MeshDeformationPose,
  weight: number,
): MeshDeformationPose {
  if (weight <= 0) return a;
  if (weight >= 1) return b;
  if (!a.size && !b.size) return emptyMeshDeformation;
  return snapshotMeshDeformation(new MeshDeformationBlendBuffer().blend(a, b, weight));
}

/** Reordering/subdivision keeps surviving IDs. Deleted/replaced IDs block validation rather than retargeting. */
export function meshDeformationIssues(
  tracks: MeshDeformationTracks | undefined,
  rig: Pick<RigDefinition, 'attachments'>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!tracks || !Object.keys(tracks).length) return issues;
  const attachments = new Map((rig.attachments ?? []).map((mesh) => [mesh.id, mesh]));
  for (const [id, keys] of Object.entries(tracks ?? {})) {
    const mesh = attachments.get(id);
    const path = `deformationTracks.${id}`;
    if (mesh?.type !== 'mesh') {
      issues.push({
        severity: 'error',
        path,
        message: `Deformation track references missing or non-mesh attachment "${id}".`,
      });
      continue;
    }
    const vertices = new Set(mesh.vertices.map((vertex) => vertex.id));
    for (const [index, key] of keys.entries())
      for (const vertex of Object.keys(key.offsets))
        if (!vertices.has(vertex))
          issues.push({
            severity: 'error',
            path: `${path}[${index}].offsets.${vertex}`,
            message: `Incompatible mesh topology: vertex "${vertex}" is missing from "${id}". Restore its ID or remove the correction explicitly.`,
          });
  }
  return issues;
}
