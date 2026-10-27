import { readFileSync } from 'node:fs';
import { assert, expect, test, vi } from 'vitest';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { buildCharacterPackage, validatePackage } from '../src/devtools/shared/package/characterPackage.js';
import { serializeRigDefinition } from '../src/engine/authoredSerialization.js';
import { CharacterDefinition, validateCharacterDefinition } from '../src/engine/CharacterDefinition.js';
import { parseRigDefinition, validateRigDefinition } from '../src/engine/externalData.js';
import { inspectImageHeader } from '../src/engine/imageHeader.js';
import {
  bindPoseToMeshAttachment,
  createRectangleMeshAttachment,
  meshAttachmentToBindPose,
  meshBindPoseToBoneLocal,
  validateMeshBindPose,
  replaceMeshGeometry,
} from '../src/engine/meshAttachments.js';
import {
  attachmentLocalToImagePixel,
  getMeshVertex,
  imagePixelToAttachmentLocal,
  imagePixelToUV,
  MESH_AREA_EPSILON,
  MESH_LIMITS,
  meshBounds,
  triangleSignedArea2,
  uvToImagePixel,
  validateMeshTopology,
} from '../src/engine/meshGeometry.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { Puppet } from '../src/engine/Puppet.js';
import { Rig } from '../src/engine/Rig.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';
import { attachmentSchema } from '../src/engine/schemas.js';
import { SlotState } from '../src/engine/SlotState.js';
import type {
  JointTransform,
  MeshAttachmentDefinition,
  RigDefinition,
  SpriteAttachmentDefinition,
} from '../src/engine/types.js';
import { puppetScene } from './helpers/puppetScene.js';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
    GameObjects: { Events: { DESTROY: 'destroy' } },
  },
}));

const rest: RigDefinition = {
  root: 'root',
  bones: [
    { id: 'root', x: 100, y: -20, length: 50 },
    { id: 'child', parent: 'root', x: 3, y: 4 },
  ],
  slots: [
    { id: 'art', bone: 'child', x: 4, y: -5, depth: 3 },
    { id: 'other', bone: 'root', depth: 2 },
  ],
};
const sprite: SpriteAttachmentDefinition = {
  id: 'cloth',
  texture: 'paper',
  x: 11,
  y: -7,
  rotation: 0.2,
  scaleX: -2,
  scaleY: 1.5,
  originX: 0.25,
  originY: 0.75,
  groundContacts: [{ x: 0.5, y: 1 }],
};
function mesh() {
  return createRectangleMeshAttachment(sprite, { width: 80, height: 40 }, rest);
}
function rigFile(attachment: MeshAttachmentDefinition = mesh()) {
  return {
    version: 1 as const,
    ...rest,
    attachments: [attachment, { id: 'rigid', texture: 'paper' }],
    skins: [
      { version: 1 as const, name: 'default', slots: { art: attachment.id, other: 'rigid' } },
      { version: 1 as const, name: 'hidden', slots: { art: null } },
    ],
  };
}

test('rectangle retains image alignment, pivot, transforms, IDs and clockwise UVs without mutating the sprite', () => {
  const before = structuredClone(sprite);
  const value = mesh();
  assert.deepEqual(sprite, before);
  assert.deepEqual(value.vertices, [
    { id: 'top-left', x: -20, y: -30, u: 0, v: 0 },
    { id: 'top-right', x: 60, y: -30, u: 1, v: 0 },
    { id: 'bottom-right', x: 60, y: 10, u: 1, v: 1 },
    { id: 'bottom-left', x: -20, y: 10, u: 0, v: 1 },
  ]);
  assert.deepEqual(value.triangles, [0, 1, 2, 0, 2, 3]);
  for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'originX', 'originY', 'groundContacts'] as const)
    assert.deepEqual(value[key], sprite[key]);
  assert.deepEqual(validateMeshTopology(value), []);
  assert.equal(getMeshVertex(value, 'top-right'), value.vertices[1]);
  assert.isUndefined(getMeshVertex(value, 'missing'));
  assert.deepEqual(meshBounds(value), { minX: -20, minY: -30, maxX: 60, maxY: 10, width: 80, height: 40 });
  assert.isUndefined(meshBounds({ vertices: [] }));
  const defaults = createRectangleMeshAttachment({ id: 'plain', texture: 'paper' }, { width: 2, height: 4 }, rest);
  assert.deepEqual(defaults.vertices[0], { id: 'top-left', x: -1, y: -2, u: 0, v: 0 });
});

