import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Check inline links, images and reference destinations in the shipped Markdown guides.
 * External URLs and same-document anchors require no filesystem check.
 * @param {string} packageRoot
 * @param {readonly string[]} files
 */
export async function checkDocumentationLinks(packageRoot, files) {
  const root = resolve(packageRoot);
  let checked = 0;
  for (const filename of files) {
    const file = join(root, filename);
    const markdown = await readFile(file, 'utf8');
    // Examples inside fenced blocks and inline code are not documentation links.
    const prose = markdown
      .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*(?:\n|$)/gm, '')
      .replace(/(`+)[\s\S]*?\1/g, '');
    const links = [
      ...prose.matchAll(/\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/g),
      ...prose.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm),
    ];
    for (const link of links) {
      const href = link[1] ?? link[2];
      if (!href || /^(?:#|\/\/|[a-z][a-z\d+.-]*:)/i.test(href)) continue;
      const target = fileURLToPath(new URL(href, pathToFileURL(file)));
      const path = relative(root, target);
      assert.ok(
        path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path),
        `${filename} links outside the package: "${href}". Use a repository URL for files omitted from the package.`,
      );
      try {
        await access(target);
      } catch (error) {
        throw new Error(
          `${filename} links to a missing packaged file: "${href}". Use a repository URL for files omitted from the package.`,
          { cause: error },
        );
      }
      ++checked;
    }
  }
  return checked;
}
