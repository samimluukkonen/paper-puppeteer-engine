import { assertFinite, createTransform, transformProperties } from './types.js';
import type { BoneDefinition, RigDefinition } from './types.js';

/** Validates a data-only rig and orders it so parents always precede children. */
export class Rig {
  readonly root: string;
  readonly bones: readonly BoneDefinition[];
  readonly renderOrder: readonly string[];
  private readonly definitions = new Map<string, BoneDefinition>();

  constructor(definition: RigDefinition) {
    this.root = definition.root;
    if (!this.root) throw new Error('A rig needs a root id.');
    for (const bone of definition.bones) {
      if (!bone.id || this.definitions.has(bone.id)) {
        throw new Error(`Empty or duplicate bone id: "${bone.id}".`);
      }
      for (const property of transformProperties) {
        assertFinite(createTransform(bone)[property], `${bone.id}.${property}`);
      }
      assertFinite(bone.depth ?? 0, `${bone.id}.depth`);
      if (bone.length !== undefined) {
        assertFinite(bone.length, `${bone.id}.length`);
        if (bone.length < 0) throw new Error(`${bone.id}.length cannot be negative.`);
      }
      if (bone.sprite) {
        if (!bone.sprite.texture) throw new Error(`Bone "${bone.id}" needs a texture key.`);
        for (const [property, value] of Object.entries(bone.sprite)) {
          if (typeof value === 'number') assertFinite(value, `${bone.id}.sprite.${property}`);
        }
        for (const property of ['originX', 'originY'] as const) {
          const origin = bone.sprite[property] ?? 0.5;
          if (origin < 0 || origin > 1) {
            throw new Error(`${bone.id}.sprite.${property} must be between 0 and 1.`);
          }
        }
      }
      this.definitions.set(bone.id, Object.freeze({
        ...bone,
        ...(bone.sprite ? { sprite: Object.freeze({ ...bone.sprite }) } : {}),
      }));
    }
    const root = this.getBone(this.root);
    if (root.parent !== undefined) throw new Error('The root bone cannot have a parent.');
    for (const bone of this.definitions.values()) {
      if (bone.id !== this.root && bone.parent === undefined) {
        throw new Error(`Bone "${bone.id}" needs a parent.`);
      }
      if (bone.parent !== undefined && !this.definitions.has(bone.parent)) {
        throw new Error(`Unknown parent "${bone.parent}" of bone "${bone.id}".`);
      }
    }

    // Explicit lengths define the logical skeleton, rather than asking IK to
    // solve lengths that disagree with the rendered child joint positions.
    for (const bone of this.definitions.values()) {
      if (bone.parent === undefined) continue;
      const length = this.getBone(bone.parent).length;
      if (length === undefined) continue;
      const x = bone.x ?? 0;
      const y = bone.y ?? 0;
      const distance = Math.hypot(x, y);
      this.definitions.set(bone.id, Object.freeze({
        ...bone,
        x: distance > 0 ? x / distance * length : 0,
        y: distance > 0 ? y / distance * length : length,
      }));
    }

    const ordered: BoneDefinition[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Rig contains a cycle at "${id}".`);
      visiting.add(id);
      const bone = this.getBone(id);
      if (bone.parent !== undefined) visit(bone.parent);
      visiting.delete(id);
      visited.add(id);
      ordered.push(bone);
    };
    for (const id of this.definitions.keys()) visit(id);
    this.bones = Object.freeze(ordered);
    const children = new Map<string, BoneDefinition[]>();
    for (const bone of ordered) {
      if (bone.parent !== undefined) {
        const siblings = children.get(bone.parent) ?? [];
        siblings.push(bone);
        children.set(bone.parent, siblings);
      }
    }
    const renderOrder: string[] = [];
    const visitRenderOrder = (id: string): void => {
      const bone = this.getBone(id);
      const entries = [
        { id, depth: bone.sprite?.depth ?? 0, self: true },
        ...(children.get(id) ?? []).map(child => ({ id: child.id, depth: child.depth ?? 0, self: false })),
      ].sort((left, right) => left.depth - right.depth);
      for (const entry of entries) {
        if (entry.self) renderOrder.push(entry.id);
        else visitRenderOrder(entry.id);
      }
    };
    visitRenderOrder(this.root);
    this.renderOrder = Object.freeze(renderOrder);
  }

  getBone(id: string): BoneDefinition {
    const bone = this.definitions.get(id);
    if (!bone) throw new Error(`Unknown bone "${id}".`);
    return bone;
  }

  hasBone(id: string): boolean {
    return this.definitions.has(id);
  }
}
