import type { Point } from './affineMath.js';
import type { MeshAttachmentDefinition, MeshVertex } from './types.js';
import type { ValidationIssue } from './validation.js';

/** Bounded authored topology; area tolerance is twice triangle area in local units squared. */
export const MESH_LIMITS = Object.freeze({ vertices: 1024, triangles: 2048, coordinate: 1_000_000 });
export const MESH_AREA_EPSILON = 1e-8;

/** @internal Package imports resolve the authored image dimensions against the actual binary header. */
export function assertMeshImageSize(
  mesh: Pick<MeshAttachmentDefinition, 'id' | 'imageSize'>,
  image: { width: number; height: number },
): void {
  if (mesh.imageSize.width !== image.width || mesh.imageSize.height !== image.height)
    throw new Error(
      `Mesh "${mesh.id}" image dimensions do not match its authored imageSize. Recreate the mesh before resizing artwork.`,
    );
}

export function triangleSignedArea2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function getMeshVertex(mesh: Pick<MeshAttachmentDefinition, 'vertices'>, id: string): MeshVertex | undefined {
  return mesh.vertices.find((vertex) => vertex.id === id);
}

export function meshBounds(mesh: Pick<MeshAttachmentDefinition, 'vertices'>) {
  if (!mesh.vertices.length) return undefined;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const vertex of mesh.vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function requireImageSize(width: number, height: number): void {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Image dimensions must be finite and positive.');
}

/** Image pixels and normalized UVs both start at the top left, with Y increasing down. */
export function imagePixelToUV(point: Point, width: number, height: number): { u: number; v: number } {
  requireImageSize(width, height);
  return { u: point.x / width, v: point.y / height };
}

export function uvToImagePixel(uv: { u: number; v: number }, width: number, height: number): Point {
  requireImageSize(width, height);
  return { x: uv.u * width, y: uv.v * height };
}

export function imagePixelToAttachmentLocal(
  point: Point,
  width: number,
  height: number,
  originX = 0.5,
  originY = 0.5,
): Point {
  requireImageSize(width, height);
  return { x: point.x - originX * width, y: point.y - originY * height };
}

export function attachmentLocalToImagePixel(
  point: Point,
  width: number,
  height: number,
  originX = 0.5,
  originY = 0.5,
): Point {
  requireImageSize(width, height);
  return { x: point.x + originX * width, y: point.y + originY * height };
}

/** Clip a clockwise (Y-down) triangle against another; shared edges have zero intersection area. */
function intersectionArea2(subject: readonly Point[], clip: readonly Point[]): number {
  let polygon = [...subject];
  for (let edge = 0; edge < 3 && polygon.length; edge += 1) {
    const a = clip[edge]!,
      b = clip[(edge + 1) % 3]!;
    const output: Point[] = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const p = polygon[index]!,
        q = polygon[(index + 1) % polygon.length]!;
      const dp = triangleSignedArea2(a, b, p),
        dq = triangleSignedArea2(a, b, q);
      if (dp >= 0) output.push(p);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        output.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
    polygon = output;
  }
  // Fan areas avoid catastrophic cancellation for small triangles far from the origin.
  let area = 0;
  for (let index = 1; index + 1 < polygon.length; index += 1)
    area += triangleSignedArea2(polygon[0]!, polygon[index]!, polygon[index + 1]!);
  return area;
}

/** Semantic topology checks after scalar/schema validation. No repair, reordering or silent dropping. */
export function validateMeshTopology(
  mesh: Pick<MeshAttachmentDefinition, 'vertices' | 'triangles'>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report = (path: string, message: string) => issues.push({ severity: 'error', path, message });
  if (mesh.vertices.length < 3 || mesh.vertices.length > MESH_LIMITS.vertices)
    report('vertices', `Mesh needs 3–${MESH_LIMITS.vertices} vertices.`);
  if (!mesh.triangles.length || mesh.triangles.length % 3 || mesh.triangles.length > MESH_LIMITS.triangles * 3)
    report('triangles', `Mesh needs complete triples, at most ${MESH_LIMITS.triangles} triangles.`);
  const ids = new Set<string>();
  for (const [index, vertex] of mesh.vertices.entries()) {
    if (!vertex.id || vertex.id === '__proto__' || ids.has(vertex.id))
      report(`vertices[${index}].id`, `Empty, reserved or duplicate vertex id "${vertex.id}".`);
    ids.add(vertex.id);
    for (const field of ['x', 'y'] as const)
      if (!Number.isFinite(vertex[field]) || Math.abs(vertex[field]) > MESH_LIMITS.coordinate)
        report(`vertices[${index}].${field}`, 'Mesh positions must be finite and within supported coordinate limits.');
    for (const field of ['u', 'v'] as const)
      if (!Number.isFinite(vertex[field]) || vertex[field] < 0 || vertex[field] > 1)
        report(`vertices[${index}].${field}`, 'Mesh UVs must be finite and between 0 and 1.');
  }
  for (const [index, vertex] of mesh.triangles.entries())
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= mesh.vertices.length)
      report(`triangles[${index}]`, `Triangle references missing vertex index ${vertex}.`);
  if (issues.length) return issues;
  const triangles = [];
  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const points = mesh.triangles.slice(index, index + 3).map((vertex) => mesh.vertices[vertex]!);
    const area = triangleSignedArea2(points[0]!, points[1]!, points[2]!);
    if (area <= MESH_AREA_EPSILON)
      report(`triangles[${index}]`, 'Triangle must be nondegenerate and clockwise in Y-down attachment space.');
    triangles.push({ index, points, ...meshBounds({ vertices: points })! });
  }
  if (issues.length) return issues;
  triangles.sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < triangles.length; i += 1) {
    const a = triangles[i]!;
    for (let j = i + 1; j < triangles.length; j += 1) {
      const b = triangles[j]!;
      if (b.minX >= a.maxX) break;
      if (b.minY >= a.maxY || b.maxY <= a.minY) continue;
      if (intersectionArea2(a.points, b.points) > MESH_AREA_EPSILON) {
        report(
          `triangles[${b.index}]`,
          `Triangle overlaps triangle ${a.index / 3}. Overlapping interiors are unsupported.`,
        );
        return issues;
      }
    }
  }
  return issues;
}
