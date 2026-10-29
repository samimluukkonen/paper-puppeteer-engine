import { expect, test } from 'vitest';
import { createRectangleMeshAttachment } from '../src/engine/meshAttachments.js';
import { Rig } from '../src/engine/Rig.js';
import {
  createRigBoneMapping,
  rigCompatibilityRevision,
  rigBoneMappingSchema,
  validateRigBoneMapping,
  type IdentifiedRig,
  type RigBoneMapping,
} from '../src/engine/rigBoneMapping.js';
import { analyzeRigCompatibility, suggestRigBoneMapping } from '../src/engine/rigCompatibility.js';
import type { RigDefinition } from '../src/engine/types.js';

const fixture = (id = 'source', renamed = false, length = 20): IdentifiedRig => ({
  id,
  rig: {
    root: renamed ? 'base' : 'root',
    bones: renamed
      ? [
          { id: 'base' },
          { id: 'leftUpperArm', parent: 'base', rotation: 0.2 },
          { id: 'leftForearm', parent: 'leftUpperArm', x: length },
          { id: 'leftHand', parent: 'leftForearm', x: length },
        ]
      : [
          { id: 'root' },
          { id: 'upper_arm_L', parent: 'root', rotation: 0.2 },
          { id: 'forearm_L', parent: 'upper_arm_L', x: length },
          { id: 'hand_L', parent: 'forearm_L', x: length },
        ],
  },
});
const mapping = (source: IdentifiedRig, target: IdentifiedRig) =>
  createRigBoneMapping(
    source,
    target,
    source.rig.bones.map((bone, index) => ({ sourceBoneId: bone.id, targetBoneId: target.rig.bones[index]!.id })),
    'map',
    'Arm correspondence',
  );
const codes = (report: ReturnType<typeof analyzeRigCompatibility>) =>
  [...report.diagnostics, ...report.ikDiagnostics, ...report.meshDiagnostics].map(({ code }) => code);

test('exact reuse requires both stable identity and effective structure; equal names alone require approval', () => {
  const a = fixture();
  expect(analyzeRigCompatibility(a, { ...a, rig: new Rig(a.rig) })).toMatchObject({
    level: 'exact',
    directReuse: true,
    missingBones: [],
    extraBones: [],
  });
  const b = fixture('target');
  expect(analyzeRigCompatibility(a, b)).toMatchObject({ level: 'partial', directReuse: false, mappingValid: false });
  expect(analyzeRigCompatibility(a, b, mapping(a, b))).toMatchObject({
    level: 'mappable',
    mappingValid: true,
    directReuse: false,
  });
  expect(analyzeRigCompatibility(a, fixture('source', false, 30)).level).not.toBe('exact');
});

test('different IDs and tokenized names produce reviewable suggestions and a valid explicit map', () => {
  const a = fixture(),
    b = fixture('target', true);
  const result = suggestRigBoneMapping(a, b);
  expect(result.entries).toEqual(mapping(a, b).entries);
  expect(analyzeRigCompatibility(a, b).level).toBe('incompatible');
  expect(analyzeRigCompatibility(a, b, mapping(a, b))).toMatchObject({
    level: 'mappable',
    missingBones: [],
    extraBones: [],
  });
  expect(a.rig.bones[1]!.id).toBe('upper_arm_L');
  expect(Object.isFrozen(result.entries)).toBe(true);
});

test('effective lengths, direction, local radians and reflections report separately without changing rest poses', () => {
  const a = fixture(),
    b = fixture('target', true, 40);
  const before = JSON.stringify([a, b]);
  expect(codes(analyzeRigCompatibility(a, b, mapping(a, b)))).toEqual(
    expect.arrayContaining(['rest-pose-difference', 'proportion-difference']),
  );
  expect(JSON.stringify([a, b])).toBe(before);
  const rotated: IdentifiedRig = {
    ...b,
    rig: { ...b.rig, bones: b.rig.bones.map((bone) => (bone.parent ? { ...bone, rotation: 0.7, scaleX: -1 } : bone)) },
  };
  expect(codes(analyzeRigCompatibility(a, rotated, mapping(a, rotated)))).toEqual(
    expect.arrayContaining(['orientation-difference', 'rest-reflection-difference']),
  );
  const explicit: IdentifiedRig = {
    id: 'explicit',
    rig: {
      root: 'root',
      bones: [
        { id: 'root', length: 40 },
        { id: 'end', parent: 'root', x: 1 },
      ],
    },
  };
  const effective: IdentifiedRig = {
    id: 'effective',
    rig: {
      root: 'root',
      bones: [
        { id: 'root', length: 40 },
        { id: 'end', parent: 'root', x: 40 },
      ],
    },
  };
  expect(codes(analyzeRigCompatibility(explicit, effective, mapping(explicit, effective)))).not.toContain(
    'rest-pose-difference',
  );
});

