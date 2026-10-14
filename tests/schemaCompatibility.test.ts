import { readFile } from 'node:fs/promises';
import { assert, expect, test, vi } from 'vitest';
import { AnimationEditorDocument } from '../src/devtools/animation-editor/AnimationEditorDocument.js';
import { inspectRigDraft } from '../src/devtools/rig-editor/rigDraftRecovery.js';
import { RigEditorState } from '../src/devtools/rig-editor/RigEditorState.js';
import { draftSource, sameDraftSource } from '../src/devtools/shared/draftSource.js';
import { loadPackageDefinition } from '../src/devtools/shared/package/characterPackage.js';
import { packagePath } from '../src/devtools/shared/package/packageZip.js';
import { compileClip } from '../src/engine/AnimationClip.js';
import { AnimationPlayer } from '../src/engine/AnimationPlayer.js';
import { evaluateClip } from '../src/engine/AnimationPose.js';
import { collectAnimationEvents, collectAnimationStartEvents } from '../src/engine/animationTimeline.js';
import { CharacterDefinition, type CharacterData } from '../src/engine/CharacterDefinition.js';
import { CharacterLoader } from '../src/engine/CharacterLoader.js';
import { commitIKBake } from '../src/engine/ik/IKBakeCommit.js';
import { generateBakedBoneKeys } from '../src/engine/ik/IKBakeGeneration.js';
import { sampleIKBake } from '../src/engine/ik/IKBakeSampling.js';
import { IsolatedIKSampler } from '../src/engine/ik/IsolatedIKSampler.js';
import { Joint } from '../src/engine/Joint.js';
import {
  characterManifestSchema,
  parseAnimationClip,
  serializeAnimationDefinition,
  serializeCharacterManifest,
  serializeRigDefinition,
  serializeSkinDefinition,
  validateCharacterDefinition,
} from '../src/engine/serialization.js';
import { SlotState } from '../src/engine/SlotState.js';
import { requestUrl } from './helpers/requestUrl.js';

const fixtureRoot = new URL('./fixtures/compatibility/', import.meta.url);
const readJson = async (url: URL): Promise<unknown> => JSON.parse(await readFile(url, 'utf8')) as unknown;

async function fixture(name: string) {
  const base = new URL(`${name}/`, fixtureRoot);
  const manifest = characterManifestSchema.parse(await readJson(new URL('character.json', base)));
  const paths = [manifest.rig, ...Object.values(manifest.skins), ...manifest.animations, ...(manifest.poses ?? [])];
  const files: Record<string, unknown> = Object.fromEntries(
    await Promise.all(paths.map(async (path) => [path, await readJson(new URL(path, base))] as const)),
  );
  const data: CharacterData = { manifest, rig: files[manifest.rig], skins: files, animations: files, poses: files };
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = decodeURIComponent(new URL(requestUrl(input)).pathname.slice(1));
    if (path === 'character.json') return Response.json(manifest);
    return Object.hasOwn(files, path) ? Response.json(files[path]) : new Response(null, { status: 404 });
  });
  return { manifest, files, data, fetcher };
}

function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .reverse()
      .map((key) => [key, reversedKeys(record[key])]),
  );
}

function sampledData(sample: ReturnType<IsolatedIKSampler['sample']>) {
  return {
    time: sample.time,
    pose: [...sample.pose],
    targets: [...sample.targets],
    constraints: [...sample.constraints],
  };
}

