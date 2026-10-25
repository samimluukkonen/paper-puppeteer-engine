import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import {
  buildProjectPackage,
  buildProjectScenePackage,
  importProjectPackage,
} from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { SceneCharacterRegistry } from '../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { exportSceneJson, importSceneJson } from '../src/devtools/scene-editor/SceneTransfer.js';
import {
  editAudioClipOnTimeline,
  layoutAudioClips,
  snapSceneTime,
} from '../src/devtools/scene-editor/timelineActions.js';
import { sceneDraftSource } from '../src/devtools/shared/autosave/editorDrafts.js';
import { AUDIO_CATEGORIES, type AudioAssetDefinition } from '../src/engine/AudioAsset.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { trimSceneAudioClip, type SceneAudioClip } from '../src/engine/sceneAudio.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
  validateSceneDefinition,
} from '../src/engine/SceneDefinition.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';

const bytes = () => new Uint8Array(readFileSync(new URL('./fixtures/audio/tone.wav', import.meta.url)));
const asset: AudioAssetDefinition = {
  id: 'tone',
  name: 'Tone',
  path: 'audio/tone.wav',
  category: 'sfx',
  durationSeconds: 2,
};
const clip: SceneAudioClip = {
  id: 'clip',
  assetId: 'tone',
  trackId: 'sfx-1',
  time: 1000,
  duration: 1000,
  sourceOffset: 200,
  volume: 1,
  loop: false,
};
function scene() {
  return parseSceneDefinition({
    ...createEmptyScene({ id: 'audio' }),
    audioAssets: [asset],
    audioTracks: [{ id: 'sfx-1', name: 'Effects', category: 'sfx' }],
    audioClips: [clip],
  });
}
function document() {
  const document = new SceneEditorDocument();
  expect(document.importJson(serializeSceneDefinition(scene()))).toBe(true);
  document.registerAudio(asset.path, bytes());
  return document;
}
function project() {
  const workspace = new ProjectWorkspace('Audio film', 'film');
  workspace.addAudio(asset, bytes());
  workspace.createScene({ id: 'audio' });
  workspace.scenes.addAudioTrack('sfx');
  const { id: _id, ...input } = clip;
  expect(workspace.scenes.addAudioClip(input)).toBe(true);
  return workspace;
}

test('old scene data stays unchanged and optional audio data round-trips without changing scene format', () => {
  const old = createEmptyScene({ id: 'old' });
  expect(parseSceneJson(serializeSceneDefinition(old))).toEqual(old);
  expect(old).not.toHaveProperty('audioClips');
  expect(parseSceneJson(serializeSceneDefinition(scene()))).toEqual(scene());
});

test('add, select, duplicate, reassign, remove, Undo and Redo preserve IDs, values and source snapshots', () => {
  const doc = document();
  const source = doc.sourceScene;
  expect(doc.addAudioTrack('voice')).toBe(true);
  expect(doc.duplicateAudioClip('clip')).toBe(true);
  const id = doc.selectedAudioClip!.id;
  expect(id).not.toBe('clip');
  expect(
    doc.updateAudioClip(id, { trackId: 'voice-1', volume: 0.4, loop: true, duration: 4000, fadeIn: 400, fadeOut: 900 }),
  ).toBe(true);
  expect(doc.selectedAudioClip).toMatchObject({ trackId: 'voice-1', volume: 0.4, loop: true, duration: 4000 });
  expect(doc.removeAudioClip(id)).toBe(true);
  expect(doc.undo()).toBe(true);
  expect(doc.selectedAudioClip?.id).toBe(id);
  expect(doc.redo()).toBe(true);
  expect(doc.workingScene!.audioClips).toHaveLength(1);
  expect(doc.sourceScene).toBe(source);
  expect(source!.audioClips).toEqual([clip]);
});

test('all track categories allow multiple tracks and intentional overlaps on the same track', () => {
  const doc = document();
  for (const category of AUDIO_CATEGORIES) {
    expect(doc.addAudioTrack(category)).toBe(true);
    expect(doc.addAudioTrack(category)).toBe(true);
  }
  expect(doc.workingScene!.audioTracks).toHaveLength(9);
  doc.duplicateAudioClip('clip');
  doc.duplicateAudioClip('clip');
  expect(validateSceneDefinition(doc.workingScene)).toEqual([]);
  expect(layoutAudioClips(doc.workingScene!.audioClips!, 10000, 1000).map(({ lane }) => lane)).toEqual([0, 1, 2]);
  expect(layoutAudioClips([clip, { ...clip, id: 'next', time: 2000 }], 10000, 1000).map(({ lane }) => lane)).toEqual([
    0, 0,
  ]);
});

