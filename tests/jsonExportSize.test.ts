import { assert, test } from 'vitest';
import { assertJsonExportSize } from '../src/devtools/shared/jsonExportSize.js';
import { JsonInputLimitError } from '../src/engine/jsonInput.js';
import { freezeData } from '../src/engine/readonlyData.js';

test.each([null, true, 1e-30, -0, 'é😀\n"\\', [], {}, { 'é"': [null, [], {}, { x: '😀' }] }])(
  'size boundaries match actual formatted UTF-8 JSON for %j',
  (value) => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`).byteLength;
    assert.doesNotThrow(() => assertJsonExportSize(value, bytes));
    assert.throws(() => assertJsonExportSize(value, bytes - 1), JsonInputLimitError);
  },
);

test('cached frozen branches retain exact sizes at different depths and mutable branches stay fresh', () => {
  const child = { text: 'é' };
  const shallow = Object.freeze({ child });
  const shared = freezeData({ values: [1, '😀'] });
  const verify = (value: unknown) => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`).byteLength;
    assert.doesNotThrow(() => assertJsonExportSize(value, bytes));
    assert.throws(() => assertJsonExportSize(value, bytes - 1), JsonInputLimitError);
  };
  verify(shallow);
  child.text = 'longer 😀';
  verify(shallow);
  verify(shared);
  verify(freezeData({ a: shared, b: { nested: shared } }));
});
