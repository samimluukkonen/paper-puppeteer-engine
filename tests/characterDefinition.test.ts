import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { assert, test, vi } from 'vitest';
import { demoIK } from '../src/demo/demoIK.js';
import { demoHipPositions, demoRenderOrder } from '../src/demo/demoPresentation.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import {
  CharacterDefinition,
  CharacterValidationError,
  validateCharacterDefinition,
} from '../src/engine/CharacterDefinition.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import * as externalData from '../src/engine/externalData.js';
import { checkJson, type ValidationIssue } from '../src/engine/externalData.js';
import { TwoBoneIKConstraint } from '../src/engine/ik/TwoBoneIKConstraint.js';
import { Joint } from '../src/engine/Joint.js';
import { queueCharacterTextures } from '../src/engine/queueCharacterTextures.js';
import { SlotState } from '../src/engine/SlotState.js';
import { animationClipSchema, rigDefinitionSchema } from '../src/engine/schemas.js';
import type { RigDefinition } from '../src/engine/types.js';

const root = new URL('../public/characters/demo-puppet/', import.meta.url);
const files = import.meta.glob('../public/characters/demo-puppet/**/*.json', { eager: true, import: 'default' });
const images = import.meta.glob('../public/characters/demo-puppet/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const read = (path: string): unknown => {
  const file = files[`../public/characters/demo-puppet/${path}`];
  if (!file) throw new Error(`Missing sample file ${path}`);
  return structuredClone(file);
};
const manifest = read('character.json') as {
  rig: string;
  skins: Record<string, string>;
  animations: string[];
  poses?: string[];
  textures: Record<string, string>;
  defaultSkin: string;
};
const bundle = () => ({
  manifest: structuredClone(manifest),
  rig: read(manifest.rig),
  skins: Object.fromEntries(Object.values(manifest.skins).map((path) => [path, read(path)])),
  animations: Object.fromEntries(manifest.animations.map((path) => [path, read(path)])),
  poses: Object.fromEntries((manifest.poses ?? []).map((path) => [path, read(path)])),
});

test('character texture and file lookups require own entries', () => {
  const definition = CharacterDefinition.fromData(bundle());
  for (const key of ['toString', 'constructor', '__proto__'])
    assert.throws(() => definition.textureUrl(key), /Unknown character texture/);
  const data = bundle();
  Object.defineProperty(data.manifest.textures, 'toString', { value: 'images/paper-head.png', enumerable: true });
  assert.equal(CharacterDefinition.fromData(data).textureUrl('toString'), 'images/paper-head.png');
  for (const collection of ['skins', 'animations', 'poses'] as const) {
    const inherited = bundle();
    const path = collection === 'skins' ? inherited.manifest.skins.default! : inherited.manifest[collection]![0]!;
    inherited[collection] = Object.create({ [path]: inherited[collection][path] });
    assert.ok(validateCharacterDefinition(inherited).some((issue) => /Missing .* file/.test(issue.message)));
  }
});

