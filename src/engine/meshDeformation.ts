import { evaluateCurveProgress, type PropertyCurve } from './animationCurves.js';
import { interpolateNumber } from './animationMath.js';
import { readonlyMap } from './readonlyData.js';
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

export function sampleMeshDeformation(keys: readonly MeshDeformationKey[], time: number): MeshVertexOffsets {
  assertFinite(time, 'Mesh deformation sample time');
  if (!keys.length) return readonlyMap([]);
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
  for (const id of new Set([...Object.keys(previous.offsets), ...Object.keys(next.offsets)])) {
    const a = Object.hasOwn(previous.offsets, id) ? previous.offsets[id]! : zero;
    const b = Object.hasOwn(next.offsets, id) ? next.offsets[id]! : zero;
    const x = interpolateNumber(a.x, b.x, progress);
    const y = interpolateNumber(a.y, b.y, progress);
    if (x !== 0 || y !== 0) result.set(id, Object.freeze({ x, y }));
  }
  return readonlyMap(result);
}

export function evaluateMeshDeformation(
  clip: { readonly deformationTracks?: MeshDeformationTracks },
  time: number,
): MeshDeformationPose {
  assertFinite(time, 'Mesh deformation sample time');
  return readonlyMap(
    Object.entries(clip.deformationTracks ?? {}).map(([id, keys]) => [id, sampleMeshDeformation(keys, time)]),
  );
}

/** Used for existing layer weights/fades; missing corrections always resolve to neutral. */
export function blendMeshDeformation(
  a: MeshDeformationPose,
  b: MeshDeformationPose,
  weight: number,
): MeshDeformationPose {
  if (weight <= 0) return a;
  if (weight >= 1) return b;
  return readonlyMap(
    [...new Set([...a.keys(), ...b.keys()])].map((mesh) => {
      const from = a.get(mesh),
        to = b.get(mesh);
      return [
        mesh,
        readonlyMap(
          [...new Set([...(from?.keys() ?? []), ...(to?.keys() ?? [])])].map((id) => {
            const x = from?.get(id) ?? zero,
              y = to?.get(id) ?? zero;
            return [
              id,
              Object.freeze({ x: interpolateNumber(x.x, y.x, weight), y: interpolateNumber(x.y, y.y, weight) }),
            ] as const;
          }),
        ),
      ] as const;
    }),
  );
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
