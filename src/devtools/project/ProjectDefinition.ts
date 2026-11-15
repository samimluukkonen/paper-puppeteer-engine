import { z } from 'zod';
import {
  audioAssetDefinitionSchema,
  assertJsonInputSize,
  packagePath,
  rigBoneMappingSchema,
  parseStoryDefinition,
  storyDefinitionSchema,
} from '../../engine/core.js';
import { animationPreviewPreferencesSchema } from '../shared/animationPreviewPreferences.js';
import { parseSceneReuseLibrary, sceneReuseLibrarySchema } from '../shared/sceneReuse.js';

const identity = z.string().min(1).max(200).regex(/\S/);
const path = z.string().transform((value) => packagePath(value));
export const projectDefinitionSchema = z.strictObject({
  version: z.literal(1),
  id: identity,
  name: identity,
  stories: z.array(storyDefinitionSchema).max(1024).exactOptional(),
  sceneReuse: sceneReuseLibrarySchema.exactOptional(),
  rigMappings: z.array(rigBoneMappingSchema).max(128).exactOptional(),
  audio: z.array(audioAssetDefinitionSchema).max(128).exactOptional(),
  characters: z.array(
    z.strictObject({
      id: identity,
      name: identity,
      manifest: path,
      /** A single explicit owner; variants never inherit from other variants. */
      variant: z.strictObject({ rig: identity, skin: identity }).exactOptional(),
      template: z.boolean().exactOptional(),
    }),
  ),
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
  for (const story of project.stories ?? []) parseStoryDefinition(story);
  if (new Set(project.stories?.map(({ id }) => id.toLowerCase())).size !== (project.stories?.length ?? 0))
    throw new Error('Duplicate story ID.');
  if (project.sceneReuse) project.sceneReuse = parseSceneReuseLibrary(project.sceneReuse);
  for (const entry of project.characters) {
    if (!entry.variant) continue;
    const owner = project.characters.find(({ id }) => id === entry.variant!.rig);
    if (!owner || owner.id === entry.id || owner.variant)
      throw new Error(`Variant "${entry.name}" requires an independent shared rig owner.`);
    if (entry.template) throw new Error('Mark the independent rig owner as a template instead of a variant.');
  }
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
