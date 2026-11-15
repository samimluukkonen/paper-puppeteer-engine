import { z } from 'zod';
import {
  normalizeBoneDirection,
  checkJson,
  inspectRigDefinition,
  JsonWorkloadBudget,
  skinFileSchema,
  checkSkinReferences,
  type RigJsonDefinition,
  type ValidationIssue,
} from '../../engine/core.js';
import type { Rig, RigDefinition, SkinDefinition } from '../../engine/data.js';
import { equalEditorData, freezeData, type ReadonlyEditorData } from '../shared/editorData.js';

export type AuthoredRigData = RigDefinition & { name?: string };

export type RigEditorRecoverySnapshot = ReadonlyEditorData<{
  rig: AuthoredRigData;
  directions: [string, { x: number; y: number }][];
  standaloneSkins?: readonly SkinDefinition[];
}>;
const recoveryDraftSchema = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  rig: z.unknown(),
  directions: z.array(z.tuple([z.string(), z.strictObject({ x: z.number(), y: z.number() })])),
  standaloneSkins: skinFileSchema.array().optional(),
});

/** Parse compatible legacy/current drafts without changing editor state or input data. */
export function inspectRigDraft(
  input: unknown,
  initial: ReadonlyEditorData<RigDefinition>,
  _rig: Rig,
  standaloneSkins: readonly SkinDefinition[] = [],
  defaultSkin = '',
  compatible: ReadonlyEditorData<RigDefinition> = initial,
): RigEditorRecoverySnapshot | undefined {
  const issues: ValidationIssue[] = [];
  if (!checkJson(input, '', issues) || issues.length) return undefined;
  const recovery = recoveryDraftSchema.safeParse(input);
  // Earlier browser drafts stored only the rig file; they remain recoverable.
  const candidate = recovery.success ? recovery.data.rig : input;
  try {
    new JsonWorkloadBudget().checkRig(candidate);
  } catch {
    return undefined;
  }
  const { data } = inspectRigDefinition(candidate);
  if (!data) return undefined;
  // The runtime parser strips file metadata; retain the validated authored name in document snapshots.
  const { name } = candidate as RigJsonDefinition;
  // Version 2 envelopes explicitly support structural editing. Raw imports retain workspace compatibility.
  if (
    !(recovery.success && recovery.data.version === 2) &&
    (data.root !== compatible.root ||
      data.bones.length !== compatible.bones.length ||
      data.bones.some((bone, index) => {
        const before = compatible.bones[index]!;
        return (
          bone.id !== before.id ||
          bone.parent !== before.parent ||
          Boolean(bone.sprite) !== Boolean(before.sprite) ||
          bone.sprite?.texture !== before.sprite?.texture ||
          bone.sprite?.frame !== before.sprite?.frame
        );
      }) ||
      (data.slots ?? []).length !== (compatible.slots ?? []).length ||
      (data.slots ?? []).some(
        (slot, index) => slot.id !== compatible.slots![index]!.id || slot.bone !== compatible.slots![index]!.bone,
      ))
  )
    return undefined;
  // IK authoring is additive within a compatible skeleton. RigEditorState checks
  // live animation/host dependencies before accepting deletions or chain changes.
  const external = recovery.success ? (recovery.data.standaloneSkins ?? standaloneSkins) : standaloneSkins;
  if (defaultSkin && ![...(data.skins ?? []), ...external].some((skin) => skin.name === defaultSkin)) return undefined;
  if (
    !equalEditorData(
      external.map((skin) => skin.name),
      standaloneSkins.map((skin) => skin.name),
    )
  )
    return undefined;
  checkSkinReferences(external, data, (issue) => issues.push(issue));
  if (issues.some((issue) => issue.severity === 'error')) return undefined;
  const directions = recovery.success
    ? recovery.data.directions
    : compatible.bones.flatMap((bone): [string, { x: number; y: number }][] => {
        const direction = normalizeBoneDirection(bone.x ?? 0, bone.y ?? 0);
        return bone.parent !== undefined && direction ? [[bone.id, direction]] : [];
      });
  const bones = new Map(data.bones.map((bone) => [bone.id, bone]));
  const seen = new Set<string>();
  for (const [id, direction] of directions) {
    if (
      seen.has(id) ||
      !bones.has(id) ||
      bones.get(id)!.parent === undefined ||
      Math.abs(Math.hypot(direction.x, direction.y) - 1) > 1e-12
    )
      return undefined;
    seen.add(id);
  }
  return freezeData({
    rig: {
      ...data,
      ...(name === undefined ? {} : { name }),
      slots: data.slots ?? [],
      attachments: data.attachments ?? [],
      skins: data.skins ?? [],
    },
    directions,
    standaloneSkins: external,
  });
}
