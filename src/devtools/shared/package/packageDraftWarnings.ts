import { mergeSkins } from '../../../engine/mergeSkins.js';
import type { PackageSnapshot } from './characterPackage.js';

/** Content guidance only. Sparse/hidden artwork and animation-free rigs remain valid runtime data. */
export function packageDraftWarnings(snapshot: PackageSnapshot): string[] {
  const { rig, animations, definition } = snapshot;
  const warnings: string[] = [];
  if (rig.bones.length === 1)
    warnings.push('Only the root bone is present. Use Build skeleton to add bones if your character needs them.');
  if (!rig.bones.some((bone) => bone.sprite) && !rig.attachments?.length)
    warnings.push('No artwork is attached. Import new artwork, create an attachment and assign it to a slot.');
  if (!animations.length)
    warnings.push('No animations yet. Open Animation Editor and choose + New Animation to create the first clip.');
  const skin = mergeSkins(rig.skins ?? [], snapshot.skins).find((entry) => entry.name === definition.defaultSkin);
  const unassigned = (rig.slots ?? []).filter((slot) => !skin || !Object.hasOwn(skin.slots, slot.id));
  if (unassigned.length)
    warnings.push(
      `Default skin "${definition.defaultSkin}" has unassigned slots: ${unassigned.map((slot) => slot.id).join(', ')}. Assign artwork in Attachments & skins, or explicitly hide these slots.`,
    );
  return warnings;
}