test('one complete audio drag creates one undo transaction; invalid proposals and cancelled drags preserve history', () => {
  const doc = document();
  const initial = doc.workingScene;
  expect(doc.beginAudioDrag('clip')).toBe(true);
  expect(doc.hasActiveGesture).toBe(true);
  expect(doc.hasOpenOperation).toBe(true);
  expect(doc.changeAudioDrag({ ...clip, time: 2345 })).toBe(true);
  expect(doc.changeAudioDrag({ ...clip, time: 3000 })).toBe(true);
  const valid = doc.workingScene;
  expect(doc.changeAudioDrag({ ...clip, time: 9500 })).toBe(false);
  expect(doc.workingScene).toBe(valid);
  doc.endAudioDrag();
  expect(doc.hasOpenOperation).toBe(false);
  expect(doc.undo()).toBe(true);
  expect(doc.workingScene).toBe(initial);
  expect(doc.canUndo).toBe(false);
  doc.beginAudioDrag('clip');
  doc.changeAudioDrag({ ...clip, time: 4000 });
  doc.cancelAudioDrag();
  expect(doc.canRedo).toBe(true);
  doc.redo();
  expect(doc.workingScene).toBe(valid);
});

test('switching scenes and selecting other editor objects cancel unfinished audio gestures', () => {
  const doc = document();
  for (const cancel of [
    () => doc.selectCamera(),
    () => doc.selectActor(null),
    () => doc.selectAction(null),
    () => doc.createScene({ id: 'other' }),
  ]) {
    const before = doc.workingScene;
    doc.beginAudioDrag('clip');
    doc.changeAudioDrag({ ...clip, time: 4000 });
    cancel();
    doc.selectScene('audio');
    expect(doc.workingScene).toBe(before);
    expect(doc.hasOpenOperation).toBe(false);
  }
});

test('trims distinguish source offset, timeline duration and scene time; moves leave the media untouched', () => {
  expect(trimSceneAudioClip(clip, 'start', 1200)).toEqual({ ...clip, time: 1200, sourceOffset: 400, duration: 800 });
  expect(trimSceneAudioClip(clip, 'end', 1700)).toEqual({ ...clip, duration: 700 });
  const doc = document();
  doc.beginAudioDrag('clip');
  expect(doc.changeAudioDrag(trimSceneAudioClip(clip, 'start', 1200))).toBe(true);
  doc.endAudioDrag();
  expect(doc.readAudio(asset.path)).toEqual(bytes());
  const moved = editAudioClipOnTimeline(scene(), clip, 'move', 1234, 1000, 0, false);
  expect(moved).toEqual({ ...clip, time: 2234 });
  expect(editAudioClipOnTimeline(scene(), clip, 'start', -9000, 1000, 0, false)).toMatchObject({
    time: 800,
    sourceOffset: 0,
    duration: 1200,
  });
  expect(editAudioClipOnTimeline(scene(), clip, 'end', 99999, 1000, 0, false).duration).toBe(1800);
  expect(editAudioClipOnTimeline(scene(), { ...clip, loop: true }, 'end', 99999, 1000, 0, false).duration).toBe(9000);
});

test('audio edges participate in shared snapping with frames, playhead and other timeline content', () => {
  const input = scene();
  input.audioClips!.push({ ...clip, id: 'target', time: 2345 });
  expect(editAudioClipOnTimeline(input, clip, 'move', 1348, 1000, 5000, true).time).toBeCloseTo(2345);
  expect(editAudioClipOnTimeline(input, clip, 'move', 1348, 1000, 5000, false).time).toBe(2348);
  expect(editAudioClipOnTimeline(input, clip, 'end', 348, 1000, 5000, true).duration).toBeCloseTo(1345);
  expect(snapSceneTime(input, null, 2348, 1000, 5000, true)).toBeCloseTo(2345);
  expect(editAudioClipOnTimeline(input, clip, 'move', 99999, 1000, 5000, true).time).toBe(9000);
});

test.each([
  { time: -1 },
  { duration: -1 },
  { duration: 0 },
  { time: 9500 },
  { sourceOffset: -1 },
  { sourceOffset: 2000 },
  { sourceOffset: 1500 },
  { volume: -1 },
  { volume: 1.01 },
  { volume: NaN },
  { fadeIn: 1001 },
  { fadeOut: -1 },
  { fadeOut: 1001 },
  { loop: 'forever' },
  { loop: { start: 0 } },
  { loopStart: 0 },
  { trackId: 'missing' },
  { assetId: 'missing' },
])('rejects invalid audio data %j without installing a new snapshot', (patch) => {
  const source = scene();
  expect(validateSceneDefinition({ ...source, audioClips: [{ ...clip, ...patch }] })).not.toEqual([]);
  const doc = document();
  const before = doc.workingScene;
  expect(doc.replaceScene({ ...before, audioClips: [{ ...clip, ...patch }] })).toBe(false);
  expect(doc.workingScene).toBe(before);
});