test('complete sample character validates and already-parsed data becomes runtime definitions', () => {
  const data = bundle();
  assert.deepEqual(validateCharacterDefinition(data), []);
  const definition = CharacterDefinition.fromData(data);
  assert.equal(definition.id, 'demo-puppet');
  assert.equal(definition.rig.bones.length, 16);
  assert.equal(definition.defaultSkin, 'default');
  assert.equal(definition.rigPath, 'rig.json');
  assert.equal(definition.rigFile?.name, 'paper-puppet');
  assert.equal(definition.rigFile?.skins, undefined);
  assert.deepEqual(
    definition.animations.map((clip) => clip.name),
    ['idle', 'walk', 'sword', 'guardUpperBody'],
  );
  for (const path of Object.values(manifest.textures))
    assert.ok(images[`../public/characters/demo-puppet/${path}`], path);
  assert.ok(definition.rig.attachments.some((attachment) => attachment.id === 'katana'));
  const slots = new SlotState(definition.rig);
  slots.setSkin('default');
  assert.equal(slots.getAttachment('torsoVisual'), 'torsoDefault');
  slots.setSkin('alternate');
  assert.equal(slots.getAttachment('torsoVisual'), 'torsoArmored');
  const joints = new Map(definition.rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
  const player = new AnimationPlayer(definition.rig, joints);
  for (const clip of definition.animations) player.addAnimation(clip);
  for (const chain of demoIK) assert.ok(new TwoBoneIKConstraint(chain, definition.rig, joints));
  assert.notDeepEqual(demoHipPositions(definition.rig, 'left'), demoHipPositions(definition.rig, 'right'));
  assert.notDeepEqual(
    demoRenderOrder(definition.rig, 'walk', 'left'),
    demoRenderOrder(definition.rig, 'walk', 'right'),
  );
  player.play('walk');
  player.update(250);
  assert.notEqual(joints.get('leftThigh')?.pose.rotation, joints.get('rightThigh')?.pose.rotation);
  player.play('idle');
  assert.equal(player.currentAnimation, 'idle');
  player.setPlaybackMode({ mode: 'stepped', fps: 10 });
  player.play('walk');
  player.update(50);
  const firstStep = joints.get('leftThigh')!.pose.rotation;
  player.update(40);
  assert.equal(joints.get('leftThigh')!.pose.rotation, firstStep);
  player.update(20);
  assert.notEqual(joints.get('leftThigh')!.pose.rotation, firstStep);
});

test('character assembly validates the rig once and reuses parsed clips', () => {
  const data = bundle();
  const rigInspection = vi.spyOn(externalData, 'inspectRigDefinition');
  const clipInspection = vi.spyOn(externalData, 'inspectAnimationDefinition');
  const rigValidation = vi.spyOn(rigDefinitionSchema, 'safeParse');
  const rigConstruction = vi.spyOn(rigDefinitionSchema, 'parse');
  const clipValidation = vi.spyOn(animationClipSchema, 'safeParse');
  const clipParsing = vi.spyOn(animationClipSchema, 'parse');
  try {
    const definition = CharacterDefinition.fromData(data);
    assert.equal(rigInspection.mock.calls.length, 1);
    assert.equal(rigValidation.mock.calls.length, 0, 'valid files do not need a fallback runtime parse');
    assert.equal(rigConstruction.mock.calls.length, 1);
    assert.equal(clipInspection.mock.calls.length, manifest.animations.length);
    assert.equal(clipValidation.mock.calls.length, 0, 'strictly parsed clips are reused');
    assert.equal(clipParsing.mock.calls.length, 0);
    assert.equal(definition.animations.length, manifest.animations.length);
    assert.equal(definition.poses.length, manifest.poses!.length);
  } finally {
    vi.restoreAllMocks();
  }
});

test('character assembly preserves embedded skins and lets standalone skins override matching names', () => {
  const data = bundle();
  const embedded = { version: 1 as const, name: 'embedded', slots: { headVisual: 'headDefault' } };
  data.rig = {
    ...(data.rig as RigDefinition),
    skins: [embedded, { version: 1, name: 'default', slots: { headVisual: null } }],
  };
  const definition = CharacterDefinition.fromData(data);
  const slots = new SlotState(definition.rig);
  slots.setSkin('embedded');
  assert.equal(slots.getAttachment('headVisual'), 'headDefault');
  slots.setSkin('default');
  assert.equal(slots.getAttachment('headVisual'), 'headDefault');
  assert.equal(definition.rig.skins.filter((skin) => skin.name === 'default').length, 1);
  assert.deepEqual(definition.rigFile?.skins, (data.rig as RigDefinition).skins);
  assert.deepEqual(CharacterDefinition.fromData({ ...data, rig: definition.rigFile }).rig.skins, definition.rig.skins);
});

test.each([
  ['extra string key', (array: unknown[]) => Object.assign(array, { extra: 'ignored by JSON' })],
  ['noncanonical index', (array: unknown[]) => Object.assign(array, { '01': 'ignored by JSON' })],
  ['symbol key', (array: unknown[]) => Object.assign(array, { [Symbol('extra')]: true })],
  [
    'sparse index',
    (array: unknown[]) => {
      delete array[0];
    },
  ],
  [
    'accessor index',
    (array: unknown[]) =>
      Object.defineProperty(array, '0', {
        enumerable: true,
        get() {
          throw new Error('JSON validation must not invoke getters.');
        },
      }),
  ],
])('character arrays use shared JSON validation for %s', (_name, mutate) => {
  const data = bundle();
  mutate(data.manifest.animations);
  const expected: ValidationIssue[] = [];
  checkJson(data.manifest, 'manifest', expected);
  assert.ok(expected.length);
  assert.deepEqual(validateCharacterDefinition(data), expected);
  assert.throws(() => CharacterDefinition.fromData(data), CharacterValidationError);

  const skinData = bundle();
  skinData.skins[manifest.skins.default!] = data.manifest.animations;
  const skinExpected: ValidationIssue[] = [];
  checkJson(data.manifest.animations, 'skins.default', skinExpected);
  assert.deepEqual(validateCharacterDefinition(skinData), skinExpected);
});

test('character arrays accept nonenumerable numeric indexes preserved by JSON', () => {
  const data = bundle();
  Object.defineProperty(data.manifest.animations, '0', { enumerable: false });
  assert.deepEqual(validateCharacterDefinition(data), []);
  assert.equal(CharacterDefinition.fromData(data).animations.length, manifest.animations.length);
});

test('character validation reports missing rig, default skin, duplicates and broken references', () => {
  const missingRig = bundle();
  delete (missingRig as { rig?: unknown }).rig;
  assert.ok(validateCharacterDefinition(missingRig).some((entry) => entry.path === 'rig'));

  const missingSkin = bundle();
  missingSkin.manifest.defaultSkin = 'absent';
  assert.ok(validateCharacterDefinition(missingSkin).some((entry) => entry.path === 'manifest.defaultSkin'));
  const absentFile = bundle();
  delete absentFile.skins[manifest.skins.default!];
  assert.ok(validateCharacterDefinition(absentFile).some((entry) => entry.path === 'skins.default'));

  const duplicate = bundle();
  duplicate.manifest.animations.push(manifest.animations[0]!);
  assert.ok(validateCharacterDefinition(duplicate).some((entry) => /Duplicate animation name/.test(entry.message)));

  const invalid = bundle();
  const rig = invalid.rig as { attachments: { texture: string }[] };
  rig.attachments[0]!.texture = 'missing-image';
  const skin = invalid.skins[manifest.skins.default!] as { slots: Record<string, string> };
  skin.slots.ghost = 'unknown';
  const walk = invalid.animations['animations/walk.json'] as { tracks: Record<string, unknown> };
  walk.tracks.ghost = [{ time: 0, rotation: 1 }];
  const issues = validateCharacterDefinition(invalid);
  assert.ok(issues.some((entry) => entry.path?.includes('attachments') && /Missing texture/.test(entry.message)));
  assert.ok(issues.some((entry) => /Unknown slot/.test(entry.message)));
  assert.ok(issues.some((entry) => /unknown bone/.test(entry.message)));
  assert.throws(() => CharacterDefinition.fromData(invalid), CharacterValidationError);
});

test('character manifest rejects unsupported versions', () => {
  const data = bundle();
  (data.manifest as typeof manifest & { version: number }).version = 2;
  assert.ok(validateCharacterDefinition(data).some((entry) => entry.path === 'manifest.version'));
});

test.each([
  ['slot', { torsoVisual: 'torsoDefault' }],
  ['description', 'Default appearance'],
])('standalone skin validation rejects unknown field "%s"', (field, value) => {
  const data = bundle();
  const path = manifest.skins.default!;
  data.skins[path] = { ...(data.skins[path] as object), [field]: value };

  const issues = validateCharacterDefinition(data);
  assert.ok(
    issues.some(
      (entry) => entry.severity === 'error' && entry.path === 'skins.default' && entry.message.includes(field),
    ),
  );
  assert.throws(() => CharacterDefinition.fromData(data), CharacterValidationError);
});

test('standalone skin validation accepts slot mappings and null attachments', () => {
  const data = bundle();
  const skin = data.skins[manifest.skins.default!] as { slots: Record<string, string | null> };
  skin.slots.torsoVisual = null;

  assert.deepEqual(validateCharacterDefinition(data), []);
  const definition = CharacterDefinition.fromData(data);
  const slots = new SlotState(definition.rig);
  slots.setSkin('default');
  assert.equal(slots.getAttachment('torsoVisual'), null);
  assert.equal(slots.getAttachment('headVisual'), 'headDefault');
});

test('character validation checks pose files against the loaded rig', () => {
  const data = bundle();
  const path = manifest.poses![0]!;
  (data.poses[path] as { bones: Record<string, unknown> }).bones.ghost = { rotation: 1 };
  assert.ok(validateCharacterDefinition(data).some((entry) => /Unknown bone/.test(entry.message)));
  (data.poses[path] as { version: number; bones: Record<string, unknown> }).version = 2;
  assert.ok(validateCharacterDefinition(data).some((entry) => /Unsupported pose format version/.test(entry.message)));
});

test('loader fetches JSON relative to the manifest and leaves image loading to the host', async () => {
  const requested: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    const target = new URL(String(url));
    requested.push(target.pathname);
    const path = target.href.slice(root.href.length);
    return new Response(JSON.stringify(read(path)), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const definition = await CharacterLoader.load(new URL('character.json', root).href, fetcher);
  assert.equal(definition.animations.length, 4);
  assert.equal(definition.poses[0]?.name, 'combat-ready');
  assert.equal(
    requested.length,
    1 + 1 + Object.keys(manifest.skins).length + manifest.animations.length + (manifest.poses?.length ?? 0),
  );
  assert.equal(definition.textureUrl('paper-head'), new URL('images/paper-head.png', root).href);
  assert.ok(requested.every((path) => path.endsWith('.json')));
});

test('Phaser queue uses stable texture keys and preserves host-preloaded atlas keys', () => {
  const definition = CharacterDefinition.fromData(bundle(), root.href);
  const queued: [string, string][] = [];
  const scene = {
    textures: { exists: (key: string) => key === 'paper-head' },
    load: Object.assign(new EventEmitter(), { image: (key: string, url: string) => queued.push([key, url]) }),
    events: new EventEmitter(),
  } as unknown as Phaser.Scene;
  queueCharacterTextures(scene, definition);
  assert.equal(queued.length, Object.keys(manifest.textures).length - 1);
  assert.ok(!queued.some(([key]) => key === 'paper-head'));
  assert.deepEqual(
    queued.find(([key]) => key === 'paper-torso'),
    ['paper-torso', new URL('images/paper-torso.png', root).href],
  );
});
