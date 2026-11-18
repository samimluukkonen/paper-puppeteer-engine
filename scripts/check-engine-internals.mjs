import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// `Puppet.posePipeline` is an engine internal: code outside src/engine edits poses through the public seam so the
// prepare → edit → sync ordering stays in one place. oxlint has no rule restricting member access by name, so
// `npm run lint` runs this check instead. Tests are not scanned; they may inspect the pipeline directly.
const root = process.argv[2] ?? 'src';
const engine = path.join(root, 'engine');
// Member access (`puppet.posePipeline`) and type keys (`Pick<Puppet, 'posePipeline'>`) both reach the internal.
const forbidden = /\.posePipeline\b|['"]posePipeline['"]/;

/**
 * Blank out comments while keeping line numbers, so documentation may still name the internal.
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
}

/** @type {string[]} */
const failures = [];
for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
  const file = path.join(entry.parentPath, entry.name);
  if (file.startsWith(engine + path.sep)) continue;
  stripComments(await readFile(file, 'utf8'))
    .split('\n')
    .forEach((line, index) => {
      if (forbidden.test(line)) failures.push(`${path.relative(root, file)}:${index + 1}`);
    });
}

if (failures.length) {
  console.error(
    `puppet.posePipeline is engine-internal. Use puppet.editPose(…) for pose edits, puppet.attachPoseSource(…) for ` +
      `external pose/IK/deformation channels, and puppet.setPreviewMode / sampleRootMotion / elapsedTime for ` +
      `player access:\n${failures.map((failure) => `  ${failure}`).join('\n')}`,
  );
  process.exitCode = 1;
}
