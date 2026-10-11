import { z } from 'zod';
import { checkJson, inspectRigDefinition, type ValidationIssue } from '../../engine/externalData.js';
import type { Rig } from '../../engine/Rig.js';
import type { RigDefinition } from '../../engine/types.js';
import { equalEditorData, freezeData, type ReadonlyEditorData } from '../shared/editorData.js';

export type RigEditorRecoverySnapshot = ReadonlyEditorData<{
  rig: RigDefinition;
  directions: [string, { x: number; y: number }][];
}>;
const recoveryDraftSchema = z.strictObject({
  version: z.literal(1),
  rig: z.unknown(),
  directions: z.array(z.tuple([z.string(), z.strictObject({ x: z.number(), y: z.number() })])),
});

/** Parse compatible legacy/current drafts without changing editor state or input data. */
export function inspectRigDraft(
  input: unknown,
  initial: ReadonlyEditorData<RigDefinition>,
  rig: Rig,
): RigEditorRecoverySnapshot | undefined {
  const issues: ValidationIssue[] = [];
  if (!checkJson(input, '', issues) || issues.length) return undefined;
  const recovery = recoveryDraftSchema.safeParse(input);
  // Earlier browser drafts stored only the rig file; they remain recoverable.
  const { data } = inspectRigDefinition(recovery.success ? recovery.data.rig : input);
  if (!data) return undefined;
  // A bind editor retains its original topology and artwork identities during authoring.
  if (
    data.root !== initial.root ||
    data.bones.length !== initial.bones.length ||
    data.bones.some((bone, index) => {
      const before = initial.bones[index]!;
      return (
        bone.id !== before.id ||
        bone.parent !== before.parent ||
        Boolean(bone.sprite) !== Boolean(before.sprite) ||
        bone.sprite?.texture !== before.sprite?.texture ||
        bone.sprite?.frame !== before.sprite?.frame
      );
    }) ||
    (data.slots ?? []).length !== (initial.slots ?? []).length ||
    (data.slots ?? []).some(
      (slot, index) => slot.id !== initial.slots![index]!.id || slot.bone !== initial.slots![index]!.bone,
    ) ||
    (data.attachments ?? []).length !== (initial.attachments ?? []).length ||
    (data.attachments ?? []).some((attachment, index) => {
      const before = initial.attachments![index]!;
      return attachment.id !== before.id || attachment.texture !== before.texture || attachment.frame !== before.frame;
    }) ||
    !equalEditorData(data.skins ?? [], initial.skins ?? []) ||
    !equalEditorData(data.ik ?? [], initial.ik ?? [])
  )
    return undefined;
  const directions = recovery.success
    ? recovery.data.directions
    : initial.bones.flatMap((bone): [string, { x: number; y: number }][] => {
        const distance = Math.hypot(bone.x ?? 0, bone.y ?? 0);
        return bone.parent !== undefined && distance > 0
          ? [[bone.id, { x: (bone.x ?? 0) / distance, y: (bone.y ?? 0) / distance }]]
          : [];
      });
  const seen = new Set<string>();
  for (const [id, direction] of directions) {
    if (
      seen.has(id) ||
      !rig.hasBone(id) ||
      rig.getBone(id).parent === undefined ||
      Math.abs(Math.hypot(direction.x, direction.y) - 1) > 1e-12
    )
      return undefined;
    seen.add(id);
  }
  return freezeData({
    rig: { ...data, slots: data.slots ?? [], attachments: data.attachments ?? [], skins: data.skins ?? [] },
    directions,
  });
}
