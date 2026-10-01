import { rigDefinitionSchema } from './schemas.js';
import type {
  BoneDefinition,
  RigDefinition,
  SkinDefinition,
  SlotDefinition,
  SpriteAttachmentDefinition,
} from './types.js';

/** Resolve the logical joint offset using the parent's explicit length, when present. */
export function computeBonePosition(bone: BoneDefinition, parent?: BoneDefinition): { x: number; y: number } {
  const x = bone.x ?? 0;
  const y = bone.y ?? 0;
  const length = parent?.length;
  if (length === undefined) return { x, y };
  const distance = Math.hypot(x, y);
  return {
    x: distance > 0 ? (x / distance) * length : 0,
    y: distance > 0 ? (y / distance) * length : length,
  };
}

/** Calculate draw order for an already validated, parent-ordered skeleton. */
export function computeRenderOrder(root: string, bones: readonly BoneDefinition[]): string[] {
  const definitions = new Map(bones.map((bone) => [bone.id, bone]));
  const children = new Map<string, BoneDefinition[]>();
  for (const bone of bones) {
    if (bone.parent !== undefined) {
      const siblings = children.get(bone.parent) ?? [];
      siblings.push(bone);
      children.set(bone.parent, siblings);
    }
  }
  const renderOrder: string[] = [];
  const visit = (id: string): void => {
    const bone = definitions.get(id)!;
    const entries = [
      { id, depth: bone.sprite?.depth ?? 0, self: true },
      ...(children.get(id) ?? []).map((child) => ({ id: child.id, depth: child.depth ?? 0, self: false })),
    ].sort((left, right) => left.depth - right.depth);
    for (const entry of entries) {
      if (entry.self) renderOrder.push(entry.id);
      else visit(entry.id);
    }
  };
  visit(root);
  return renderOrder;
}

/** Validates a data-only rig and orders it so parents always precede children. */
export class Rig {
  readonly root: string;
  readonly bones: readonly BoneDefinition[];
  readonly renderOrder: readonly string[];
  readonly slots: readonly SlotDefinition[];
  readonly attachments: readonly SpriteAttachmentDefinition[];
  readonly skins: readonly SkinDefinition[];
  private readonly definitions = new Map<string, BoneDefinition>();

  constructor(definition: RigDefinition) {
    definition = rigDefinitionSchema.parse(definition);
    this.root = definition.root;
    for (const bone of definition.bones) {
      if (!bone.id || this.definitions.has(bone.id)) {
        throw new Error(`Empty or duplicate bone id: "${bone.id}".`);
      }
      this.definitions.set(
        bone.id,
        Object.freeze({
          ...bone,
          ...(bone.sprite ? { sprite: Object.freeze({ ...bone.sprite }) } : {}),
        }),
      );
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
      const parent = this.getBone(bone.parent);
      if (parent.length === undefined) continue;
      this.definitions.set(
        bone.id,
        Object.freeze({
          ...bone,
          ...computeBonePosition(bone, parent),
        }),
      );
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
    this.renderOrder = Object.freeze(computeRenderOrder(this.root, ordered));
    this.slots = Object.freeze((definition.slots ?? []).map((slot) => Object.freeze({ ...slot })));
    this.attachments = Object.freeze(
      (definition.attachments ?? []).map((attachment) => Object.freeze({ ...attachment })),
    );
    this.skins = Object.freeze(
      (definition.skins ?? []).map((skin) =>
        Object.freeze({
          ...skin,
          slots: Object.freeze({ ...skin.slots }),
        }),
      ),
    );
    const slotIds = new Set<string>();
    for (const slot of this.slots) {
      if (slotIds.has(slot.id)) throw new Error(`Duplicate slot id "${slot.id}".`);
      slotIds.add(slot.id);
      if (!this.hasBone(slot.bone)) throw new Error(`Slot "${slot.id}" references unknown bone "${slot.bone}".`);
    }
    const attachmentIds = new Set<string>();
    for (const attachment of this.attachments) {
      if (attachmentIds.has(attachment.id)) throw new Error(`Duplicate attachment id "${attachment.id}".`);
      attachmentIds.add(attachment.id);
    }
    const skinNames = new Set<string>();
    for (const skin of this.skins) {
      if (skinNames.has(skin.name)) throw new Error(`Duplicate skin name "${skin.name}".`);
      skinNames.add(skin.name);
      for (const [slot, attachment] of Object.entries(skin.slots)) {
        if (!slotIds.has(slot)) throw new Error(`Skin "${skin.name}" references unknown slot "${slot}".`);
        if (attachment !== null && !attachmentIds.has(attachment))
          throw new Error(`Skin "${skin.name}" references unknown attachment "${attachment}".`);
      }
    }
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
