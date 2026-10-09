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
  ['animations/walk%3A%2F%5C%3F%2A%22%3C%3E%7C%00.json', 'walk__________.json'],
  ['animations/CON.json', '_CON.json'],
  ['animations/lpt1.json', '_lpt1.json'],
  ['animations/rig.json%20.', 'rig.json'],
  ['http://[invalid', 'fallback.json'],
])('asset URL %s exports as %s', (path, expected) => {
  assert.equal(assetFilename(path, 'fallback.json'), expected);
});

test('fallback filenames are sanitized too', () => {
  assert.equal(assetFilename(undefined, 'walk:run?.json'), 'walk_run_.json');
  assert.equal(assetFilename(undefined, '..'), 'animation.json');
});