test('pixel, UV and pivot conversions round trip negative local coordinates without viewport state', () => {
  const pixel = { x: 12, y: 9 };
  assert.deepEqual(imagePixelToUV(pixel, 80, 40), { u: 0.15, v: 0.225 });
  assert.deepEqual(uvToImagePixel({ u: 0.15, v: 0.225 }, 80, 40), pixel);
  const local = imagePixelToAttachmentLocal(pixel, 80, 40, 0.25, 0.75);
  assert.deepEqual(local, { x: -8, y: -21 });
  assert.deepEqual(attachmentLocalToImagePixel(local, 80, 40, 0.25, 0.75), pixel);
  assert.throws(() => imagePixelToUV(pixel, 0, 40), /dimensions/);
  assert.throws(() => meshAttachmentToBindPose(mesh(), 'missing', local), /slot/);
});

test.each([
  {
    name: 'duplicate vertex IDs',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, vertices: m.vertices.map((v) => ({ ...v, id: 'duplicate' })) }),
    error: /duplicate vertex/,
  },
  {
    name: 'missing vertex',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, triangles: [0, 1, 4] }),
    error: /missing vertex/,
  },
  {
    name: 'negative index',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, triangles: [0, 1, -1] }),
    error: /missing vertex/,
  },
  {
    name: 'fractional index',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, triangles: [0, 1, 1.5] }),
    error: /missing vertex/,
  },
  {
    name: 'incomplete triple',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, triangles: [0, 1] }),
    error: /triples/,
  },
  { name: 'empty topology', mutate: (m: MeshAttachmentDefinition) => ({ ...m, triangles: [] }), error: /triples/ },
  {
    name: 'repeated index',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, triangles: [0, 1, 1] }),
    error: /nondegenerate/,
  },
  {
    name: 'wrong winding',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, triangles: [0, 2, 1] }),
    error: /clockwise/,
  },
  {
    name: 'collinear',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, vertices: m.vertices.map((v) => ({ ...v, y: 0 })) }),
    error: /nondegenerate/,
  },
  {
    name: 'nonfinite position',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, vertices: m.vertices.map((v) => ({ ...v, x: Infinity })) }),
    error: /finite/,
  },
  {
    name: 'invalid UV',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, vertices: m.vertices.map((v) => ({ ...v, u: -0.1 })) }),
    error: /UVs/,
  },
  {
    name: 'NaN UV',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, vertices: m.vertices.map((v) => ({ ...v, v: NaN })) }),
    error: /UVs/,
  },
  {
    name: 'coordinate limit',
    mutate: (m: MeshAttachmentDefinition) => ({
      ...m,
      vertices: m.vertices.map((v) => ({ ...v, x: MESH_LIMITS.coordinate + 1 })),
    }),
    error: /limits/,
  },
  {
    name: 'duplicate triangles',
    mutate: (m: MeshAttachmentDefinition) => ({ ...m, triangles: [0, 1, 2, 0, 1, 2] }),
    error: /overlap/,
  },
])('$name is rejected by topology validation and rig import', ({ mutate, error }) => {
  const invalid = mutate(mesh());
  assert.match(
    validateMeshTopology(invalid)
      .map((issue) => issue.message)
      .join(' '),
    error,
  );
  assert.throws(() => new Rig(rigFile(invalid)));
  assert.isAbove(validateRigDefinition(rigFile(invalid)).length, 0);
});

