import { z } from 'zod';
import { audioAssetDefinitionSchema } from '../../engine/AudioAsset.js';
import { assertJsonInputSize } from '../../engine/jsonInput.js';
import { packagePath } from '../../engine/packageZip.js';
import { rigBoneMappingSchema } from '../../engine/rigBoneMapping.js';
import { animationPreviewPreferencesSchema } from '../shared/animationPreviewPreferences.js';

const identity = z.string().min(1).max(200).regex(/\S/);
const path = z.string().transform((value) => packagePath(value));
export const projectDefinitionSchema = z.strictObject({
  version: z.literal(1),
  id: identity,
  name: identity,
  rigMappings: z.array(rigBoneMappingSchema).max(128).exactOptional(),
  audio: z.array(audioAssetDefinitionSchema).max(128).exactOptional(),
  characters: z.array(z.strictObject({ id: identity, name: identity, manifest: path })),
  images: z
    .array(z.strictObject({ id: identity, name: identity, path }))
    .max(1024)
    .exactOptional(),
  editorPreferences: z
    .strictObject({
      animationPreview: z
        .record(identity, animationPreviewPreferencesSchema)
        .refine((entries) => Object.keys(entries).length <= 1024, 'Too many character preview preferences.'),
    })
    .exactOptional(),
  scenes: z.array(z.strictObject({ id: identity, path })),
});
export type ProjectDefinition = z.infer<typeof projectDefinitionSchema>;

export function parseProjectDefinition(input: unknown): ProjectDefinition {
  const project = projectDefinitionSchema.parse(input);
  if (new Set(project.rigMappings?.map((mapping) => mapping.id)).size !== (project.rigMappings?.length ?? 0))
    throw new Error('Duplicate rig mapping ID.');
  for (const entries of [project.characters, project.scenes, project.images ?? [], project.audio ?? []]) {
    const ids = entries.map((entry) => entry.id.toLowerCase());
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate project asset ID.');
  }
  const paths = [
    ...project.characters.map((entry) => entry.manifest),
    ...project.scenes.map((entry) => entry.path),
    ...(project.images ?? []).map((entry) => entry.path),
    ...(project.audio ?? []).map((entry) => entry.path),
  ];
  if (new Set(paths.map((entry) => entry.toLowerCase())).size !== paths.length)
    throw new Error('Duplicate project asset path.');
  assertJsonInputSize(JSON.stringify(project));
  return project;
}
