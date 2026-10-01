import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

// Use the same TypeScript module resolution as the engine without adding a build dependency.
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const { generateJsonSchemas } = await server.ssrLoadModule('/src/engine/jsonSchemas.ts');
  for (const [filename, schema] of Object.entries(generateJsonSchemas())) {
    await writeFile(new URL(`../schemas/${filename}`, import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
  }
} finally {
  await server.close();
}