test('rejects duplicate clip/track/asset IDs, missing references and unbounded source sums', () => {
  const input = scene();
  for (const patch of [
    { audioClips: [clip, clip] },
    { audioTracks: [input.audioTracks![0], input.audioTracks![0]] },
    { audioAssets: [asset, asset] },
    { audioAssets: [] },
    { audioTracks: [] },
    { audioClips: [{ ...clip, sourceOffset: Number.MAX_VALUE, duration: Number.MAX_VALUE }] },
  ])
    expect(validateSceneDefinition({ ...input, ...patch })).not.toEqual([]);
  expect(validateSceneDefinition({ ...input, audioClips: [{ ...clip, loop: true, duration: 8000 }] })).toEqual([]);
  expect(
    validateSceneDefinition({ ...input, audioClips: [{ ...clip, volume: 0, fadeIn: 1000, fadeOut: 1000 }] }),
  ).toEqual([]);
});

test('unknown duration allows authoring but a decoded catalog rejects illegal source ranges; scene duration never changes implicitly', () => {
  const doc = document();
  const before = doc.workingScene;
  expect(doc.updateProperties({ duration: 1500 })).toBe(false);
  expect(doc.workingScene).toBe(before);
  expect(validateSceneDefinition(scene(), { getAudioAssets: () => [{ ...asset, durationSeconds: 0.5 }] })).not.toEqual(
    [],
  );
  expect(validateSceneDefinition({ ...scene(), audioAssets: [{ ...asset, durationSeconds: undefined }] })).not.toEqual(
    [],
  );
  const { durationSeconds: _duration, ...unknown } = asset;
  expect(validateSceneDefinition({ ...scene(), audioAssets: [unknown] })).toEqual([]);
});

test('project dependency inspection blocks removal of used audio and sees missing references after project Undo', () => {
  const workspace = project();
  expect(workspace.inspect('export').counts.error).toBe(0);
  expect(() => workspace.removeAudio('tone')).toThrow(/in use.*audio clip/);
  const id = workspace.scenes.selectedAudioClip!.id;
  workspace.scenes.removeAudioClip(id);
  workspace.removeAudio('tone');
  workspace.scenes.undo();
  expect(workspace.inspect('export').issues.some((issue) => /Missing audio asset/.test(issue.message))).toBe(true);
  expect(workspace.scenes.validateScene()).toBe(false);
  workspace.undo();
  expect(workspace.scenes.validateScene()).toBe(true);
});

test('project and standalone ZIPs include one binary per referenced audio asset and retain all playback properties', async () => {
  const workspace = project();
  const doc = workspace.scenes;
  doc.updateAudioClip(doc.selectedAudioClip!.id, {
    volume: 0.25,
    fadeIn: 100,
    fadeOut: 200,
    loop: true,
    duration: 5000,
  });
  doc.duplicateAudioClip(doc.selectedAudioClip!.id);
  const authored = doc.workingScene!;
  const captured = await buildProjectPackage(workspace);
  const restored = await importProjectPackage(decodePackageZip(encodePackageZip(captured.files)));
  expect(restored.scenes.workingScene).toEqual(authored);
  expect(restored.audioSource('tone')!.bytes).toEqual(bytes());
  const portable = await buildProjectScenePackage(workspace, authored);
  const resolved = await validateScenePackage(decodePackageZip(encodePackageZip(portable)));
  expect(resolved.definition.audioClips).toEqual(authored.audioClips);
  expect(resolved.audio!.get('tone')).toEqual(bytes());
  expect([...portable.keys()].filter((path) => path.endsWith('.wav'))).toHaveLength(1);
  expect(doc.workingScene).toBe(authored);
  const missing = new Map(portable);
  missing.delete(resolved.definition.audioAssets![0]!.path);
  await expect(validateScenePackage(missing)).rejects.toThrow(/404/);
});

