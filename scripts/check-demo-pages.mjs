import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(process.argv[2] ?? join(root, 'dist/demo'));

/**
 * Every built view page: an index.html at the dist root or in a subdirectory.
 * @param {string} dir
 * @param {string[]} [pages]
 * @returns {Promise<string[]>}
 */
async function collectPages(dir, pages = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'assets') await collectPages(path, pages);
    } else if (entry.name === 'index.html') pages.push(path);
  }
  return pages;
}

/**
 * @param {string | undefined} value
 * @returns {value is string}
 */
const localReference = (value) => !!value && !/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(value);

const pages = await collectPages(dist);
assert.ok(pages.length > 0, `${relative(root, dist)} contains no view pages; run the demo build first.`);
for (const page of pages) {
  const label = relative(dist, page);
  const html = await readFile(page, 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((tag) => /\bsrc="([^"]*)"/i.exec(tag[0])?.[1]);
  const references = [
    ...scripts,
    ...[...html.matchAll(/<link\b[^>]*>/gi)].map((tag) => /\bhref="([^"]*)"/i.exec(tag[0])?.[1]),
  ].filter(localReference);
  const entries = scripts.filter((src) => localReference(src) && !/modulepreload-polyfill/i.test(src));
  assert.ok(
    entries.length > 0,
    `${label} has no entry module script (only the preload polyfill?); the loading screen would never be removed.`,
  );
  for (const reference of references) {
    const target = resolve(dirname(page), reference);
    const exists = await stat(target).then(
      (info) => info.isFile(),
      () => false,
    );
    assert.ok(exists, `${label} references ${reference}, which is missing from the build output.`);
  }
  console.log(`${label}: ${entries.length} entry script(s), ${references.length} local references resolve.`);
}
console.log(
  `Checked ${pages.length} demo page(s) in ${relative(root, dist)}; every page can boot and clear its loading screen.`,
);
