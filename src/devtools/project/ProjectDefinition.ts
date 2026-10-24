import { z } from 'zod';
import { assertJsonInputSize } from '../../engine/jsonInput.js';
import { packagePath } from '../../engine/packageZip.js';

const identity = z.string().min(1).max(200).regex(/\S/);
const path = z.string().transform((value) => packagePath(value));
export const projectDefinitionSchema = z.strictObject({
  version: z.literal(1),
  id: identity,
  name: identity,
  characters: z.array(z.strictObject({ id: identity, name: identity, manifest: path })),
  images: z
    .array(z.strictObject({ id: identity, name: identity, path }))
    .max(1024)
    .exactOptional(),
  scenes: z.array(z.strictObject({ id: identity, path })),
});
export type ProjectDefinition = z.infer<typeof projectDefinitionSchema>;

export function parseProjectDefinition(input: unknown): ProjectDefinition {
  const project = projectDefinitionSchema.parse(input);
  for (const entries of [project.characters, project.scenes, project.images ?? []]) {
    const ids = entries.map((entry) => entry.id.toLowerCase());
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate project asset ID.');
  }
  const paths = [
    ...project.characters.map((entry) => entry.manifest),
    ...project.scenes.map((entry) => entry.path),
    ...(project.images ?? []).map((entry) => entry.path),
  ];
  if (new Set(paths.map((entry) => entry.toLowerCase())).size !== paths.length)
    throw new Error('Duplicate project asset path.');
  assertJsonInputSize(JSON.stringify(project));
  return project;
}
