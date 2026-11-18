import { createHash } from 'node:crypto';
import { assert, test, vi } from 'vitest';
import { sourceDigest } from '../src/engine/core.js';

test.each(['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65)])(
  'source digest matches Node SHA-256 at padding boundaries: %j',
  (source) => {
    assert.equal(sourceDigest(source), createHash('sha256').update(source).digest('hex'));
  },
);

test('UTF-8 and large multi-block sources match Node SHA-256 without browser crypto', () => {
  vi.stubGlobal('crypto', undefined);
  try {
    for (const source of ['puppet 🦊 ää 漢字', '\ud800', 'a'.repeat(1_000_000)])
      assert.equal(sourceDigest(source), createHash('sha256').update(source).digest('hex'));
  } finally {
    vi.unstubAllGlobals();
  }
});
