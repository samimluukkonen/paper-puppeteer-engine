import type Phaser from 'phaser';
import { inspectMeshDeformation } from '../../engine/meshDiagnostics.js';
import type { Puppet } from '../../engine/Puppet.js';
import type { MeshAttachmentDefinition } from '../../engine/types.js';

function isVisible(object: Phaser.GameObjects.Mesh2D): boolean {
  let branch: Phaser.GameObjects.Mesh2D | Phaser.GameObjects.Container | null = object;
  while (branch) {
    if (!branch.visible) return false;
    branch = branch.parentContainer;
  }
  return true;
}

/** Read-only view of actual final FK/IK geometry. Owns only one optional Graphics object. */
export class MeshDiagnosticsOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics;
  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(10000);
  }

  render(puppet: Puppet, mesh: MeshAttachmentDefinition | undefined, slotId?: string): string {
    const g = this.graphics;
    g.clear();
    if (!puppet.container.visible) return 'Character preview hidden.';
    let found = false;
    const messages: string[] = [];
    for (const slot of puppet.rig.slots) {
      if (slotId && slot.id !== slotId) continue;
      const object = puppet.getSlotMesh(slot.id);
      // A selected attachment may be absent from the active skin. Never inspect another mesh.
      if (!object || mesh?.type !== 'mesh' || puppet.getAttachment(slot.id) !== mesh.id || !isVisible(object)) continue;
      found = true;
      const issues = inspectMeshDeformation(mesh, object.vertices);
      const kinds = new Map<number, string[]>();
      for (const issue of issues) {
        const list = kinds.get(issue.triangle) ?? [];
        list.push(issue.kind);
        kinds.set(issue.triangle, list);
      }
      const matrix = object.getWorldTransformMatrix();
      const points = mesh.vertices.map((_, index) =>
        matrix.transformPoint(object.vertices[index * 4]!, object.vertices[index * 4 + 1]!),
      );
      const camera = g.scene.cameras.main;
      for (let index = 0; index < mesh.triangles.length; index += 3) {
        const triangleIssues = kinds.get(index / 3) ?? [];
        const color = triangleIssues.some((kind) => kind !== 'stretched')
          ? 0xf85149
          : triangleIssues.length
            ? 0xffdc72
            : 0x40d9ed;
        const [a, b, c] = mesh.triangles.slice(index, index + 3).map((id) => points[id]!);
        if (![a!, b!, c!].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) continue;
        g.lineStyle((triangleIssues.length ? 2 : 1) / camera.zoom, color, 0.95).strokeTriangle(
          a!.x,
          a!.y,
          b!.x,
          b!.y,
          c!.x,
          c!.y,
        );
      }
      for (const point of points)
        if (Number.isFinite(point.x) && Number.isFinite(point.y))
          g.fillStyle(0x40d9ed, 1).fillRect(
            point.x - 2 / camera.zoom,
            point.y - 2 / camera.zoom,
            4 / camera.zoom,
            4 / camera.zoom,
          );
      const bones = [
        ...new Set(
          mesh.vertices.flatMap((vertex) =>
            (vertex.influences ?? [{ boneId: slot.bone }]).map((entry) => entry.boneId),
          ),
        ),
      ];
      const counts = new Map<string, number>();
      for (const issue of issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
      messages.push(
        `${slot.id}: ${issues.length ? [...counts].map(([kind, count]) => `${count} ${kind}`).join(', ') : 'No collapse, inversion or >3× edge stretch detected'}. Bones: ${bones.join(', ')}.`,
      );
    }
    return found
      ? `${messages.join(' ')} Cyan: regular; yellow: stretched; red: collapsed/inverted/nonfinite. Review hints only; no repair applied.`
      : 'Select a mesh and a skin displaying it to inspect final deformation.';
  }

  clear(): void {
    this.graphics.clear();
  }
  destroy(): void {
    this.graphics.destroy();
  }
}
