import { MESH_AREA_EPSILON, triangleSignedArea2 } from './meshGeometry.js';
import type { MeshAttachmentDefinition } from './types.js';

export interface MeshTriangleDiagnostic {
  /** Zero-based authored triangle index. */
  readonly triangle: number;
  readonly kind: 'nonfinite' | 'collapsed' | 'inverted' | 'stretched';
}

/** Advisory inspection of a validated mesh's rendered attachment-local XYUV buffer.
 * Facing, Actor placement and camera transforms are deliberately excluded. A 3x edge
 * stretch or <=1% remaining area is a review hint, never a validation error or repair.
 * This is O(triangles) and runs only when explicitly requested by an editor/host.
 */
export function inspectMeshDeformation(
  mesh: Pick<MeshAttachmentDefinition, 'vertices' | 'triangles'>,
  xyuv: readonly number[],
): MeshTriangleDiagnostic[] {
  if (xyuv.length !== mesh.vertices.length * 4) throw new Error('Mesh diagnostic buffer size does not match vertices.');
  const issues: MeshTriangleDiagnostic[] = [];
  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const ids = mesh.triangles.slice(index, index + 3);
    const rest = ids.map((id) => mesh.vertices[id]!);
    const posed = ids.map((id) => ({ x: xyuv[id * 4]!, y: xyuv[id * 4 + 1]! }));
    const triangle = index / 3;
    if (posed.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      issues.push({ triangle, kind: 'nonfinite' });
      continue;
    }
    const restArea = triangleSignedArea2(rest[0]!, rest[1]!, rest[2]!);
    const area = triangleSignedArea2(posed[0]!, posed[1]!, posed[2]!);
    if (Math.abs(area) <= Math.max(MESH_AREA_EPSILON, Math.abs(restArea) * 0.01))
      issues.push({ triangle, kind: 'collapsed' });
    else if (area * restArea < 0) issues.push({ triangle, kind: 'inverted' });
    for (let edge = 0; edge < 3; edge++) {
      const a = rest[edge]!,
        b = rest[(edge + 1) % 3]!;
      const p = posed[edge]!,
        q = posed[(edge + 1) % 3]!;
      if (Math.hypot(q.x - p.x, q.y - p.y) > 3 * Math.hypot(b.x - a.x, b.y - a.y)) {
        issues.push({ triangle, kind: 'stretched' });
        break;
      }
    }
  }
  return issues;
}
