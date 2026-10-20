import { normalizeBoneDirection } from './boneMath.js';
import type { TwoBoneIKDefinition } from './ik/types.js';
import { freezeData } from './readonlyData.js';
import type { DeepReadonly } from './readonlyData.js';
import { rigDefinitionSchema, skinDefinitionSchema } from './schemas.js';
import type {
  BoneDefinition,
  RigDefinition,
  SkinDefinition,
  SlotDefinition,
  SpriteAttachmentDefinition,
} from './types.js';
import { checkRigReferences, checkSkinReferences, throwValidationIssue } from './validation.js';

function ownSkins(skins: readonly SkinDefinition[]): DeepReadonly<readonly SkinDefinition[]> {
  return Object.freeze(skins.map((skin) => Object.freeze({ ...skin, slots: Object.freeze({ ...skin.slots }) })));
}

function skinOverrides(skins: readonly SkinDefinition[], rig: RigDefinition): DeepReadonly<readonly SkinDefinition[]> {
  const parsed = skinDefinitionSchema.array().parse(skins);
  checkSkinReferences(parsed, rig, throwValidationIssue);
  return ownSkins(parsed);
}

/** Resolve the logical joint offset using the parent's explicit length, when present. */
export function computeBonePosition(bone: BoneDefinition, parent?: BoneDefinition): { x: number; y: number } {
  const x = bone.x ?? 0;
  const y = bone.y ?? 0;
  const length = parent?.length;
  if (length === undefined) return { x, y };
  const direction = normalizeBoneDirection(x, y) ?? { x: 0, y: 1 };
  return {
    x: direction.x * length,
    y: direction.y * length,
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
  const pending = [{ id: root, self: false }];
  while (pending.length) {
    const { id, self } = pending.pop()!;
    if (self) {
      renderOrder.push(id);
      continue;
    }
    const bone = definitions.get(id)!;
    const entries = [
      { id, depth: bone.sprite?.depth ?? 0, self: true },
      ...(children.get(id) ?? []).map((child) => ({ id: child.id, depth: child.depth ?? 0, self: false })),
    ].sort((left, right) => left.depth - right.depth);
    // Reverse the stack insertion to retain stable sibling order and sprite depth placement.
    for (let index = entries.length - 1; index >= 0; index -= 1) pending.push(entries[index]!);
  }
  return renderOrder;
}

/** Validates a data-only rig and orders it so parents always precede children. */
export class Rig {
  declare readonly ik?: DeepReadonly<readonly TwoBoneIKDefinition[]>;
  readonly root: string;
  readonly bones: DeepReadonly<readonly BoneDefinition[]>;
  readonly renderOrder: readonly string[];
  readonly slots: DeepReadonly<readonly SlotDefinition[]>;
  readonly attachments: DeepReadonly<readonly SpriteAttachmentDefinition[]>;
  readonly skins: DeepReadonly<readonly SkinDefinition[]>;
  private readonly definitions: Map<string, DeepReadonly<BoneDefinition>>;
  private readonly slotDefinitions: Map<string, DeepReadonly<SlotDefinition>>;
  private readonly attachmentDefinitions: Map<string, DeepReadonly<SpriteAttachmentDefinition>>;

  /** Existing rigs share validated immutable skeleton data; optional skins are validated independently. */
  constructor(definition: RigDefinition, skins?: readonly SkinDefinition[]) {
    if (definition instanceof Rig) {
      if (definition.ik !== undefined) this.ik = definition.ik;
      this.root = definition.root;
      this.bones = definition.bones;
      this.renderOrder = definition.renderOrder;
      this.slots = definition.slots;
      this.attachments = definition.attachments;
      this.definitions = definition.definitions;
      this.slotDefinitions = definition.slotDefinitions;
      this.attachmentDefinitions = definition.attachmentDefinitions;
      this.skins = skins === undefined ? definition.skins : skinOverrides(skins, definition);
      return;
    }
    definition = rigDefinitionSchema.parse(definition);
    checkRigReferences(definition, throwValidationIssue);
    if (definition.ik !== undefined) this.ik = freezeData(definition.ik);
    this.root = definition.root;
    this.definitions = new Map();
    this.slotDefinitions = new Map();
    this.attachmentDefinitions = new Map();
    for (const bone of definition.bones) {
      this.definitions.set(
        bone.id,
        Object.freeze({
          ...bone,
          ...(bone.sprite ? { sprite: Object.freeze({ ...bone.sprite }) } : {}),
        }),
      );
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

    const ordered: DeepReadonly<BoneDefinition>[] = [];
    const visited = new Set<string>();
    for (const id of this.definitions.keys()) {
      const ancestors: DeepReadonly<BoneDefinition>[] = [];
      let bone: DeepReadonly<BoneDefinition> | undefined = this.getBone(id);
      while (bone && !visited.has(bone.id)) {
        ancestors.push(bone);
        bone = bone.parent === undefined ? undefined : this.getBone(bone.parent);
      }
      for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        const bone = ancestors[index]!;
        visited.add(bone.id);
        ordered.push(bone);
      }
    }
    this.bones = Object.freeze(ordered);
    this.renderOrder = Object.freeze(computeRenderOrder(this.root, ordered));
    this.slots = Object.freeze((definition.slots ?? []).map((slot) => Object.freeze({ ...slot })));
    this.attachments = Object.freeze((definition.attachments ?? []).map((attachment) => freezeData(attachment)));
    for (const slot of this.slots) this.slotDefinitions.set(slot.id, slot);
    for (const attachment of this.attachments) this.attachmentDefinitions.set(attachment.id, attachment);
    this.skins = skins === undefined ? ownSkins(definition.skins ?? []) : skinOverrides(skins, definition);
  }

  getBone(id: string): DeepReadonly<BoneDefinition> {
    const bone = this.definitions.get(id);
    if (!bone) throw new Error(`Unknown bone "${id}".`);
    return bone;
  }

  hasBone(id: string): boolean {
    return this.definitions.has(id);
  }

  getSlot(id: string): DeepReadonly<SlotDefinition> {
    const slot = this.slotDefinitions.get(id);
    if (!slot) throw new Error(`Unknown slot "${id}".`);
    return slot;
  }

  getAttachment(id: string): DeepReadonly<SpriteAttachmentDefinition> {
    const attachment = this.attachmentDefinitions.get(id);
    if (!attachment) throw new Error(`Unknown attachment "${id}".`);
    return attachment;
  }
}
