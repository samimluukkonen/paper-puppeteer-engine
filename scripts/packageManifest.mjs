import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const versions = z.record(z.string(), z.string());
const packageManifest = z.object({
  name: z.string(),
  version: z.string(),
  dependencies: versions.optional(),
  peerDependencies: versions.optional(),
});

/** @param {URL | string} path */
export async function readPackageManifest(path) {
  return packageManifest.parse(JSON.parse(await readFile(path, 'utf8')));
}
