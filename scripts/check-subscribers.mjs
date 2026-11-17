import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Devtools UI subscriptions go through the shared Subscribers owner, which fixes delivery order, error isolation and
// the revision snapshot. oxlint has no no-restricted-syntax rule, so `npm run lint` runs this check instead.
const root = 'src/devtools';
const owner = path.join(root, 'shared', 'subscriberNotifications.ts');
const forbidden = [
  { pattern: /new Set<\s*\(\s*\)\s*=>\s*void\s*>\s*\(/, reason: 'hand-written listener Set' },
  { pattern: /for\s*\(\s*const\s+listener\s+of\b/, reason: 'hand-written listener loop' },
];

const failures = [];
for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
  const file = path.join(entry.parentPath, entry.name);
  if (file === owner) continue;
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    for (const { pattern, reason } of forbidden)
      if (pattern.test(line)) failures.push(`${file}:${index + 1}: ${reason}`);
  });
}

if (failures.length) {
  console.error(
    `Use Subscribers from ${owner} instead of owning listeners by hand:\n${failures.map((failure) => `  ${failure}`).join('\n')}`,
  );
  process.exitCode = 1;
}
