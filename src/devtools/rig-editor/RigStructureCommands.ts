import { createMeshBindPose } from '../../engine/meshBindPose.js';
import { normalizeBoneInfluences } from '../../engine/meshSkinning.js';
import { identifierSchema } from '../../engine/schemas.js';
import type { BoneDefinition, RigDefinition } from '../../engine/types.js';
import type { RigEditorState } from './RigEditorState.js';

type StructureState = Pick<
  RigEditorState,
  'workingCopy' | 'selection' | 'getBone' | 'getSlot' | 'childrenOf' | 'skins' | 'selectBone' | 'selectSlot'
>;

export interface RigStructureActions {
  install(candidate: RigDefinition, renamed?: { from: string; to: string }): void;
  hasBone(id: string): boolean;
  hasSlot(id: string): boolean;
  boneReferences(id: string): readonly string[];
}

/** Build hierarchy edits; the state owner validates and installs each candidate in its shared history. */
export class RigStructureCommands {
  constructor(
    private readonly state: StructureState,
    private readonly actions: RigStructureActions,
  ) {}

  createBone(id: string, parent: string): void {
    identifierSchema.parse(id);
    if (this.actions.hasBone(id)) throw new Error(`Duplicate bone ID "${id}".`);
    const rig = this.state.workingCopy;
    // New documents start with a single editable root; no character template is assumed.
    const bone: BoneDefinition = rig.bones.length
      ? { id, parent: this.state.getBone(parent).id, y: this.state.getBone(parent).length ?? 40 }
      : { id };
    this.actions.install({ ...rig, root: rig.bones.length ? rig.root : id, bones: [...rig.bones, bone] });
    this.state.selectBone(id);
  }

  /** Dependencies are reported before destructive changes; nothing is cascaded or silently removed. */
  boneDependencies(id: string): readonly string[] {
    const bone = this.state.getBone(id);
    const rig = this.state.workingCopy;
    return [
      ...this.state.childrenOf(id).map((child) => `child bone "${child}"`),
      ...(rig.slots ?? []).filter((slot) => slot.bone === id).map((slot) => `slot "${slot.id}"`),
      ...(rig.ik ?? [])
        .filter((chain) => [chain.rootBone, chain.middleBone, chain.endBone].includes(id))
        .map((chain) => `IK constraint "${chain.name}"`),
      ...(rig.footContactMarkers ?? [])
        .filter((marker) => marker.boneId === id)
        .map((marker) => `foot contact marker "${marker.id}"`),
      ...(bone.sprite ? ['bone artwork'] : []),
      ...(rig.attachments ?? [])
        .filter((entry) => entry.type === 'mesh' && entry.bindPose.bones.some((bone) => bone.id === id))
        .map((entry) => `mesh "${entry.id}" weights or bind hierarchy (use Reassign mesh weights and remove bone)`),
      ...this.actions.boneReferences(id),
    ];
  }

  /** Explicit atomic removal: redirect only references to this bone and recapture all mesh rest snapshots. */
  removeBoneAndReassignMeshes(id: string, replacement: string): void {
    this.state.getBone(replacement);
    if (id === replacement) throw new Error('Choose a different replacement bone.');
    const rig = this.state.workingCopy;
    if (id === rig.root) throw new Error('The root bone cannot be removed.');
    const references = this.boneDependencies(id).filter((reference) => !reference.startsWith('mesh "'));
    if (references.length) throw new Error(`Resolve these dependencies first: ${references.join(', ')}.`);
    const candidate: RigDefinition = { ...rig, bones: rig.bones.filter((bone) => bone.id !== id) };
    candidate.attachments = (rig.attachments ?? []).map((attachment) => {
      if (attachment.type !== 'mesh') return attachment;
      const vertices = attachment.vertices.map((vertex) => {
        if (!vertex.influences?.some((influence) => influence.boneId === id)) return vertex;
        const weights = new Map<string, number>();
        for (const influence of vertex.influences) {
          const boneId = influence.boneId === id ? replacement : influence.boneId;
          weights.set(boneId, (weights.get(boneId) ?? 0) + influence.weight);
        }
        return {
          ...vertex,
          influences: normalizeBoneInfluences([...weights].map(([boneId, weight]) => ({ boneId, weight }))),
        };
      });
      return { ...attachment, vertices, bindPose: createMeshBindPose(candidate, attachment) };
    });
    this.actions.install(candidate);
    this.state.selectBone(replacement);
  }

  removeBone(id: string): void {
    const references = this.boneDependencies(id);
    const rig = this.state.workingCopy;
    if (id === rig.root)
      throw new Error('The rig requires a root bone. Rename it or remove its children individually.');
    if (references.length)
      throw new Error(
        `Bone "${id}" is used by ${references.join(', ')}. Reparent children and remove dependent references first.`,
      );
    this.actions.install({ ...rig, bones: rig.bones.filter((bone) => bone.id !== id) });
  }

  renameBone(id: string, next: string): void {
    this.state.getBone(id);
    identifierSchema.parse(next);
    if (id === next) return;
    if (this.actions.hasBone(next)) throw new Error(`Duplicate bone ID "${next}".`);
    // Stable animation and host IK references cannot be rewritten by the rig document.
    const references = this.boneDependencies(id).filter(
      (value) => !value.startsWith('child bone ') && !value.startsWith('slot '),
    );
    if (references.length)
      throw new Error(`Bone "${id}" is used by ${references.join(', ')}. Remove these references before renaming.`);
    const rig = this.state.workingCopy;
    this.actions.install(
      {
        ...rig,
        root: rig.root === id ? next : rig.root,
        bones: rig.bones.map((bone) => ({
          ...bone,
          id: bone.id === id ? next : bone.id,
          ...(bone.parent === id ? { parent: next } : {}),
        })),
        slots: (rig.slots ?? []).map((slot) => (slot.bone === id ? { ...slot, bone: next } : slot)),
      },
      { from: id, to: next },
    );
    this.state.selection = { type: 'bone', id: next };
  }

  /** Local transforms are retained; the hierarchy change is visible immediately in bind preview. */
  reparentBone(id: string, parent: string): void {
    const bone = this.state.getBone(id);
    this.state.getBone(parent);
    const rig = this.state.workingCopy;
    if (id === rig.root) throw new Error('The root bone cannot have a parent.');
    if (bone.parent === parent) return;
    this.actions.install({
      ...rig,
      bones: rig.bones.map((entry) => (entry.id === id ? { ...entry, parent } : entry)),
    });
  }

  createSlot(id: string, bone: string): void {
    identifierSchema.parse(id);
    this.state.getBone(bone);
    if (this.actions.hasSlot(id)) throw new Error(`Duplicate slot ID "${id}".`);
    const rig = this.state.workingCopy;
    this.actions.install({ ...rig, slots: [...(rig.slots ?? []), { id, bone }] });
    this.state.selectSlot(id);
  }

  removeSlot(id: string): void {
    this.state.getSlot(id);
    const references = this.state.skins
      .filter((skin) => Object.hasOwn(skin.slots, id))
      .map((skin) => `skin "${skin.name}"`);
    if (references.length)
      throw new Error(`Slot "${id}" is used by ${references.join(', ')}. Remove these overrides first.`);
    const rig = this.state.workingCopy;
    this.actions.install({ ...rig, slots: rig.slots!.filter((slot) => slot.id !== id) });
  }
}
