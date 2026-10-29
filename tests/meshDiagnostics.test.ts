import { assert, test } from 'vitest';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { inspectMeshDeformation } from '../src/engine/meshDiagnostics.js';

const mesh = createRectangleMeshAttachment(
  { id: 'sleeve', texture: 'paper' },
  { width: 20, height: 10 },
  { root: 'root', bones: [{ id: 'root' }], slots: [{ id: 'cloth', bone: 'root' }] },
);
const buffer = () => mesh.vertices.flatMap((v) => [v.x, v.y, v.u, v.v]);

test('diagnostics distinguish collapse, inversion, stretch and nonfinite output without mutating input', () => {
  const before = structuredClone(mesh);
  assert.deepEqual(inspectMeshDeformation(mesh, buffer()), []);
  const collapsed = buffer().map((v, index) => (index % 4 === 1 ? 0 : v));
  assert.deepEqual(inspectMeshDeformation(mesh, collapsed), [
    { triangle: 0, kind: 'collapsed' },
    { triangle: 1, kind: 'collapsed' },
  ]);
  const inverted = buffer().map((v, index) => (index % 4 === 0 ? -v : v));
  assert.deepEqual(inspectMeshDeformation(mesh, inverted), [
    { triangle: 0, kind: 'inverted' },
    { triangle: 1, kind: 'inverted' },
  ]);
  const stretched = buffer().map((v, index) => (index % 4 === 0 ? v * 4 : v));
  assert.deepEqual(inspectMeshDeformation(mesh, stretched), [
    { triangle: 0, kind: 'stretched' },
    { triangle: 1, kind: 'stretched' },
  ]);
  const invalid = buffer();
  invalid[4] = NaN; // Only the first triangle uses this vertex.
  assert.deepEqual(inspectMeshDeformation(mesh, invalid), [{ triangle: 0, kind: 'nonfinite' }]);
  assert.isNaN(invalid[4]);
  assert.deepEqual(mesh, before);
  assert.throws(() => inspectMeshDeformation(mesh, []), /size/);
});

test('near collapse is scale-relative and rigid translation/rotation does not trigger stretch warnings', () => {
  const small = buffer().map((v, index) => (index % 4 === 1 ? v * 0.005 : v));
  assert.deepEqual(
    inspectMeshDeformation(mesh, small).map((issue) => issue.kind),
    ['collapsed', 'collapsed'],
  );
  const rotated = buffer();
  mesh.vertices.forEach((v, index) => {
    rotated[index * 4] = 50 - v.y;
    rotated[index * 4 + 1] = -40 + v.x;
  });
  assert.deepEqual(inspectMeshDeformation(mesh, rotated), []);
});