test.each(['minimal', 'complete', 'v0.4.3'])(
  '%s character loads through validators and the production loader',
  async (name) => {
    const { data, fetcher } = await fixture(name);
    assert.deepEqual(validateCharacterDefinition(data), []);
    const character = await CharacterLoader.load('https://fixtures.test/character.json', fetcher);
    assert.equal(character.id, character.manifest!.id);
    assert.deepEqual(
      character.compiledAnimations.map((clip) => clip.name),
      character.animations.map((clip) => clip.name),
    );
    if (name === 'minimal') {
      assert.deepEqual(new Joint('root', character.rig.getBone('root')).pose, {
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      });
      assert.deepEqual(character.rig.slots, []);
    }
    if (name === 'v0.4.3') {
      assert.isUndefined(character.manifest!.poses);
      assert.isUndefined(character.animations[0]!.playback);
      assert.isUndefined(character.animations[0]!.ikTracks);
      assert.isUndefined(character.animations[0]!.disabledIKConstraints);
    }
  },
);

test.each(['minimal', 'complete', 'v0.4.3'])(
  '%s metadata has stable canonical JSON over 20 cycles without mutation',
  async (name) => {
    const { data, manifest, files } = await fixture(name);
    const before = structuredClone(data);
    const rig = CharacterDefinition.fromData(data).rig;
    const exports: [unknown, (input: unknown) => string][] = [
      [manifest, serializeCharacterManifest],
      [data.rig, serializeRigDefinition],
      ...Object.values(manifest.skins).map((path): [unknown, (input: unknown) => string] => [
        files[path],
        (value) => serializeSkinDefinition(value, rig),
      ]),
      ...manifest.animations.map((path): [unknown, (input: unknown) => string] => [
        files[path],
        (value) => serializeAnimationDefinition(value, rig),
      ]),
    ];
    for (const [input, serialize] of exports) {
      const expected = serialize(input);
      assert.equal(serialize(reversedKeys(input)), expected);
      let current = expected;
      for (let cycle = 0; cycle < 20; cycle++) {
        const reloaded: unknown = JSON.parse(current);
        assert.deepEqual(reloaded, input);
        current = serialize(reloaded);
        assert.equal(current, expected);
      }
    }
    assert.deepEqual(data, before);
  },
);

test.each(['complete', 'v0.4.3'])(
  '%s runtime poses, events and skin assignments survive a full file round trip',
  async (name) => {
    const { data, files, manifest } = await fixture(name);
    const before = CharacterDefinition.fromData(data);
    const reloadedFiles = { ...files };
    for (const path of Object.values(manifest.skins))
      reloadedFiles[path] = JSON.parse(serializeSkinDefinition(files[path], before.rig)) as unknown;
    for (const path of manifest.animations)
      reloadedFiles[path] = JSON.parse(serializeAnimationDefinition(files[path], before.rig)) as unknown;
    const after = CharacterDefinition.fromData({
      manifest: JSON.parse(serializeCharacterManifest(manifest)) as unknown,
      rig: JSON.parse(serializeRigDefinition(data.rig)) as unknown,
      skins: reloadedFiles,
      animations: reloadedFiles,
      poses: reloadedFiles,
    });
    for (const [index, clip] of before.animations.entries()) {
      const original = compileClip(clip, before.rig);
      const restored = compileClip(after.animations[index]!, after.rig);
      const a = new IsolatedIKSampler(before.rig),
        b = new IsolatedIKSampler(after.rig);
      for (const time of [0, clip.duration / 4, clip.duration / 2, clip.duration - 0.001, clip.duration]) {
        assert.deepEqual(evaluateClip(restored, time), evaluateClip(original, time));
        assert.deepEqual(sampledData(b.sample(restored, time)), sampledData(a.sample(original, time)));
      }
      assert.deepEqual(collectAnimationStartEvents(restored, 'base'), collectAnimationStartEvents(original, 'base'));
      assert.deepEqual(
        collectAnimationEvents(restored, 0, clip.duration * 2, 'base'),
        collectAnimationEvents(original, 0, clip.duration * 2, 'base'),
      );
      const players = [before, after].map((character) => {
        const joints = new Map(character.rig.bones.map((bone) => [bone.id, new Joint(bone.id, bone)]));
        const player = new AnimationPlayer(character.rig, joints);
        player.addAnimation(character.animations[index]!);
        player.play(clip.name);
        return { player, joints };
      });
      for (const time of [0, clip.duration / 3, clip.duration]) {
        for (const { player } of players) player.sample(time, { mode: 'playback' });
        assert.deepEqual(
          [...players[1]!.joints.values()].map((joint) => joint.pose),
          [...players[0]!.joints.values()].map((joint) => joint.pose),
        );
      }
      for (const { player } of players) player.dispose();
    }
    const states = [new SlotState(before.rig), new SlotState(after.rig)];
    for (const skin of before.rig.skins) {
      for (const state of states) {
        state.setSkin(before.defaultSkin);
        state.applySkin(skin.name);
      }
      assert.deepEqual(
        before.rig.slots.map((slot) => states[0]!.getAttachment(slot.id)),
        after.rig.slots.map((slot) => states[1]!.getAttachment(slot.id)),
      );
    }
    if (name === 'complete') {
      states[0]!.setSkin('default');
      assert.equal(states[0]!.getAttachment('hand'), 'paper-hand', 'standalone skin overrides the embedded default');
      states[0]!.applySkin('clear');
      assert.isUndefined(states[0]!.getAttachment('hand'));
    }
  },
);