test('missing source bones permit a root-connected partial map; extra target branches are reported', () => {
  const a = fixture();
  const shorter: IdentifiedRig = { id: 'short', rig: { ...a.rig, bones: a.rig.bones.slice(0, -1) } };
  const partial = createRigBoneMapping(
    a,
    shorter,
    shorter.rig.bones.map(({ id }) => ({ sourceBoneId: id, targetBoneId: id })),
    'map',
    'Partial',
  );
  expect(validateRigBoneMapping(a, shorter, partial)).toEqual([]);
  expect(analyzeRigCompatibility(a, shorter, partial)).toMatchObject({ level: 'partial', missingBones: ['hand_L'] });
  const extra: IdentifiedRig = {
    id: 'extra',
    rig: { ...a.rig, bones: [...a.rig.bones, { id: 'antenna', parent: 'root', y: -10 }] },
  };
  expect(analyzeRigCompatibility(a, extra, mapping(a, extra))).toMatchObject({
    level: 'mappable',
    extraBones: ['antenna'],
  });
});

test('parent mismatch, inserted chains, missing IDs and duplicate source/target assignments block approval', () => {
  const a = fixture(),
    b = fixture('target');
  const changed: IdentifiedRig = {
    ...b,
    rig: { ...b.rig, bones: b.rig.bones.map((bone) => (bone.id === 'hand_L' ? { ...bone, parent: 'root' } : bone)) },
  };
  expect(validateRigBoneMapping(a, changed, mapping(a, changed)).map(({ code }) => code)).toContain('parent-mismatch');
  expect(codes(analyzeRigCompatibility(a, changed, mapping(a, changed)))).toContain('hierarchy-mismatch');
  const good = mapping(a, b);
  for (const [entry, expected] of [
    [{ sourceBoneId: 'unknown', targetBoneId: 'root' }, 'missing-bone'],
    [{ sourceBoneId: 'root', targetBoneId: 'root' }, 'duplicate-source'],
    [{ sourceBoneId: 'hand_L', targetBoneId: 'root' }, 'duplicate-target'],
  ] as const)
    expect(
      validateRigBoneMapping(a, b, { ...good, entries: [...good.entries, entry] }).map(({ code }) => code),
    ).toContain(expected);
  const orphan = { ...good, entries: good.entries.filter((entry) => entry.sourceBoneId !== 'forearm_L') };
  expect(validateRigBoneMapping(a, b, orphan).map(({ code }) => code)).toContain('unmapped-parent');
  expect(analyzeRigCompatibility(a, b, orphan)).toMatchObject({ level: 'incompatible', directReuse: false });
});

test('ambiguous siblings and competing assignments remain proposals; input order cannot pick a winner', () => {
  const source: IdentifiedRig = {
    id: 'a',
    rig: { root: 'root', bones: [{ id: 'root' }, { id: 'tip', parent: 'root' }] },
  };
  const target: IdentifiedRig = {
    id: 'b',
    rig: { root: 'base', bones: [{ id: 'base' }, { id: 'one', parent: 'base' }, { id: 'two', parent: 'base' }] },
  };
  const proposal = suggestRigBoneMapping(source, target);
  expect(proposal.entries).toEqual([{ sourceBoneId: 'root', targetBoneId: 'base' }]);
  expect(proposal.suggestions.find((entry) => entry.sourceBoneId === 'tip')).toMatchObject({
    ambiguous: true,
    targetBoneIds: ['one', 'two'],
  });
  const competing = suggestRigBoneMapping(target, source);
  expect(competing.entries).toHaveLength(1);
  expect(competing.suggestions.filter((entry) => entry.ambiguous)).toHaveLength(2);
  expect(
    suggestRigBoneMapping(source, { ...target, rig: { ...target.rig, bones: [...target.rig.bones].reverse() } })
      .entries,
  ).toEqual(proposal.entries);
});

test('rig changes invalidate snapshots, serialization is data-only, identity direction matters', () => {
  const a = fixture(),
    b = fixture('target', true);
  const approved = mapping(a, b);
  const restored: RigBoneMapping = rigBoneMappingSchema.parse(JSON.parse(JSON.stringify(approved)));
  expect(validateRigBoneMapping(a, b, restored)).toEqual([]);
  expect(validateRigBoneMapping(b, a, restored).map(({ code }) => code)).toContain('rig-identity');
  const updated = fixture('target', true, 50);
  expect(validateRigBoneMapping(a, updated, restored).map(({ code }) => code)).toContain('stale-mapping');
  expect(analyzeRigCompatibility(a, updated, restored)).toMatchObject({
    level: 'incompatible',
    mappingValid: false,
    directReuse: false,
  });
  expect(validateRigBoneMapping(a, updated, mapping(a, updated))).toEqual([]);
  expect(rigCompatibilityRevision(a.rig)).toBe(
    rigCompatibilityRevision({ ...a.rig, bones: [...a.rig.bones].reverse() }),
  );
  expect(() => rigBoneMappingSchema.parse({ ...approved, runtime: new Rig(a.rig) })).toThrow();
});

