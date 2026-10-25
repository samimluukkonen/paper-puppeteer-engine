import { z } from 'zod';
import { sceneImageReferenceSchema } from '../../engine/SceneDefinition.js';
import { identifierSchema } from '../../engine/schemas.js';
import { groundGuideSchema } from './groundGuide.js';

/** Project editor metadata only. Never consumed by CharacterLoader, Puppet or scene choreography. */
export const animationPreviewPreferencesSchema = z.strictObject({
  environment: z.strictObject({
    enabled: z.boolean(),
    image: sceneImageReferenceSchema
      .refine((reference) => !/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(reference), 'Use a relative project image path.')
      .nullable(),
    visible: z.boolean(),
    x: z.number().finite(),
    y: z.number().finite(),
    scale: z.number().finite().positive(),
  }),
  camera: z.strictObject({
    mode: z.enum(['fixed', 'follow']),
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().min(0.1).max(4),
  }),
  ground: groundGuideSchema,
  animations: z
    .record(
      identifierSchema,
      z.strictObject({
        motion: z.strictObject({
          enabled: z.boolean(),
          positionKeys: z
            .array(
              z.strictObject({
                time: z.number().finite().nonnegative(),
                offsetX: z.number().finite(),
                offsetY: z.number().finite(),
              }),
            )
            .max(10000)
            .refine(
              (keys) => keys.every((key, i) => i === 0 || key.time > keys[i - 1]!.time),
              'Preview point times must be unique and increasing.',
            ),
          interpolation: z.enum(['linear', 'stepped']),
          showTrajectory: z.boolean(),
        }),
        loop: z.boolean(),
      }),
    )
    .refine((entries) => Object.keys(entries).length <= 1024, 'Too many animation preview preferences.'),
});
export type AnimationPreviewPreferences = z.infer<typeof animationPreviewPreferencesSchema>;
