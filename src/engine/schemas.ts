import { z } from 'zod';

const finiteNumber = z.number({
  error: (issue) => (typeof issue.input === 'number' ? 'must be a finite number' : undefined),
});

const transformFields = {
  x: finiteNumber.exactOptional(),
  y: finiteNumber.exactOptional(),
  rotation: finiteNumber.exactOptional(),
  scaleX: finiteNumber.exactOptional(),
  scaleY: finiteNumber.exactOptional(),
};

const spriteSchema = z.object({
  texture: z.string().min(1, 'A sprite needs a texture key.'),
  frame: z.union([z.string(), finiteNumber]).exactOptional(),
  x: finiteNumber.exactOptional(),
  y: finiteNumber.exactOptional(),
  originX: finiteNumber
    .min(0, 'Sprite origin must be between 0 and 1.')
    .max(1, 'Sprite origin must be between 0 and 1.')
    .exactOptional(),
  originY: finiteNumber
    .min(0, 'Sprite origin must be between 0 and 1.')
    .max(1, 'Sprite origin must be between 0 and 1.')
    .exactOptional(),
  scaleX: finiteNumber.exactOptional(),
  scaleY: finiteNumber.exactOptional(),
  depth: finiteNumber.exactOptional(),
});

export const slotDefinitionSchema = z.object({
  id: z.string().min(1),
  bone: z.string().min(1),
  depth: finiteNumber.exactOptional(),
  ...transformFields,
});

export const spriteAttachmentSchema = z.object({
  id: z.string().min(1),
  texture: z.string().min(1),
  frame: z.union([z.string(), finiteNumber]).exactOptional(),
  ...transformFields,
  originX: finiteNumber.min(0).max(1).exactOptional(),
  originY: finiteNumber.min(0).max(1).exactOptional(),
});

export const skinDefinitionSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  slots: z.record(z.string(), z.string().min(1).nullable()),
});

/** Shape and scalar validation for plain rig data, including data loaded from JSON. */
export const rigDefinitionSchema = z.object({
  root: z.string().min(1, 'A rig needs a root id.'),
  bones: z.array(
    z.object({
      id: z.string().min(1, 'A bone needs an id.'),
      parent: z.string().exactOptional(),
      length: finiteNumber.min(0, 'Bone length cannot be negative.').exactOptional(),
      sprite: spriteSchema.exactOptional(),
      depth: finiteNumber.exactOptional(),
      ...transformFields,
    }),
  ),
  slots: z.array(slotDefinitionSchema).exactOptional(),
  attachments: z.array(spriteAttachmentSchema).exactOptional(),
  skins: z.array(skinDefinitionSchema).exactOptional(),
});

const keyframeSchema = z.object({ time: finiteNumber, ...transformFields });

/** Shape and scalar validation for authored clips; rig-specific rules run during compilation. */
export const animationClipSchema = z.object({
  name: z.string().min(1, 'An animation needs a name.'),
  duration: finiteNumber.positive('Animation duration must be greater than zero.'),
  loop: z.boolean(),
  interpolation: z.literal('linear').exactOptional(),
  tracks: z.record(z.string(), z.array(keyframeSchema)),
  events: z
    .array(z.object({ time: finiteNumber, name: z.string().min(1), data: z.unknown().exactOptional() }))
    .exactOptional(),
  playback: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('smooth') }),
      z.object({ mode: z.literal('stepped'), fps: finiteNumber.positive('Animation FPS must be greater than zero.') }),
    ])
    .exactOptional(),
});

/** Shape and scalar validation for an IK chain definition. */
export const twoBoneIKDefinitionSchema = z.object({
  name: z.string().min(1, 'An IK constraint needs a name.'),
  rootBone: z.string().min(1),
  middleBone: z.string().min(1),
  endBone: z.string().min(1),
  endOffset: z.object({ x: finiteNumber, y: finiteNumber }).exactOptional(),
  bendDirection: z.union([z.literal(1), z.literal(-1)]).exactOptional(),
  mix: finiteNumber.min(0, 'IK mix must be between 0 and 1.').max(1, 'IK mix must be between 0 and 1.').exactOptional(),
  enabled: z.boolean().exactOptional(),
  priority: finiteNumber.exactOptional(),
});
