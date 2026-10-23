import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { readPackageManifest } from './packageManifest.mjs';

const { version } = await readPackageManifest(new URL('../package.json', import.meta.url));
// Numeric identifiers cannot have leading zeros; prerelease identifiers may also contain letters and hyphens.
const numeric = '(?:0|[1-9][0-9]*)';
const prerelease = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const build = '[0-9A-Za-z-]+';
const semver = new RegExp(
  `^${numeric}\\.${numeric}\\.${numeric}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+${build}(?:\\.${build})*)?$`,
);
assert.ok(typeof version === 'string' && semver.test(version), `Invalid package SemVer: ${JSON.stringify(version)}.`);
const lock = z
  .object({ version: z.string(), packages: z.object({ '': z.object({ version: z.string() }) }) })
  .parse(JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')));
assert.equal(lock.version, version, 'Lockfile version must match package.json.');
assert.equal(lock.packages[''].version, version, 'Lockfile root package version must match package.json.');
const standalone = z
  .object({ dependencies: z.record(z.string(), z.string()) })
  .parse(JSON.parse(await readFile(new URL('../examples/standalone/package.json', import.meta.url), 'utf8')));
assert.equal(
  standalone.dependencies['paper-puppeteer-engine'],
  `file:../../dist/paper-puppeteer-engine-${version}.tgz`,
  'Standalone consumer must install the current release tarball.',
);
const standaloneLock = z
  .object({
    packages: z.object({
      '': z.object({ dependencies: z.record(z.string(), z.string()) }),
      'node_modules/paper-puppeteer-engine': z.object({ version: z.string(), resolved: z.string() }),
    }),
  })
  .parse(JSON.parse(await readFile(new URL('../examples/standalone/package-lock.json', import.meta.url), 'utf8')));
assert.equal(
  standaloneLock.packages[''].dependencies['paper-puppeteer-engine'],
  standalone.dependencies['paper-puppeteer-engine'],
  'Standalone lockfile must use the current tarball.',
);
assert.equal(
  standaloneLock.packages['node_modules/paper-puppeteer-engine'].version,
  version,
  'Standalone lockfile package version must match.',
);
assert.equal(
  standaloneLock.packages['node_modules/paper-puppeteer-engine'].resolved,
  standalone.dependencies['paper-puppeteer-engine'],
  'Standalone lockfile resolution must use the current tarball.',
);
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
assert.ok(changelog.split(/\r?\n/).includes(`## ${version}`), 'Current version must have a changelog entry.');
console.log(`Package version ${version} is valid SemVer; lockfile, standalone tarball and changelog agree.`);
