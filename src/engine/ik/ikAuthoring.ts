import { type Affine, composeAffine, localToWorld, transformToAffine } from '../affineMath.js';
import type { AnimationClip } from '../AnimationClip.js';
import type { DeepReadonly } from '../readonlyData.js';
import { Rig } from '../Rig.js';
import { twoBoneIKDefinitionSchema } from '../schemas.js';
import { createTransform, type JointTransform, type RigDefinition } from '../types.js';
import type { TwoBoneIKDefinition } from './types.js';

export type CreateIKConstraintOptions = TwoBoneIKDefinition;
/** Identity is deliberately excluded. Renaming requires a cross-document migration. */
export type IKConstraintPatch = Partial<Omit<TwoBoneIKDefinition, 'name'>>;
export interface IKConstraintDependencies {
  readonly animations?: readonly AnimationClip[];
  /** Live host references, including foot planting, weapon grips and target providers. */
  readonly references?: (id: string) => readonly string[];
}

export function getIKConstraint(rig: RigDefinition, id: string): DeepReadonly<TwoBoneIKDefinition> {
  const constraint = rig.ik?.find((entry) => entry.name === id);
  if (!constraint) throw new Error(`Unknown IK constraint "${id}".`);
  return constraint;
}

export function ikConstraintDependencies(
  rig: RigDefinition,
  id: string,
  dependencies: IKConstraintDependencies = {},
): readonly string[] {
  getIKConstraint(rig, id);
  return [
    ...(dependencies.animations ?? []).flatMap((clip) => [
      ...(clip.ikTracks && Object.hasOwn(clip.ikTracks, id) ? [`animation "${clip.name}" IK track`] : []),
      ...(clip.disabledIKConstraints?.includes(id) ? [`animation "${clip.name}" baked IK metadata`] : []),
    ]),
    ...(dependencies.references?.(id) ?? []),
  ];
}

function assertUnused(rig: RigDefinition, id: string, dependencies: IKConstraintDependencies): void {
  const references = ikConstraintDependencies(rig, id, dependencies);
  if (references.length)
    throw new Error(
      `IK constraint "${id}" is used by ${references.join(', ')}. Resolve these dependencies explicitly before deleting or changing its chain.`,
    );
}

function ikChainChanged(previous: Readonly<TwoBoneIKDefinition>, next: Readonly<TwoBoneIKDefinition>): boolean {
  return (
    next.rootBone !== previous.rootBone ||
    next.middleBone !== previous.middleBone ||
    next.endBone !== previous.endBone ||
    (next.endOffset?.x ?? 0) !== (previous.endOffset?.x ?? 0) ||
    (next.endOffset?.y ?? 0) !== (previous.endOffset?.y ?? 0)
  );
}

/** @internal Used for history, recovery and reset as well as direct authoring commands. */
export function assertIKConstraintChangesAllowed(
  rig: RigDefinition,
  candidate: RigDefinition,
  dependencies: IKConstraintDependencies,
): void {
  const nextById = new Map((candidate.ik ?? []).map((entry) => [entry.name, entry]));
  for (const previous of rig.ik ?? []) {
    const next = nextById.get(previous.name);
    if (!next || ikChainChanged(previous, next)) assertUnused(rig, previous.name, dependencies);
  }
}

/** Immutable authoring in the existing rig format. Optional pose contains bone-local transforms,
 * before camera, facing or puppet placement. Omitted bones use the current rig's bind transforms.
 */
export function createIKConstraint(
  rig: RigDefinition,
  options: CreateIKConstraintOptions,
  pose?: ReadonlyMap<string, Readonly<JointTransform>>,
): RigDefinition {
  if (rig.ik?.some((entry) => entry.name === options.name))
    throw new Error(`Duplicate IK constraint name "${options.name}".`);
  const definition = twoBoneIKDefinitionSchema.strict().parse(options);
  const candidate = { ...rig, ik: [...(rig.ik ?? []), definition] };
  const validated = new Rig(candidate);
  const middle = pose?.get(definition.middleBone) ?? createTransform(validated.getBone(definition.middleBone));
  const end = pose?.get(definition.endBone) ?? createTransform(validated.getBone(definition.endBone));
  if (definition.bendDirection === undefined) {
    const endpoint = localToWorld(
      localToWorld(definition.endOffset ?? { x: 0, y: 0 }, transformToAffine(end, {} as Affine)),
      transformToAffine(middle, {} as Affine),
    );
    const turn = middle.x * (endpoint.y - middle.y) - middle.y * (endpoint.x - middle.x);
    definition.bendDirection = turn < 0 ? -1 : 1;
  }
  if (!definition.target) {
    const matrices = new Map<string, Affine>();
    for (const bone of validated.bones) {
      const local = transformToAffine(pose?.get(bone.id) ?? createTransform(bone), {} as Affine);
      matrices.set(bone.id, composeAffine(local, bone.parent ? matrices.get(bone.parent) : undefined, {} as Affine));
    }
    definition.target = localToWorld(definition.endOffset ?? { x: 0, y: 0 }, matrices.get(definition.endBone)!);
  }
  // Check computed coordinates too: finite local numbers can overflow when composed.
  new Rig(candidate);
  return candidate;
}

export function updateIKConstraint(
  rig: RigDefinition,
  id: string,
  patch: IKConstraintPatch,
  dependencies: IKConstraintDependencies = {},
): RigDefinition {
  const previous = getIKConstraint(rig, id);
  // Strict parsing rejects attempts to smuggle an identity change or unsupported settings.
  const values = twoBoneIKDefinitionSchema.omit({ name: true }).partial().strict().parse(patch);
  const next = twoBoneIKDefinitionSchema.parse({ ...previous, ...values });
  if (ikChainChanged(previous, next)) assertUnused(rig, id, dependencies);
  const candidate = { ...rig, ik: rig.ik!.map((entry) => (entry.name === id ? next : entry)) };
  new Rig(candidate);
  return candidate;
}

export function removeIKConstraint(
  rig: RigDefinition,
  id: string,
  dependencies: IKConstraintDependencies = {},
): RigDefinition {
  assertUnused(rig, id, dependencies);
  const candidate = { ...rig, ik: rig.ik!.filter((entry) => entry.name !== id) };
  new Rig(candidate);
  return candidate;
}
