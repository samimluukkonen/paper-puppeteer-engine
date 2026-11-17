import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// An editor looks up its project context once, in its main.tsx, and passes it down (React context or constructor
// arguments). Components and controllers never read the parent window themselves. `npm run lint` runs this check
// because oxlint's no-restricted-imports cannot allow one file name across differently nested import paths.
const root = 'src';
const project = path.join(root, 'devtools', 'project') + path.sep;
const lookup = /\b(projectEditorContext|projectCharacterContext|projectSceneContext|paperProjectEditor)\b/;

const failures = [];
for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
  const file = path.join(entry.parentPath, entry.name);
  if (file.startsWith(project) || entry.name === 'main.tsx') continue;
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    const match = lookup.exec(line);
    if (match) failures.push(`${file}:${index + 1}: ${match[1]}`);
  });
}

if (failures.length) {
  console.error(
    `Look up the project context only in an editor's main.tsx and pass it down (useProjectContext, constructor arguments):\n${failures.map((failure) => `  ${failure}`).join('\n')}`,
  );
  process.exitCode = 1;
}
