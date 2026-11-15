import type { Puppet } from '../../engine/runtime.js';

/** Lowest authored sole point in the initial pose, relative to the scene-root Actor origin. */
export function actorGroundOffset(puppet: Puppet): number | undefined {
  let bottom: number | undefined;
  for (const slot of puppet.rig.slots) {
    const attachmentId = puppet.getAttachment(slot.id);
    if (!attachmentId) continue;
    const contacts = puppet.rig.getAttachment(attachmentId).groundContacts;
    const image = puppet.getSlotImage(slot.id);
    if (!contacts || !image || image.width <= 0 || image.height <= 0) continue;
    // Authoring previews can be hidden during playback; their artwork visibility still matters.
    let visible = true;
    let object: typeof image | typeof image.parentContainer = image;
    while (object && object !== puppet.container) {
      if (!object.visible || object.alpha <= 0) visible = false;
      object = object.parentContainer;
    }
    if (!visible) continue;
    const matrix = image.getWorldTransformMatrix();
    if (!Number.isFinite(matrix.a * matrix.d - matrix.b * matrix.c) || matrix.a * matrix.d === matrix.b * matrix.c)
      continue;
    for (const point of contacts) {
      const world = matrix.transformPoint(
        (point.x - image.originX) * image.width,
        (point.y - image.originY) * image.height,
      );
      if (!Number.isFinite(world.y)) continue;
      bottom = Math.max(bottom ?? -Infinity, world.y);
    }
  }
  return bottom === undefined ? undefined : bottom - puppet.container.y;
}
