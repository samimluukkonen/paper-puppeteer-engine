import { assert, test } from 'vitest';
import { assetFilename } from '../src/devtools/shared/assetFilename.js';

test.each([
  ['rigs/rig%20v2.json?revision=2#asset', 'rig v2.json'],
  ['https://example.test/assets/rig.json?revision=2#asset', 'rig.json'],
  ['animations/100%.json', '100%.json'],
  ['animations/invalid%ZZ.json', 'invalid%ZZ.json'],
  ['assets/', 'fallback.json'],
  ['', 'fallback.json'],
  [undefined, 'fallback.json'],
])('asset URL %s exports as %s', (path, expected) => {
  assert.equal(assetFilename(path, 'fallback.json'), expected);
});
