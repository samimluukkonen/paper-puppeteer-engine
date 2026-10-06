import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { z } from 'zod';

// Use the same TypeScript module resolution as the engine without adding a build dependency.
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const module = await server.ssrLoadModule('/src/engine/jsonSchemas.ts');
  /** @type {unknown} */
  const generateJsonSchemas = module.generateJsonSchemas;
  if (typeof generateJsonSchemas !== 'function') throw new Error('Schema generator export is missing.');
  const schemas = z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .parse(Reflect.apply(generateJsonSchemas, undefined, []));
  for (const [filename, schema] of Object.entries(schemas)) {
    await writeFile(new URL(`../schemas/${filename}`, import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
  }
} finally {
  await server.close();
}
