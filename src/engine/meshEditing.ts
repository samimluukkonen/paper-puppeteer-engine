import { replaceMeshGeometry } from './meshAttachments.js';
import { MESH_AREA_EPSILON, triangleSignedArea2 } from './meshGeometry.js';
import { normalizeBoneInfluences, MAX_BONE_INFLUENCES } from './meshSkinning.js';
import type { MeshAttachmentDefinition, MeshVertex, RigDefinition } from './types.js';

/** Unique indexed edges, in stable triangle order, shared by inspector and viewport. */
export function meshEdges(mesh: Pick<MeshAttachmentDefinition, 'triangles'>): [number, number][] {
  const edges = new Map<string, [number, number]>();
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = mesh.triangles[i + j]!,
        b = mesh.triangles[i + ((j + 1) % 3)]!;
      const pair: [number, number] = a < b ? [a, b] : [b, a];
      edges.set(pair.join(':'), pair);
    }
  }
  return [...edges.values()];
}

/** Split every adjacent triangle, retaining winding and interpolating only the new UV. */
export function subdivideMeshEdge(
  mesh: MeshAttachmentDefinition,
  a: number,
  b: number,
  rig: RigDefinition,
  rigidBoneId?: string,
): MeshAttachmentDefinition {
  if (!meshEdges(mesh).some(([x, y]) => (x === a && y === b) || (x === b && y === a)))
    throw new Error('Select an existing mesh edge.');
  const p = mesh.vertices[a]!,
    q = mesh.vertices[b]!;
  if (!!p.influences !== !!q.influences && !rigidBoneId)
    throw new Error('Assign explicit bone influences to both edge vertices before subdividing a partly weighted edge.');
  const combined = new Map<string, number>();
  const weights = (vertex: MeshVertex) =>
    vertex.influences ?? (rigidBoneId ? [{ boneId: rigidBoneId, weight: 1 }] : []);
  for (const influence of [...weights(p), ...weights(q)])
    combined.set(influence.boneId, (combined.get(influence.boneId) ?? 0) + influence.weight / 2);
  const influences = combined.size
    ? normalizeBoneInfluences(
        [...combined]
          .map(([boneId, weight]) => ({ boneId, weight }))
          .sort(
            (left, right) =>
              right.weight - left.weight || (left.boneId < right.boneId ? -1 : left.boneId > right.boneId ? 1 : 0),
          )
          .slice(0, MAX_BONE_INFLUENCES),
      )
    : undefined;
  let suffix = 1;
  while (mesh.vertices.some((v) => v.id === `vertex-${suffix}`)) suffix++;
  const vertices = [
    ...mesh.vertices,
    {
      id: `vertex-${suffix}`,
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2,
      u: (p.u + q.u) / 2,
      v: (p.v + q.v) / 2,
      ...(influences ? { influences } : {}),
    },
  ];
  const n = vertices.length - 1;
  const triangles: number[] = [];
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const t = mesh.triangles.slice(i, i + 3);
    const j = t.findIndex((x, k) => (x === a && t[(k + 1) % 3] === b) || (x === b && t[(k + 1) % 3] === a));
    if (j < 0) triangles.push(...t);
    else triangles.push(t[j]!, n, t[(j + 2) % 3]!, n, t[(j + 1) % 3]!, t[(j + 2) % 3]!);
  }
  return replaceMeshGeometry(mesh, { vertices, triangles }, rig);
}

/** Ear clipping only the removed vertex's connected triangle fan. Other geometry/UVs stay authored. */
export function deleteMeshVertex(
  mesh: MeshAttachmentDefinition,
  id: string,
  rig: RigDefinition,
): MeshAttachmentDefinition {
  const index = mesh.vertices.findIndex((v) => v.id === id);
  if (index < 0 || mesh.vertices.length <= 3) throw new Error('This vertex cannot be deleted.');
  const links = new Map<number, number>();
  const triangles: number[] = [];
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const t = mesh.triangles.slice(i, i + 3),
      j = t.indexOf(index);
    if (j < 0) triangles.push(...t);
    else {
      const a = t[(j + 1) % 3]!,
        b = t[(j + 2) % 3]!;
      if (links.has(a)) throw new Error('Cannot delete a vertex with a disconnected triangle fan.');
      links.set(a, b);
    }
  }
  const ends = new Set(links.values());
  const start = [...links.keys()].find((k) => !ends.has(k)) ?? links.keys().next().value;
  if (start === undefined) throw new Error('Vertex has no triangle fan.');
  const ring = [start];
  let next = links.get(start);
  const visited = new Set<number>([start]);
  while (next !== undefined && next !== start) {
    if (visited.has(next)) throw new Error('Cannot delete a vertex with an invalid triangle fan.');
    ring.push(next);
    visited.add(next);
    next = links.get(next);
  }
  if ([...links.keys()].some((k) => !visited.has(k)) || ring.length < 3)
    throw new Error('Keep corner vertices. Delete a subdivided edge or interior vertex instead.');
  const point = (i: number): MeshVertex => mesh.vertices[i]!;
  while (ring.length > 3) {
    const ear = ring.findIndex((b, j) => {
      const a = ring[(j + ring.length - 1) % ring.length]!,
        c = ring[(j + 1) % ring.length]!;
      if (triangleSignedArea2(point(a), point(b), point(c)) <= MESH_AREA_EPSILON) return false;
      return !ring.some(
        (p) =>
          p !== a &&
          p !== b &&
          p !== c &&
          triangleSignedArea2(point(a), point(b), point(p)) >= 0 &&
          triangleSignedArea2(point(b), point(c), point(p)) >= 0 &&
          triangleSignedArea2(point(c), point(a), point(p)) >= 0,
      );
    });
    if (ear < 0) throw new Error('Cannot safely triangulate this vertex cavity. Undo its move before deleting.');
    triangles.push(ring[(ear + ring.length - 1) % ring.length]!, ring[ear]!, ring[(ear + 1) % ring.length]!);
    ring.splice(ear, 1);
  }
  triangles.push(...ring);
  return replaceMeshGeometry(
    mesh,
    {
      vertices: mesh.vertices.filter((_, i) => i !== index),
      triangles: triangles.map((i) => (i > index ? i - 1 : i)),
    },
    rig,
  );
}