test('a partial or permuted self mapping cannot grant exact reuse', () => {
  const a: IdentifiedRig = {
    id: 'a',
    rig: { root: 'root', bones: [{ id: 'root' }, { id: 'a', parent: 'root' }, { id: 'b', parent: 'root' }] },
  };
  const partial = createRigBoneMapping(a, a, [{ sourceBoneId: 'root', targetBoneId: 'root' }], 'partial', 'Partial');
  expect(analyzeRigCompatibility(a, a, partial)).toMatchObject({ level: 'partial', directReuse: false });
  const permuted = createRigBoneMapping(
    a,
    a,
    [
      { sourceBoneId: 'root', targetBoneId: 'root' },
      { sourceBoneId: 'a', targetBoneId: 'b' },
      { sourceBoneId: 'b', targetBoneId: 'a' },
    ],
    'swap',
    'Swapped',
  );
  expect(analyzeRigCompatibility(a, a, permuted)).toMatchObject({ level: 'mappable', directReuse: false });
});

function ikFixture(id: string, name = 'arm', length = 20): IdentifiedRig {
  const source = fixture(id, false, length);
  return {
    ...source,
    rig: {
      ...source.rig,
      ik: [{ name, rootBone: 'upper_arm_L', middleBone: 'forearm_L', endBone: 'hand_L', target: { x: 20, y: 20 } }],
    },
  };
}

test('IK differences are independent of bone correspondence, including targets, lengths and constraint IDs', () => {
  const a = ikFixture('a'),
    b = ikFixture('b', 'reach', 40);
  const noTarget: IdentifiedRig = {
    ...b,
    rig: { ...b.rig, ik: b.rig.ik!.map(({ target: _target, ...chain }) => chain) },
  };
  expect(codes(analyzeRigCompatibility(a, noTarget, mapping(a, noTarget)))).toEqual(
    expect.arrayContaining([
      'ik-identity-difference',
      'ik-length-difference',
      'missing-ik-target',
      'ik-track-transfer-unsupported',
    ]),
  );
  expect(analyzeRigCompatibility(a, noTarget, mapping(a, noTarget)).level).toBe('partial');
  const plain = fixture('b');
  expect(codes(analyzeRigCompatibility(a, plain, mapping(a, plain)))).toContain('missing-ik-chain');
  expect(codes(analyzeRigCompatibility(plain, a, mapping(plain, a)))).toContain('extra-ik-chain');
  expect(analyzeRigCompatibility(a, a)).toMatchObject({ level: 'exact', ikDiagnostics: [] });
});

test('foot markers are compared by stable ID, mapped bone and local coordinates', () => {
  const base = fixture('a');
  const a: IdentifiedRig = {
    ...base,
    rig: { ...base.rig, footContactMarkers: [{ id: 'contact', name: 'Sole', boneId: 'hand_L', localX: 1, localY: 2 }] },
  };
  const b = fixture('b');
  expect(codes(analyzeRigCompatibility(a, b, mapping(a, b)))).toContain('foot-marker-difference');
  expect(codes(analyzeRigCompatibility(b, a, mapping(b, a)))).toContain('extra-foot-marker');
});

test('mesh topology and binding differences forbid deformation transfer even with a complete bone map', () => {
  const base: RigDefinition = { root: 'root', bones: [{ id: 'root' }], slots: [{ id: 'paper', bone: 'root' }] };
  const mesh = createRectangleMeshAttachment({ id: 'mesh', texture: 'paper' }, { width: 20, height: 20 }, base, 'root');
  const a: IdentifiedRig = { id: 'a', rig: { ...base, attachments: [mesh] } };
  const b: IdentifiedRig = {
    id: 'b',
    rig: {
      ...base,
      attachments: [{ ...mesh, vertices: mesh.vertices.map((vertex) => ({ ...vertex, u: vertex.u * 0.8 })) }],
    },
  };
  const report = analyzeRigCompatibility(a, b, mapping(a, b));
  expect(report.level).toBe('partial');
  expect(codes(report)).toEqual(
    expect.arrayContaining(['mesh-topology-difference', 'deformation-transfer-unsupported']),
  );
  expect(codes(analyzeRigCompatibility(a, { ...a, id: 'copy' }, mapping(a, { ...a, id: 'copy' })))).toContain(
    'deformation-transfer-unsupported',
  );
  expect(analyzeRigCompatibility(a, a)).toMatchObject({ level: 'exact', meshDiagnostics: [] });
});

test('arbitrary non-humanoid chains need no anatomy metadata', () => {
  const a: IdentifiedRig = {
    id: 'worm',
    rig: {
      root: 'head',
      bones: [{ id: 'head' }, { id: 'segment', parent: 'head', y: 20 }, { id: 'tail', parent: 'segment', y: 10 }],
    },
  };
  const b: IdentifiedRig = {
    id: 'tentacle',
    rig: {
      root: 'base',
      bones: [{ id: 'base' }, { id: 'middle', parent: 'base', y: 40 }, { id: 'tip', parent: 'middle', y: 30 }],
    },
  };
  expect(suggestRigBoneMapping(a, b).entries).toHaveLength(3);
  expect(analyzeRigCompatibility(a, b, mapping(a, b)).level).toBe('mappable');
});
