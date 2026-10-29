import { z } from 'zod';
import { canonicalJson } from './authoredSerialization.js';
import { freezeData } from './readonlyData.js';
import { Rig } from './Rig.js';
import { identifierSchema } from './schemas.js';
import { sourceDigest } from './sourceDigest.js';
import { createTransform, type RigDefinition } from './types.js';

/** Version-1 character manifests own one rig: use their stable character ID, never a display label. */
export interface IdentifiedRig {
  readonly id: string;
  readonly rig: RigDefinition;
}

const identity = z.string().min(1).max(200).regex(/\S/);
export const rigBoneMappingSchema = z.strictObject({
  version: z.literal(1),
  id: identity,
  name: identity,
  sourceRigId: identity,
  targetRigId: identity,
  sourceRevision: z.string().regex(/^rig-v1:[0-9a-f]{64}$/),
  targetRevision: z.string().regex(/^rig-v1:[0-9a-f]{64}$/),
  entries: z.array(z.strictObject({ sourceBoneId: identifierSchema, targetBoneId: identifierSchema })).max(4096),
});
export type RigBoneMapping = Readonly<Omit<z.infer<typeof rigBoneMappingSchema>, 'entries'>> & {
  readonly entries: readonly BoneMappingEntry[];
};
export interface BoneMappingEntry {
  readonly sourceBoneId: string;
  readonly targetBoneId: string;
}
export interface RigMappingIssue {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'information';
  readonly message: string;
  readonly sourceBoneId?: string;
  readonly targetBoneId?: string;
}
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Effective, data-only rest state. Includes IK, marker and mesh bindings; excludes runtime indexes and facing. */
export function rigCompatibilityRevision(input: RigDefinition): string {
  const rig = new Rig(input);
  const data = {
    root: rig.root,
    bones: rig.bones.map((bone) => ({ ...bone, ...createTransform(bone) })).sort(byId),
    slots: rig.slots.map((slot) => ({ ...slot, ...createTransform(slot) })).sort(byId),
    attachments: [...rig.attachments].sort(byId),
    skins: [...rig.skins].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    ik: rig.ik ?? [],
    footContactMarkers: [...(rig.footContactMarkers ?? [])].sort(byId),
  };
  return `rig-v1:${sourceDigest(canonicalJson(data))}`;
}

/** Captures revisions only. Call validateRigBoneMapping before accepting this proposal. */
export function createRigBoneMapping(
  source: IdentifiedRig,
  target: IdentifiedRig,
  entries: readonly BoneMappingEntry[],
  id: string,
  name: string,
): RigBoneMapping {
  return freezeData(
    rigBoneMappingSchema.parse({
      version: 1,
      id,
      name,
      sourceRigId: source.id,
      targetRigId: target.id,
      sourceRevision: rigCompatibilityRevision(source.rig),
      targetRevision: rigCompatibilityRevision(target.rig),
      entries,
    }),
  );
}

/** Stale maps remain serializable for repair, but cannot be approved or consumed as current maps. */
export function validateRigBoneMapping(
  source: IdentifiedRig,
  target: IdentifiedRig,
  input: RigBoneMapping,
): readonly RigMappingIssue[] {
  const parsed = rigBoneMappingSchema.safeParse(input);
  if (!parsed.success)
    return freezeData([{ code: 'invalid-mapping', severity: 'error', message: parsed.error.message }]);
  const mapping = parsed.data;
  const a = new Rig(source.rig),
    b = new Rig(target.rig);
  const issues: RigMappingIssue[] = [];
  const error = (code: string, message: string, entry?: BoneMappingEntry) =>
    issues.push({ code, severity: 'error', message, ...entry });
  if (mapping.sourceRigId !== source.id || mapping.targetRigId !== target.id)
    error('rig-identity', 'Mapping belongs to different source or target rig identities.');
  if (mapping.sourceRevision !== rigCompatibilityRevision(a) || mapping.targetRevision !== rigCompatibilityRevision(b))
    error('stale-mapping', 'Rig data changed. Review the current revisions and explicitly approve the mapping again.');
  const lookup = new Map<string, string>();
  const used = new Set<string>();
  for (const entry of mapping.entries) {
    if (!a.hasBone(entry.sourceBoneId) || !b.hasBone(entry.targetBoneId))
      error('missing-bone', `Unknown bone in mapping: ${entry.sourceBoneId} → ${entry.targetBoneId}.`, entry);
    if (lookup.has(entry.sourceBoneId))
      error('duplicate-source', `Source bone "${entry.sourceBoneId}" is assigned twice.`, entry);
    if (used.has(entry.targetBoneId))
      error('duplicate-target', `Target bone "${entry.targetBoneId}" is assigned twice.`, entry);
    lookup.set(entry.sourceBoneId, entry.targetBoneId);
    used.add(entry.targetBoneId);
  }
  if (lookup.get(a.root) !== b.root) error('root-mismatch', 'Map the source root to the target root.');
  for (const entry of mapping.entries) {
    if (!a.hasBone(entry.sourceBoneId) || !b.hasBone(entry.targetBoneId)) continue;
    const sourceParent = a.getBone(entry.sourceBoneId).parent;
    const targetParent = b.getBone(entry.targetBoneId).parent;
    if (sourceParent !== undefined && !lookup.has(sourceParent))
      error('unmapped-parent', `Map parent "${sourceParent}" before its child "${entry.sourceBoneId}".`, entry);
    else if ((sourceParent === undefined ? undefined : lookup.get(sourceParent)) !== targetParent)
      error(
        'parent-mismatch',
        `Parents differ for ${entry.sourceBoneId} → ${entry.targetBoneId}; inserted or collapsed chains are unsupported.`,
        entry,
      );
  }
  return freezeData(issues);
}
