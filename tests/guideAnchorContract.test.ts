import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assert, test } from 'vitest';
import { GUIDE_TARGETS, getAllGuides } from '../src/devtools/shared/guides/index.js';

const SOURCE_ROOT = join(import.meta.dirname, '../src');
const GUIDE_DATA_DIR = join(SOURCE_ROOT, 'devtools/shared/guides');
const IMPORT = /import\s*\{([^}]*)\}\s*from\s*'[^']*\/anchors\.js'/g;

/** Keys of GUIDE_TARGETS that one source file references, through whatever local name it imports it as. */
function anchorKeysReferencedIn(source: string): Set<string> {
  const keys = new Set<string>();
  for (const [, specifiers] of source.matchAll(IMPORT)) {
    const alias = /\bGUIDE_TARGETS(?:\s+as\s+(\w+))?/.exec(specifiers!)?.[1] ?? 'GUIDE_TARGETS';
    for (const [, key] of source.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))) keys.add(key!);
  }
  return keys;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return path === GUIDE_DATA_DIR ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const keyByTarget = new Map<string, string>(Object.entries(GUIDE_TARGETS).map(([key, value]) => [value, key]));
const viewKeys = new Map<string, string[]>();
for (const file of sourceFiles(SOURCE_ROOT)) {
  for (const key of anchorKeysReferencedIn(readFileSync(file, 'utf8')))
    viewKeys.set(key, [...(viewKeys.get(key) ?? []), relative(SOURCE_ROOT, file)]);
}
const guideTargets = getAllGuides().flatMap((guide) =>
  guide.steps.flatMap((step) => [
    { where: `${guide.id}/${step.id}`, target: step.targetId },
    ...(step.mode === 'try-it' ? [{ where: `${guide.id}/${step.id} practice`, target: step.practice.targetId }] : []),
  ]),
);

test('the anchor scan follows import aliases and ignores files that do not import the anchors', () => {
  const aliased = `import { GUIDE_TARGETS as targets } from '../shared/guides/anchors.js';\n<div data-guide-id={targets.sceneNew} />`;
  assert.deepEqual([...anchorKeysReferencedIn(aliased)], ['sceneNew']);
  const plain = `import { GUIDE_TARGETS } from './guides/anchors.js';\nconst id = GUIDE_TARGETS.rigCharacter;`;
  assert.deepEqual([...anchorKeysReferencedIn(plain)], ['rigCharacter']);
  assert.deepEqual([...anchorKeysReferencedIn(`const id = GUIDE_TARGETS.sceneNew;`)], []);
  assert.deepEqual([...anchorKeysReferencedIn(`import { GUIDE_TARGETS } from './anchors.js';\n`)], []);
});

test('every guide step targets an anchor that some view renders', () => {
  assert.isNotEmpty(guideTargets);
  const missing = guideTargets.flatMap(({ where, target }) => {
    const key = keyByTarget.get(target);
    if (!key) return [`${where}: "${target}" is not a GUIDE_TARGETS value`];
    return viewKeys.has(key) ? [] : [`${where}: no view references GUIDE_TARGETS.${key}`];
  });
  assert.deepEqual(missing, []);
});

test('every anchor key is used by a guide or rendered by a view', () => {
  const used = new Set(guideTargets.map(({ target }) => keyByTarget.get(target)));
  const dead = Object.keys(GUIDE_TARGETS).filter((key) => !used.has(key) && !viewKeys.has(key));
  assert.deepEqual(dead, []);
});