test.each(['smooth', 'stepped'] as const)(
  'production %s IK bake retains suppression, targets and solved motion after serialization',
  async (mode) => {
    const { data } = await fixture('complete');
    const character = CharacterDefinition.fromData(data);
    const source = { ...character.animations[0]!, playback: mode === 'smooth' ? { mode } : { mode, fps: 12 } };
    const samples = sampleIKBake(source, character.rig, ['arm'], { fps: 12 });
    const plan = generateBakedBoneKeys(samples, character.rig, { animation: source, outputMode: mode });
    const result = commitIKBake(source, plan, character.rig);
    assert.isTrue(result.success, JSON.stringify(result.issues));
    if (!result.success) return;
    const file = { version: 1, ...result.animation };
    const restored = parseAnimationClip(
      JSON.parse(serializeAnimationDefinition(file, character.rig)) as unknown,
      character.rig,
    );
    assert.deepEqual(restored.disabledIKConstraints, ['arm']);
    assert.deepEqual(restored, result.animation);
    const a = new IsolatedIKSampler(character.rig),
      b = new IsolatedIKSampler(character.rig);
    for (const time of [0, 83.33333333333333, 375, 500, 999.999, 1000])
      assert.deepEqual(
        sampledData(b.sample(compileClip(restored, character.rig), time)),
        sampledData(a.sample(compileClip(result.animation, character.rig), time)),
      );
  },
);

test('invalid manifest fixtures report document fields and fail assembly', async () => {
  const { data, manifest } = await fixture('complete');
  const cases = (await readJson(new URL('invalid-manifests.json', fixtureRoot))) as {
    label: string;
    patch: Record<string, unknown>;
  }[];
  for (const entry of cases) {
    const invalid = {
      ...data,
      manifest: { ...manifest, ...entry.patch },
      ...(entry.patch.rig ? { rig: undefined } : {}),
    };
    assert.isAbove(validateCharacterDefinition(invalid).length, 0, entry.label);
    assert.throws(() => CharacterDefinition.fromData(invalid), /Invalid character definition/);
  }
  const invalidClip = { version: 1, name: 'bad', duration: 100, loop: false, tracks: { absent: [{ time: 0, x: 1 }] } };
  const issues = validateCharacterDefinition({
    ...data,
    animations: { ...data.animations, [manifest.animations[0]!]: invalidClip },
  });
  assert.ok(
    issues.some(
      (issue) =>
        issue.path === 'animations[0].tracks.absent' &&
        issue.message.includes('animations/reach.json') &&
        issue.message.includes('absent'),
    ),
  );
});

