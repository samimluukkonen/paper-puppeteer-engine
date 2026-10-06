import assert from 'node:assert/strict';
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
console.log(`Package version ${version} is valid SemVer.`);
