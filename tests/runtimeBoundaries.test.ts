import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync, Visitor } from 'vite';
import { assert, test } from 'vitest';

const engine = fileURLToPath(new URL('../src/engine/', import.meta.url));

interface Dependency {
  specifier: string;
  typeOnly: boolean;
}

/** Parse module syntax so multiline exports, type imports and dynamic imports obey the same boundary. */
function dependencies(source: string): Dependency[] {
  const result: Dependency[] = [];
  const parsed = parseSync('module.ts', source);
  assert.deepEqual(parsed.errors, [], 'Module syntax must parse before its dependencies are checked.');
  new Visitor({
    ImportDeclaration(node) {
      const typeOnly =
        node.importKind === 'type' ||
        (node.specifiers.length > 0 &&
          node.specifiers.every((entry) => entry.type === 'ImportSpecifier' && entry.importKind === 'type'));
      result.push({ specifier: node.source.value, typeOnly });
    },
    ExportNamedDeclaration(node) {
      if (!node.source) return;
      const typeOnly =
        node.exportKind === 'type' ||
        (node.specifiers.length > 0 && node.specifiers.every((entry) => entry.exportKind === 'type'));
      result.push({ specifier: node.source.value, typeOnly });
    },
    ExportAllDeclaration(node) {
      result.push({ specifier: node.source.value, typeOnly: node.exportKind === 'type' });
    },
    ImportExpression(node) {
      assert.equal(node.source.type, 'Literal', 'Runtime dynamic imports must have an auditable module path.');
      if (node.source.type === 'Literal') {
        assert.isString(node.source.value);
        result.push({ specifier: String(node.source.value), typeOnly: false });
      }
    },
    TSImportType(node) {
      result.push({ specifier: node.source.value, typeOnly: true });
    },
  }).visit(parsed.program);
  return result;
}

function engineFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? engineFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

const graph = new Map(engineFiles(engine).map((file) => [file, dependencies(readFileSync(file, 'utf8'))]));
const dependencyFile = (file: string, specifier: string): string =>
  resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));

test('every engine module stays inside the engine or uses its declared runtime dependencies', () => {
  for (const [file, imports] of graph) {
    for (const { specifier } of imports) {
      const owner = relative(engine, file);
      if (!specifier.startsWith('.')) {
        assert.include(
          ['phaser', 'zod'],
          specifier,
          `${owner} must not import an application or undeclared dependency`,
        );
        continue;
      }
      assert.isTrue(graph.has(dependencyFile(file, specifier)), `${owner} imports outside the engine: ${specifier}`);
    }
  }
});

test.each(['core', 'serialization', 'data'])(
  '/%s has no transitive runtime dependency on Phaser or editors',
  (entry) => {
    const visited = new Set<string>();
    const visit = (file: string): void => {
      if (visited.has(file)) return;
      visited.add(file);
      const imports = graph.get(file);
      assert.ok(imports, `Missing runtime dependency ${file}`);
      for (const { specifier, typeOnly } of imports) {
        if (typeOnly) continue;
        if (specifier.startsWith('.')) visit(dependencyFile(file, specifier));
        else assert.equal(specifier, 'zod', `${relative(engine, file)} introduced a browser dependency`);
      }
    };
    visit(resolve(engine, `${entry}.ts`));
  },
);

test('runtime value dependencies contain no module cycles', () => {
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (file: string, path: string[]): void => {
    assert.isFalse(active.has(file), `Module cycle: ${[...path, relative(engine, file)].join(' -> ')}`);
    if (visited.has(file)) return;
    active.add(file);
    for (const { specifier, typeOnly } of graph.get(file) ?? [])
      if (!typeOnly && specifier.startsWith('.'))
        visit(dependencyFile(file, specifier), [...path, relative(engine, file)]);
    active.delete(file);
    visited.add(file);
  };
  for (const file of graph.keys()) visit(file, []);
});

test('the minimal runtime example imports only the public runtime barrel and Phaser types', () => {
  const source = readFileSync(new URL('../src/examples/runtime.ts', import.meta.url), 'utf8');
  assert.deepEqual(dependencies(source), [
    { specifier: 'phaser', typeOnly: true },
    { specifier: '../engine/runtime.js', typeOnly: false },
  ]);
});