test('area tolerance rejects almost flat triangles and accepts ordinary triangles in negative coordinates', () => {
  const value = mesh();
  const vertices = [
    { id: 'a', x: -1, y: -1, u: 0, v: 0 },
    { id: 'b', x: 0, y: -1, u: 1, v: 0 },
    { id: 'c', x: -1, y: -1 + MESH_AREA_EPSILON / 2, u: 0, v: 1 },
  ];
  assert.isAbove(validateMeshTopology({ ...value, vertices, triangles: [0, 1, 2] }).length, 0);
  assert.isAbove(triangleSignedArea2(value.vertices[0]!, value.vertices[1]!, value.vertices[2]!), 0);
});

test('intersection checks reject crossing and contained interiors while accepting a subdivided rectangle', () => {
  const value = mesh();
  const vertices = [...value.vertices, { id: 'center', x: 20, y: -10, u: 0.5, v: 0.5 }];
  const subdivided = { ...value, vertices, triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4] };
  assert.deepEqual(validateMeshTopology(subdivided), []);
  assert.deepEqual(new Rig(rigFile(subdivided)).attachments[0], subdivided);
  const replaced = replaceMeshGeometry(value, subdivided, rest);
  assert.deepEqual(replaced.bindPose, value.bindPose);
  assert.deepEqual(replaced.vertices.slice(0, 4), value.vertices);
  assert.equal(value.vertices.length, 4);
  assert.throws(() => replaceMeshGeometry(value, { vertices, triangles: [0, 1, 99] }, rest), /missing vertex/);
  for (const points of [
    [
      { x: 0, y: -29 },
      { x: 59, y: -20 },
      { x: 20, y: 9 },
    ],
    [
      { x: -30, y: -20 },
      { x: 70, y: -20 },
      { x: 20, y: 20 },
    ],
  ]) {
    const extra = points.map((point, index) => ({ ...point, id: `extra-${index}`, u: 0.5, v: 0.5 }));
    assert.match(
      validateMeshTopology({
        ...value,
        vertices: [...value.vertices, ...extra],
        triangles: [...value.triangles, 4, 5, 6],
      })[0]!.message,
      /overlap/,
    );
  }
});

test('size limits and unsupported mesh/bind/rig versions, frames and unknown variants fail import', () => {
  for (const value of [
    { ...mesh(), meshVersion: 2 },
    { ...mesh(), bindPose: { ...mesh().bindPose, version: 2 } },
    { ...mesh(), frame: 'atlas' },
    { ...mesh(), type: 'future' },
    {
      ...mesh(),
      vertices: Array.from({ length: MESH_LIMITS.vertices + 1 }, (_, i) => ({ id: `${i}`, x: i, y: i, u: 0, v: 0 })),
    },
    { ...mesh(), triangles: Array.from({ length: (MESH_LIMITS.triangles + 1) * 3 }, () => 0) },
  ])
    assert.isFalse(attachmentSchema.safeParse(value).success);
  assert.throws(() => parseRigDefinition({ ...rigFile(), version: 2 }), /Unsupported rig format version/);
  assert.throws(
    () => createRectangleMeshAttachment({ ...sprite, frame: 0 }, { width: 80, height: 40 }, rest),
    /whole image/,
  );
  assert.throws(() => createRectangleMeshAttachment(sprite, { width: 0, height: 40 }, rest));
});

function apply(point: { x: number; y: number }, transform: Partial<JointTransform>) {
  const x = point.x * (transform.scaleX ?? 1),
    y = point.y * (transform.scaleY ?? 1),
    r = transform.rotation ?? 0;
  return {
    x: (transform.x ?? 0) + x * Math.cos(r) - y * Math.sin(r),
    y: (transform.y ?? 0) + x * Math.sin(r) + y * Math.cos(r),
  };
}