test('standalone JSON imports retain isolated binaries, portable exports and recovery include audio', async () => {
  const doc = new SceneEditorDocument();
  const options = { baseUrl: 'https://assets.test/scene.json', loadAudio: () => Promise.resolve(bytes()) };
  expect(await importSceneJson(doc, serializeSceneDefinition(scene()), options)).toBe(true);
  const imported = doc.workingScene!;
  const reference = imported.audioAssets![0]!.path;
  expect(reference).toMatch(/^\.\.\/audio\/\w+\.wav$/);
  expect(doc.readAudio(reference)).toEqual(bytes());
  const assets = { ...options, loadAudio: (reference: string) => Promise.resolve(doc.readAudio(reference)) };
  expect(parseSceneJson(await exportSceneJson(imported, assets))).toEqual(imported);
  const portable = await buildScenePackage(imported, assets);
  expect((await validateScenePackage(portable)).definition.audioClips).toEqual(imported.audioClips);
  const registry = new SceneCharacterRegistry();
  try {
    const draft = sceneDraftSource(doc, registry, 'draft')!;
    const recovered = await importProjectPackage(await draft.build());
    expect(recovered.scenes.workingScene!.audioClips).toEqual(imported.audioClips);
    expect(recovered.audioSource('tone')!.bytes).toEqual(bytes());
  } finally {
    registry.dispose();
  }
});

test('failed or cancelled standalone imports preserve document and binary ownership', async () => {
  const doc = document();
  const before = doc.workingScene;
  const options = {
    baseUrl: 'https://assets.test/scene.json',
    loadAudio: () => Promise.resolve(new Uint8Array([1, 2])),
  };
  await expect(importSceneJson(doc, serializeSceneDefinition(scene()), options)).rejects.toThrow(/Unrecognized/);
  expect(doc.workingScene).toBe(before);
  doc.updateProperties({ name: 'Dirty' });
  const dirty = doc.workingScene;
  expect(
    await importSceneJson(
      doc,
      serializeSceneDefinition(scene()),
      { ...options, loadAudio: () => Promise.resolve(bytes()) },
      () => false,
    ),
  ).toBe(false);
  expect(doc.workingScene).toBe(dirty);
  expect(doc.readAudio(asset.path)).toEqual(bytes());
});

test('decoded media bounds reject an invalid standalone trim before changing document or registering audio', async () => {
  const closed = vi.fn(() => Promise.resolve());
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'suspended';
      close = closed;
      decodeAudioData() {
        return Promise.resolve({ duration: 0.5, length: 22050, numberOfChannels: 1 });
      }
    },
  );
  const doc = document();
  const before = doc.workingScene;
  try {
    await expect(
      importSceneJson(doc, serializeSceneDefinition(scene()), {
        baseUrl: 'https://assets.test/scene.json',
        loadAudio: () => Promise.resolve(bytes()),
      }),
    ).rejects.toThrow(/media duration/);
    expect(doc.workingScene).toBe(before);
    expect(doc.readAudio(asset.path)).toEqual(bytes());
    expect(closed).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('standalone recovery aliases different same-ID assets without changing either scene or binary', async () => {
  const doc = new SceneEditorDocument();
  const first = scene();
  const second = scene();
  second.id = 'second';
  const otherBytes = bytes();
  otherBytes[otherBytes.length - 1] = otherBytes[otherBytes.length - 1]! ^ 1;
  const options = { baseUrl: 'https://assets.test/scene.json' };
  await importSceneJson(doc, serializeSceneDefinition(first), {
    ...options,
    loadAudio: () => Promise.resolve(bytes()),
  });
  await importSceneJson(doc, serializeSceneDefinition(second), {
    ...options,
    loadAudio: () => Promise.resolve(otherBytes),
  });
  const originalFirst = doc.scene('audio');
  const originalSecond = doc.scene('second');
  expect(originalFirst!.audioAssets![0]!.path).not.toBe(originalSecond!.audioAssets![0]!.path);
  expect(doc.readAudio(originalFirst!.audioAssets![0]!.path)).toEqual(bytes());
  expect(doc.readAudio(originalSecond!.audioAssets![0]!.path)).toEqual(otherBytes);
  const registry = new SceneCharacterRegistry();
  try {
    const restored = await importProjectPackage(await sceneDraftSource(doc, registry, 'recovery')!.build());
    expect(restored.definition.audio).toHaveLength(2);
    const restoredFirst = restored.scenes.scene('audio')!;
    const restoredSecond = restored.scenes.scene('second')!;
    expect(restoredFirst.audioClips![0]!.assetId).not.toBe(restoredSecond.audioClips![0]!.assetId);
    expect(restored.audioSource(restoredFirst.audioClips![0]!.assetId)!.bytes).toEqual(bytes());
    expect(restored.audioSource(restoredSecond.audioClips![0]!.assetId)!.bytes).toEqual(otherBytes);
    expect(doc.scene('audio')).toBe(originalFirst);
    expect(doc.scene('second')).toBe(originalSecond);
  } finally {
    registry.dispose();
  }
});
