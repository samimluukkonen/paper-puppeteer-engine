import type { Point } from './affineMath.js';
import { normalizeBoneInfluences, MAX_BONE_INFLUENCES } from './meshSkinning.js';
import type { BoneInfluence, MeshAttachmentDefinition } from './types.js';

const strongestFirst = (a: BoneInfluence, b: BoneInfluence) =>
  b.weight - a.weight || (a.boneId < b.boneId ? -1 : a.boneId > b.boneId ? 1 : 0);

export function assertInfluenceLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BONE_INFLUENCES)
    throw new Error('Choose one to four influences per edited vertex.');
}

/** Keep the edited bone, retain the strongest other bones (ID breaks ties), then preserve their ratios.
 * The caller supplies a valid fallback different from the edited bone whenever possible.
 * A one-bone rig cannot erase its sole influence; at limit 1 any positive edit selects that bone exclusively.
 */
export function setBoneWeight(
  influences: readonly BoneInfluence[],
  boneId: string,
  weight: number,
  fallbackBoneId: string,
  limit = MAX_BONE_INFLUENCES,
): BoneInfluence[] {
  assertInfluenceLimit(limit);
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error('Weight must be between 0 and 1.');
  if (weight === 1 || (limit === 1 && weight > 0)) return [{ boneId, weight: 1 }];
  const others = influences.filter((entry) => entry.boneId !== boneId && entry.weight > 0).sort(strongestFirst);
  const retained = others.slice(0, limit - (weight > 0 ? 1 : 0));
  if (!retained.length) {
    if (fallbackBoneId === boneId) return [{ boneId, weight: 1 }];
    retained.push({ boneId: fallbackBoneId, weight: 1 });
  }
  const normalized = normalizeBoneInfluences(retained);
  return [
    ...(weight > 0 ? [{ boneId, weight }] : []),
    ...normalized.map((entry) => ({ ...entry, weight: entry.weight * (1 - weight) })),
  ];
}

/** Zero is neutral gray; weak blue -> strong orange. Selected handles use a separate gold outline. */
export function boneWeightColor(weight: number): number {
  if (weight <= 0) return 0x9198a1;
  const t = Math.max(0, Math.min(1, weight));
  const r = Math.round(64 + 191 * t),
    g = Math.round(160 - 64 * t),
    b = Math.round(255 - 207 * t);
  return (r << 16) | (g << 8) | b;
}

export interface WeightBrushOptions {
  boneId: string;
  rigidBoneId: string;
  fallbackBoneId: string;
  radius: number;
  strength: number;
  erase: boolean;
  limit: number;
}

/** Screen-space segment distance gives continuous coverage even between sparse pointer events. */
function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

/** Each stroke samples a frozen evaluated vertex projection and its initial weights.
 * Maximum linear falloff over the swept path controls the additive change once per vertex;
 * stationary/repeated events do not accumulate pressure or make painting frame-rate dependent.
 */
export class MeshWeightStroke {
  private readonly coverage: number[];
  private readonly points: readonly Point[];
  private previous: Point;
  readonly options: WeightBrushOptions;
  constructor(
    readonly mesh: MeshAttachmentDefinition,
    points: readonly Point[],
    start: Point,
    options: WeightBrushOptions,
  ) {
    assertInfluenceLimit(options.limit);
    if (
      !Number.isFinite(options.radius) ||
      options.radius <= 0 ||
      !Number.isFinite(options.strength) ||
      options.strength < 0 ||
      options.strength > 1
    )
      throw new Error('Use a positive brush radius and strength between 0 and 1.');
    if (
      points.length !== mesh.vertices.length ||
      [...points, start].some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
    )
      throw new Error('The brush needs one finite projected point per mesh vertex.');
    this.options = { ...options };
    this.points = points.map((point) => ({ ...point }));
    this.previous = { ...start };
    this.coverage = points.map(() => 0);
  }

  sample(point: Point): { mesh: MeshAttachmentDefinition; changed: number; dropped: number } {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid brush position.');
    const { boneId, rigidBoneId, fallbackBoneId, radius, strength, erase, limit } = this.options;
    let changed = 0,
      dropped = 0;
    const vertices = this.mesh.vertices.map((vertex, index) => {
      this.coverage[index] = Math.max(
        this.coverage[index]!,
        1 - segmentDistance(this.points[index]!, this.previous, point) / radius,
      );
      const amount = this.coverage[index] * strength;
      if (amount <= 0) return vertex;
      const original = vertex.influences ?? [{ boneId: rigidBoneId, weight: 1 }];
      const before = original.find((entry) => entry.boneId === boneId)?.weight ?? 0;
      const weight = Math.max(0, Math.min(1, before + (erase ? -amount : amount)));
      if (weight === before) return vertex;
      const influences = setBoneWeight(original, boneId, weight, fallbackBoneId, limit);
      if (
        original.length === influences.length &&
        original.every((entry) =>
          influences.some((next) => next.boneId === entry.boneId && next.weight === entry.weight),
        )
      )
        return vertex;
      dropped += original.filter(
        (entry) =>
          entry.weight > 0 && entry.boneId !== boneId && !influences.some((next) => next.boneId === entry.boneId),
      ).length;
      changed++;
      return { ...vertex, influences };
    });
    this.previous = { ...point };
    return { mesh: { ...this.mesh, vertices }, changed, dropped };
  }
}