test.each(['sub/../rig.json', './rig.json', '%72ig.json', '/rig.json', 'https://other.test/rig.json'])(
  'package paths reject %s before fetching metadata',
  async (path) => {
    const { manifest, fetcher } = await fixture('minimal');
    const guarded = vi.fn<typeof fetch>(async () => Response.json({ ...manifest, rig: path }));
    await expect(
      CharacterLoader.load('https://fixtures.test/character.json', guarded, {
        pathPolicy: (value) => {
          packagePath(value);
        },
      }),
    ).rejects.toThrow(/character.json manifest.rig.*Invalid package path/);
    assert.equal(guarded.mock.calls.length, 1);
    const files = new Map([['character.json', new TextEncoder().encode(JSON.stringify({ ...manifest, rig: path }))]]);
    await expect(loadPackageDefinition(files)).rejects.toThrow(/manifest.rig.*Invalid package path/);
    assert.equal(fetcher.mock.calls.length, 0);
  },
);

test('existing browser draft compatibility is deterministic, repeatable and leaves its input untouched', async () => {
  const { data } = await fixture('v0.4.3');
  const { rig } = CharacterDefinition.fromData(data);
  const original = structuredClone(data.rig);
  const first = inspectRigDraft(data.rig, rig, rig);
  assert.ok(first);
  assert.deepEqual(inspectRigDraft(data.rig, rig, rig), first);
  assert.deepEqual(inspectRigDraft({ version: 1, rig: data.rig, directions: first.directions }, rig, rig), first);
  assert.deepEqual(
    inspectRigDraft(
      {
        version: 1,
        rig: { ...first.rig, version: 1 },
        directions: first.directions,
        standaloneSkins: first.standaloneSkins,
      },
      rig,
      rig,
    ),
    first,
  );
  assert.deepEqual(data.rig, original);
  const identity = draftSource({ rig: data.rig });
  assert.isTrue(sameDraftSource(JSON.stringify({ rig: data.rig }), identity));
  assert.equal(draftSource({ rig: original }), identity);
});

test('failed imports and exports preserve working documents and reject unknown data before projection', async () => {
  const { data } = await fixture('complete');
  const character = CharacterDefinition.fromData(data);
  const document = new AnimationEditorDocument(character.rig, character.animations);
  document.selectAnimation('reach');
  const working = document.workingAnimation;
  const state = new RigEditorState(character.rig);
  const rigBefore = state.workingCopy;
  for (const patch of [
    { version: 2 },
    { duration: 0 },
    { tracks: { absent: [] } },
    { ikTracks: { missing: [{ time: 0, x: 1 }] } },
    {
      tracks: {
        root: [
          { time: 10, x: 1 },
          { time: 10, x: 2 },
        ],
      },
    },
    { disabledIKConstraints: ['arm', 'arm'] },
    { transient: true },
  ]) {
    const input = { version: 1, ...working, ...patch };
    assert.isFalse(document.importJson(JSON.stringify(input)));
    assert.strictEqual(document.workingAnimation, working);
    assert.equal(document.historyLength, 0);
    assert.throws(() => serializeAnimationDefinition(input, character.rig));
  }
  for (const patch of [
    { version: 2 },
    { bones: [{ id: 'root', x: Infinity }] },
    { bones: [{ id: 'root' }, { id: 'root' }] },
    { slots: [{ id: 'bad', bone: 'absent' }] },
  ]) {
    const input = { ...character.rigFile, ...patch };
    assert.isFalse(state.restoreDraft(input));
    assert.strictEqual(state.workingCopy, rigBefore);
    assert.equal(state.historyLength, 0);
    assert.throws(() => serializeRigDefinition(input));
  }
  assert.throws(() => serializeAnimationDefinition({ ...working, version: 1, duration: NaN }, character.rig));
  assert.throws(
    () => serializeSkinDefinition({ version: 1, name: 'bad', slots: { hand: 'missing' } }, character.rig),
    /missing/,
  );
  assert.throws(() => serializeRigDefinition(character.rig), /plain JSON object/);
});
