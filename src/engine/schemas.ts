import { z } from 'zod';
import { type TransformProperty, transformProperties } from './types.js';

export const RIG_FORMAT_VERSION = 1;
export const ANIMATION_FORMAT_VERSION = 1;
export const POSE_FORMAT_VERSION = 1;
export const CHARACTER_FORMAT_VERSION = 1;

/** Identifiers are nonempty strings; __proto__ is reserved because record parsers discard it. */
export const identifierSchema = z
  .string()
  .min(1)
  .regex(/^(?!__proto__$)[\s\S]+$/, 'The identifier "__proto__" is reserved.');

/** Check the raw dictionary before Zod can silently discard its reserved key. */
function identifierRecord<T extends z.ZodType>(valueSchema: T) {
  return z.preprocess(
    (input, context) => {
      if (typeof input === 'object' && input !== null && Object.hasOwn(input, '__proto__')) {
        context.addIssue({ code: 'custom', path: ['__proto__'], message: 'The identifier "__proto__" is reserved.' });
        return z.NEVER;
      }
      return input;
    },
    z.record(identifierSchema, valueSchema),
  );
}

const finiteNumber = z.number({
  error: (issue) => (typeof issue.input === 'number' ? 'must be a finite number' : undefined),
});

const transformFields = Object.fromEntries(
  transformProperties.map((property) => [property, finiteNumber.exactOptional()]),
) as Record<TransformProperty, ReturnType<typeof finiteNumber.exactOptional>>;

export const spriteSchema = z.object({
  texture: identifierSchema,
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
  id: identifierSchema,
  bone: identifierSchema,
  depth: finiteNumber.exactOptional(),
  ...transformFields,
});

export const spriteAttachmentSchema = z.object({
  id: identifierSchema,
  texture: identifierSchema,
  frame: z.union([z.string(), finiteNumber]).exactOptional(),
  ...transformFields,
  originX: finiteNumber.min(0).max(1).exactOptional(),
  originY: finiteNumber.min(0).max(1).exactOptional(),
});

export const skinDefinitionSchema = z.object({
  version: z.literal(1),
  name: identifierSchema,
  slots: identifierRecord(identifierSchema.nullable()),
});

export const boneDefinitionSchema = z.object({
  id: identifierSchema,
  parent: identifierSchema.exactOptional(),
  length: finiteNumber.min(0, 'Bone length cannot be negative.').exactOptional(),
  sprite: spriteSchema.exactOptional(),
  depth: finiteNumber.exactOptional(),
  ...transformFields,
});

export const ikMixSchema = finiteNumber
  .min(0, 'IK mix must be between 0 and 1.')
  .max(1, 'IK mix must be between 0 and 1.');

/** Shape and scalar validation for an IK chain definition. */
export const twoBoneIKDefinitionSchema = z.object({
  name: identifierSchema,
  rootBone: identifierSchema,
  middleBone: identifierSchema,
  endBone: identifierSchema,
  endOffset: z.object({ x: finiteNumber, y: finiteNumber }).exactOptional(),
  bendDirection: z.union([z.literal(1), z.literal(-1)]).exactOptional(),
  mix: ikMixSchema.exactOptional(),
  enabled: z.boolean().exactOptional(),
  priority: finiteNumber.exactOptional(),
});

/** Shape and scalar validation for plain rig data, including data loaded from JSON. */
export const rigDefinitionSchema = z.object({
  root: identifierSchema,
  bones: z.array(boneDefinitionSchema),
  slots: z.array(slotDefinitionSchema).exactOptional(),
  attachments: z.array(spriteAttachmentSchema).exactOptional(),
  skins: z.array(skinDefinitionSchema).exactOptional(),
  ik: z.array(twoBoneIKDefinitionSchema).exactOptional(),
});

export const keyframeSchema = z.object({ time: finiteNumber, ...transformFields });
/** Sparse target position and solver influence, using ordinary authored row times. */
export const ikKeyframeSchema = z.object({
  time: finiteNumber,
  x: finiteNumber.exactOptional(),
  y: finiteNumber.exactOptional(),
  mix: ikMixSchema.exactOptional(),
});
export const animationEventSchema = z.object({
  time: finiteNumber,
  name: identifierSchema,
  data: z.unknown().exactOptional(),
});
export const smoothPlaybackSchema = z.object({ mode: z.literal('smooth') });
export const steppedPlaybackSchema = z.object({
  mode: z.literal('stepped'),
  fps: finiteNumber.positive('Animation FPS must be greater than zero.'),
});

/** Shape and scalar validation for authored clips; rig-specific rules run during compilation. */
export const animationClipSchema = z.object({
  name: identifierSchema,
  duration: finiteNumber.positive('Animation duration must be greater than zero.'),
  loop: z.boolean(),
  interpolation: z.literal('linear').exactOptional(),
  tracks: identifierRecord(z.array(keyframeSchema)),
  ikTracks: identifierRecord(z.array(ikKeyframeSchema)).exactOptional(),
  events: z.array(animationEventSchema).exactOptional(),
  playback: z.discriminatedUnion('mode', [smoothPlaybackSchema, steppedPlaybackSchema]).exactOptional(),
});

/** Strict file shapes derive their fields and scalar constraints from runtime schemas. */
export const skinFileSchema = skinDefinitionSchema.strict();
export const rigFileSchema = rigDefinitionSchema
  .extend({
    version: z.literal(RIG_FORMAT_VERSION),
    name: z.string().min(1, 'Rig name must be a nonempty string.').exactOptional(),
    bones: z.array(boneDefinitionSchema.extend({ sprite: spriteSchema.strict().exactOptional() }).strict()),
    slots: z.array(slotDefinitionSchema.strict()).exactOptional(),
    attachments: z.array(spriteAttachmentSchema.strict()).exactOptional(),
    skins: z.array(skinFileSchema).exactOptional(),
    ik: z
      .array(
        twoBoneIKDefinitionSchema
          .extend({ endOffset: twoBoneIKDefinitionSchema.shape.endOffset.unwrap().strict().exactOptional() })
          .strict(),
      )
      .exactOptional(),
  })
  .strict();

export const animationFileSchema = animationClipSchema
  .extend({
    version: z.literal(ANIMATION_FORMAT_VERSION),
    tracks: identifierRecord(
      z.array(keyframeSchema.extend({ time: keyframeSchema.shape.time.nonnegative() }).strict()),
    ),
    ikTracks: identifierRecord(
      z.array(ikKeyframeSchema.extend({ time: ikKeyframeSchema.shape.time.nonnegative() }).strict()),
    ).exactOptional(),
    events: z
      .array(animationEventSchema.extend({ time: animationEventSchema.shape.time.nonnegative() }).strict())
      .exactOptional(),
    playback: z
      .discriminatedUnion('mode', [smoothPlaybackSchema.strict(), steppedPlaybackSchema.strict()])
      .exactOptional(),
  })
  .strict();

export const poseDefinitionSchema = z.strictObject({
  version: z.literal(POSE_FORMAT_VERSION),
  name: identifierSchema,
  bones: identifierRecord(z.strictObject(transformFields).partial()),
});

export const characterManifestSchema = z.strictObject({
  version: z.literal(CHARACTER_FORMAT_VERSION),
  id: identifierSchema,
  rig: z.string().min(1),
  defaultSkin: identifierSchema,
  skins: identifierRecord(z.string().min(1)),
  animations: z.array(z.string().min(1)),
  poses: z.array(z.string().min(1)).optional(),
  /** Phaser texture key -> image path, relative to character.json. */
  textures: identifierRecord(z.string().min(1)),
});