test('bind coordinates compose effective rest bones, slot and attachment with mirrored/nonuniform scales', () => {
  const rig: RigDefinition = {
    ...rest,
    bones: [
      { ...rest.bones[0]!, rotation: 0.7, scaleX: -1.4, scaleY: 0.7 },
      { ...rest.bones[1]!, rotation: -0.2, scaleX: 0.8, scaleY: 1.3 },
    ],
  };
  const value = createRectangleMeshAttachment(sprite, { width: 80, height: 40 }, rig);
  const point = value.vertices[0]!;
  const expected = apply(
    apply(apply(apply(point, sprite), rest.slots![0]!), { ...rig.bones[1]!, x: 30, y: 40 }),
    rig.bones[0]!,
  );
  const bind = meshAttachmentToBindPose(value, 'art', point);
  assert.closeTo(bind.x, expected.x, 1e-10);
  assert.closeTo(bind.y, expected.y, 1e-10);
  const local = bindPoseToMeshAttachment(value, 'art', bind)!;
  assert.closeTo(local.x, point.x, 1e-10);
  assert.closeTo(local.y, point.y, 1e-10);
  const boneLocal = meshBindPoseToBoneLocal(value, 'child', bind)!;
  const expectedBone = apply(apply(point, sprite), rest.slots![0]!);
  assert.closeTo(boneLocal.x, expectedBone.x, 1e-10);
  assert.closeTo(boneLocal.y, expectedBone.y, 1e-10);
});

test('bind snapshots normalize omitted defaults and lengths, survive ordering, and reject rest edits', () => {
  const value = mesh();
  assert.deepEqual(
    value.bindPose.bones.find((bone) => bone.id === 'child'),
    {
      id: 'child',
      parent: 'root',
      x: 30,
      y: 40,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
  );
  assert.deepEqual(validateMeshBindPose(value, { ...rest, bones: [...rest.bones].reverse() }), []);
  const rig = new Rig(rigFile());
  assert.deepEqual(validateMeshBindPose(value, rig), []);
  assert.isTrue(Object.isFrozen(rig.attachments[0]));
  const owned = rig.getAttachment('cloth');
  assert.isTrue(owned.type === 'mesh' && Object.isFrozen(owned.vertices) && Object.isFrozen(owned.bindPose.bones[0]));
  const changed = {
    ...rigFile(),
    bones: rest.bones.map((bone) => (bone.id === 'root' ? { ...bone, rotation: 1 } : bone)),
  };
  assert.throws(() => new Rig(changed), /bind pose/);
  assert.throws(() => new Rig({ ...rigFile(), slots: rest.slots!.map((slot) => ({ ...slot, x: 99 })) }), /bind pose/);
  assert.throws(() => new Rig(rigFile({ ...value, x: 99 })), /bind pose/);
  assert.throws(() => new Rig(rigFile({ ...value, bindPose: { ...value.bindPose, bones: [] } })));
  const editor = new RigEditorState(rig, rigFile());
  const before = editor.workingCopy;
  assert.throws(() => editor.editBone('root', 'rotation', 1), /bind pose/);
  assert.deepEqual(editor.workingCopy, before);
  assert.throws(() => editor.editSlot('art', 'x', 99), /bind pose/);
  assert.deepEqual(editor.workingCopy, before);
  assert.throws(() => editor.editSprite('cloth', 'originX', 0.5, true), /baked/);
});

test('normalization of non-axis-aligned length offsets remains compatible with runtime slot catalogs', () => {
  const rig: RigDefinition = {
    ...rest,
    bones: [
      { id: 'root', length: 37.13 },
      { id: 'child', parent: 'root', x: 1.1234, y: -3.919 },
    ],
  };
  const value = createRectangleMeshAttachment(sprite, { width: 80, height: 40 }, rig);
  const state = new SlotState(new Rig({ ...rig, attachments: [value] }));
  state.setAttachment('art', 'cloth');
  assert.equal(state.getAttachment('art'), 'cloth');
});

test('mixed rigs retain legacy omitted types, ordering, skins, visibility and immutable mesh selections', () => {
  const file = rigFile();
  const serialized = serializeRigDefinition(file);
  assert.equal(serializeRigDefinition({ ...file, bones: file.bones.map((bone) => ({ ...bone })) }), serialized);
  const parsed = parseRigDefinition(JSON.parse(serialized));
  assert.deepEqual(parsed.attachments, file.attachments);
  const rig = new Rig(parsed);
  const state = new SlotState(rig);
  state.setSkin('default');
  assert.equal(state.getAttachment('art'), 'cloth');
  assert.equal(state.getDefinition('cloth').type, 'mesh');
  const selected = state.getDefinition('cloth');
  assert.isTrue(selected.type === 'mesh' && Object.isFrozen(selected.vertices[0]));
  state.setSkin('hidden');
  assert.isUndefined(state.getAttachment('art'));
  state.setAttachment('art', 'rigid');
  assert.equal(state.getAttachment('art'), 'rigid');
  assert.throws(
    () => state.updateDefinitions([mesh(), { ...mesh(), id: 'bad', triangles: [0, 1, 99] }], []),
    /missing vertex/,
  );
  assert.equal(state.getAttachment('art'), 'rigid');
  const legacy = {
    version: 1 as const,
    root: 'root',
    bones: [{ id: 'root' }],
    attachments: [{ id: 'sprite', texture: 'paper' }],
  };
  assert.deepEqual(parseRigDefinition(JSON.parse(serializeRigDefinition(legacy))).attachments, legacy.attachments);
  assert.notProperty(new Rig(legacy).getAttachment('sprite'), 'type');
});

test('Puppet renders native textured meshes alongside rigid artwork with safe skin switching', () => {
  const puppet = new Puppet(puppetScene(), { rig: rigFile(), skin: 'default', autoUpdate: false });
  assert.equal(puppet.getAttachment('art'), 'cloth');
  assert.isUndefined(puppet.getSlotImage('art'));
  assert.exists(puppet.getSlotMesh('art'));
  assert.equal(puppet.getSlotImage('other')!.texture.key, 'paper');
  puppet.setAttachment('art', 'rigid');
  assert.exists(puppet.getSlotImage('art'));
  puppet.setAttachment('art', 'cloth');
  assert.isUndefined(puppet.getSlotImage('art'));
  assert.exists(puppet.getSlotMesh('art'));
  puppet.setSkin('hidden');
  assert.isUndefined(puppet.getAttachment('art'));
  puppet.setSkin('default');
  const before = structuredClone(mesh().bindPose);
  puppet.setBoneRotation('root', 1.3);
  puppet.update(100);
  const selected = puppet.rig.getAttachment('cloth');
  assert.isTrue(selected.type === 'mesh');
  if (selected.type === 'mesh') assert.deepEqual(selected.bindPose, before);
  puppet.destroy();
});

const png = new Uint8Array(
  readFileSync(new URL('../public/characters/demo-puppet/images/paper-head.png', import.meta.url)),
);
function characterData() {
  const header = inspectImageHeader(png)!;
  const value = createRectangleMeshAttachment(sprite, header, rest);
  return {
    manifest: {
      version: 1,
      id: 'mesh-hero',
      rig: 'rig.json',
      defaultSkin: 'default',
      skins: { default: 'skin.json' },
      animations: [],
      textures: { paper: 'image.png' },
    },
    rig: rigFile(value),
    skins: { 'skin.json': rigFile(value).skins[0] },
  };
}

test('character validation rejects missing mesh image references', () => {
  const data = characterData();
  assert.deepEqual(validateCharacterDefinition(data), []);
  const issues = validateCharacterDefinition({ ...data, manifest: { ...data.manifest, textures: {} } });
  assert.isTrue(
    issues.some((issue) => issue.path === 'rig.attachments[0].texture' && /Missing texture/.test(issue.message)),
  );
});

test('mesh data survives deterministic character ZIP and project export/import; corrupt imports fail', async () => {
  const definition = CharacterDefinition.fromData(characterData());
  const fetcher: typeof fetch = () => Promise.resolve(new Response(png));
  const snapshot = {
    definition,
    rig: definition.rigFile!,
    skins: definition.standaloneSkins,
    animations: [],
    replacements: [],
  };
  const files = await buildCharacterPackage(snapshot, fetcher);
  const loaded = await validatePackage(decodePackageZip(encodePackageZip(files)));
  assert.deepEqual(loaded.rigFile, definition.rigFile);
  const project = new ProjectWorkspace('Mesh project');
  await project.addCharacter(files);
  const exported = await buildProjectPackage(project);
  const imported = await importProjectPackage(decodePackageZip(encodePackageZip(exported.files)));
  assert.deepEqual(imported.captureCharacter('mesh-hero').rig, definition.rigFile);
  assert.deepEqual((await buildProjectPackage(imported)).files, exported.files);
  const bad = new Map(files);
  bad.set('rig.json', new TextEncoder().encode(JSON.stringify(rigFile({ ...mesh(), triangles: [0, 1, 99] }))));
  await expect(validatePackage(bad)).rejects.toThrow(/missing vertex/);
  bad.set('rig.json', files.get('rig.json')!);
  bad.delete('image.png');
  await expect(validatePackage(bad)).rejects.toThrow(/image.png/);
});

test('mesh image dimensions and replacement pivots are checked before package export/import', async () => {
  const definition = CharacterDefinition.fromData(characterData());
  const fetcher: typeof fetch = () => Promise.resolve(new Response(png));
  const snapshot = {
    definition,
    rig: definition.rigFile!,
    skins: definition.standaloneSkins,
    animations: [],
    replacements: [],
  };
  const files = await buildCharacterPackage(snapshot, fetcher);
  const data = characterData();
  const value = createRectangleMeshAttachment(sprite, inspectImageHeader(png)!, rest);
  const bad = new Map(files);
  bad.set(
    'rig.json',
    new TextEncoder().encode(
      JSON.stringify({
        ...data.rig,
        attachments: [
          { ...value, imageSize: { ...value.imageSize, width: value.imageSize.width + 1 } },
          data.rig.attachments[1],
        ],
      }),
    ),
  );
  await expect(validatePackage(bad)).rejects.toThrow(/image dimensions/);
  const replacement = {
    assetKey: 'paper',
    reference: undefined,
    blob: new Blob([png]),
    format: 'image/png' as const,
    originScaleX: 1,
    originScaleY: 1,
  };
  const replaced = await buildCharacterPackage({ ...snapshot, replacements: [replacement] }, fetcher);
  assert.deepEqual((await validatePackage(replaced)).rigFile!.attachments![0], definition.rigFile!.attachments![0]);
  await expect(
    buildCharacterPackage({ ...snapshot, replacements: [{ ...replacement, originScaleX: 2 }] }, fetcher),
  ).rejects.toThrow(/dimensions and pivot/);
});

test('scene packages retain mesh geometry and enforce image dimensions', async () => {
  const definition = CharacterDefinition.fromData(characterData(), 'https://mesh.invalid/');
  const files = await buildScenePackage(
    {
      version: 2,
      id: 'mesh-scene',
      name: 'Mesh scene',
      duration: 1000,
      actors: [{ id: 'hero', character: { manifest: 'character.json' }, position: { x: -10, y: 20 } }],
      actions: [],
    },
    {
      baseUrl: 'https://mesh.invalid/scene.json',
      fetcher: () => Promise.resolve(new Response(png)),
      loadCharacter: () => Promise.resolve(definition),
    },
  );
  const resolved = await validateScenePackage(decodePackageZip(encodePackageZip(files)));
  assert.deepEqual([...resolved.characters.values()][0]!.rigFile, definition.rigFile);
  const bad = new Map(files);
  const imagePath = [...files.keys()].find((path) => path.endsWith('/image.png'))!;
  const changed = new Uint8Array(png);
  new DataView(changed.buffer).setUint32(16, 1);
  bad.set(imagePath, changed);
  await expect(validateScenePackage(bad)).rejects.toThrow(/image dimensions/);
});

test('rectangle creation rejects invalid rig references and singular or overflowing rest transforms', () => {
  for (const rig of [
    { ...rest, root: 'absent' },
    { ...rest, bones: [{ id: 'root', scaleX: 0 }] },
    {
      ...rest,
      bones: [
        { id: 'root', scaleX: 1e200 },
        { id: 'child', parent: 'root', scaleX: 1e200 },
      ],
    },
  ])
    assert.throws(() => createRectangleMeshAttachment(sprite, { width: 80, height: 40 }, rig));
});
