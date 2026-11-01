import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ProjectInspector } from '../src/devtools/project/projectInspection.js';
import {
  buildProjectPackage,
  buildProjectScenePackage,
  importProjectPackage,
} from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { SceneCharacterRegistry } from '../src/devtools/scene-editor/SceneCharacterRegistry.js';
import { SceneDialogueInspector } from '../src/devtools/scene-editor/SceneDialogueInspector.js';
import { SceneDialogueTrack } from '../src/devtools/scene-editor/SceneDialogueTimeline.js';
import { SceneEditorDocument } from '../src/devtools/scene-editor/SceneEditorDocument.js';
import { SceneEditorPlayback } from '../src/devtools/scene-editor/SceneEditorPlayback.js';
import { snapSceneTime } from '../src/devtools/scene-editor/timelineActions.js';
import { sceneDraftSource } from '../src/devtools/shared/autosave/editorDrafts.js';
import { sceneFingerprint } from '../src/devtools/shared/sceneFingerprint.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import {
  createEmptyScene,
  parseSceneDefinition,
  parseSceneJson,
  serializeSceneDefinition,
  validateSceneDefinition,
} from '../src/engine/SceneDefinition.js';
import { dialogueSpeaker, getDialogueLineAtTime, type SceneDialogueLine } from '../src/engine/sceneDialogue.js';
import { buildScenePackage, validateScenePackage } from '../src/engine/ScenePackage.js';
import { assetFixture, sceneFixture } from './helpers/scenePackageFixtures.js';

const line: SceneDialogueLine = { id: 'opening', text: '森は静かだった。\n  "Hello" 👋\n', time: 0, duration: 500 };
function scene() {
  return parseSceneDefinition({
    ...sceneFixture(),
    dialogue: [line, { ...line, id: 'hero-line', actorId: 'hero', time: 500 }],
  });
}
function document() {
  const doc = new SceneEditorDocument();
  expect(doc.importJson(serializeSceneDefinition(scene()))).toBe(true);
  return doc;
}

test('legacy scenes stay unchanged; plain multiline Unicode, whitespace and labels survive JSON round trips', () => {
  const legacy = createEmptyScene({ id: 'old' });
  expect(parseSceneJson(serializeSceneDefinition(legacy))).toEqual(legacy);
  expect(legacy).not.toHaveProperty('dialogue');
  const source = scene();
  expect(parseSceneJson(serializeSceneDefinition(source))).toEqual(source);
  expect(source.dialogue![0]!.text).toBe(line.text);
  expect(dialogueSpeaker(line)).toBe('Narrator');
  expect(dialogueSpeaker(source.dialogue![1]!)).toBe('hero');
  expect(dialogueSpeaker({ ...line, actorId: 'hero', speakerName: '勇者' })).toBe('勇者');
  expect(dialogueSpeaker({ ...line, speakerName: 'Voice over' })).toBe('Voice over');
});

test('add and select narration, apply timing/text/speaker edits, delete, Undo and Redo share immutable history', () => {
  const doc = document();
  const original = doc.workingScene;
  expect(doc.addDialogueLine({ time: 1000, duration: 400, text: 'New line' })).toBe(true);
  const id = doc.selectedDialogueLine!.id;
  expect(doc.selectedActorId).toBeNull();
  expect(
    doc.updateDialogueLine(id, { text: line.text, actorId: 'friend', speakerName: '友達', time: 1100, duration: 600 }),
  ).toBe(true);
  expect(doc.selectedDialogueLine).toEqual({
    id,
    text: line.text,
    actorId: 'friend',
    speakerName: '友達',
    time: 1100,
    duration: 600,
  });
  const edited = doc.workingScene;
  expect(doc.removeDialogueLine(id)).toBe(true);
  expect(doc.selectedDialogueLine).toBeNull();
  expect(doc.undo()).toBe(true);
  expect(doc.workingScene).toBe(edited);
  expect(doc.selectedDialogueLine?.id).toBe(id);
  expect(doc.redo()).toBe(true);
  expect(doc.undo()).toBe(true);
  expect(doc.undo()).toBe(true);
  expect(doc.selectedDialogueLine?.text).toBe('New line');
  expect(doc.undo()).toBe(true);
  expect(doc.workingScene).toBe(original);
  expect(doc.canUndo).toBe(false);
  expect(doc.sourceScene).toBe(original);
});

test('duplicate skips occupied intervals, assigns a new ID and reports no room without modifying history', () => {
  const doc = document();
  expect(doc.duplicateDialogueLine('opening')).toBe(true);
  expect(doc.selectedDialogueLine).toEqual({ ...line, id: 'dialogue-1', time: 1000 });
  expect(doc.duplicateDialogueLine('opening')).toBe(true);
  expect(doc.selectedDialogueLine).toEqual({ ...line, id: 'dialogue-2', time: 1500 });
  const full = doc.workingScene;
  expect(doc.duplicateDialogueLine('opening')).toBe(false);
  expect(doc.workingScene).toBe(full);
  expect(doc.validationIssues[0]!.message).toMatch(/No room.*extend the scene/);
  expect(doc.undo()).toBe(true);
  expect(doc.workingScene!.dialogue).toHaveLength(3);
  expect(doc.redo()).toBe(true);
  expect(doc.workingScene).toBe(full);
});

test('single subtitle intervals reject overlaps in any input order and accept exact adjacency', () => {
  const source = scene();
  expect(validateSceneDefinition(source)).toEqual([]);
  expect(validateSceneDefinition({ ...source, dialogue: [...source.dialogue!].reverse() })).toEqual([]);
  const doc = document();
  const before = doc.workingScene;
  expect(doc.updateDialogueLine('hero-line', { time: 499.999 })).toBe(false);
  expect(doc.validationIssues.some((issue) => /must not overlap/.test(issue.message))).toBe(true);
  expect(doc.workingScene).toBe(before);
  expect(doc.canUndo).toBe(false);
  expect(doc.addDialogueLine({ time: 250, duration: 1500, text: 'conflict' })).toBe(false);
  expect(doc.updateProperties({ duration: 999 })).toBe(false);
  expect(doc.workingScene).toBe(before);
  expect(doc.updateDialogueLine('hero-line', { time: 500, duration: 1000 })).toBe(true);
});

test.each([
  { time: -1 },
  { time: NaN },
  { duration: 0 },
  { duration: -1 },
  { duration: Infinity },
  { progression: 'manual' },
  { time: 1900 },
  { actorId: 'missing' },
  { voiceClipId: 'missing' },
  { id: '' },
  { actorId: 'characters/hero/character.json' },
  { text: { html: '<b>Hello</b>' } },
  { html: '<b>Hello</b>' },
  { text: 'a'.repeat(100001) },
])('invalid dialogue data is rejected atomically: %j', (patch) => {
  const doc = document();
  const before = doc.workingScene;
  expect(doc.replaceScene({ ...before, dialogue: [{ ...line, ...patch }] })).toBe(false);
  expect(doc.workingScene).toBe(before);
  expect(doc.canUndo).toBe(false);
});

test('duplicate line IDs and excess raw collection sizes are rejected', () => {
  expect(validateSceneDefinition({ ...scene(), dialogue: [line, { ...line, time: 500 }] })).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: 'dialogue[1].id' })]),
  );
  expect(validateSceneDefinition({ ...scene(), dialogue: Array(4001).fill(null) })[0]!.message).toContain(
    '4000-dialogue',
  );
});

test('same-character Actors retain distinct speaker IDs, rename atomically and require reassignment before removal', () => {
  const doc = document();
  expect(doc.workingScene!.actors[0]!.character).toEqual(doc.workingScene!.actors[1]!.character);
  expect(doc.updateDialogueLine('opening', { actorId: 'friend' })).toBe(true);
  expect(doc.updateActor('hero', { id: 'lead' })).toBe(true);
  expect(doc.workingScene!.dialogue!.map((entry) => entry.actorId)).toEqual(['friend', 'lead']);
  expect(doc.undo()).toBe(true);
  expect(doc.workingScene!.dialogue![1]!.actorId).toBe('hero');
  expect(doc.redo()).toBe(true);
  const before = doc.workingScene;
  expect(doc.removeActor('lead', { removeActions: true })).toBe(false);
  expect(doc.validationIssues[0]!.message).toMatch(/hero-line.*Reassign.*narration/);
  expect(doc.workingScene).toBe(before);
  expect(doc.updateDialogueLine('hero-line', { actorId: null, speakerName: 'Narration' })).toBe(true);
  expect(doc.removeActor('lead', { removeActions: true })).toBe(true);
  expect(doc.workingScene!.dialogue![1]).not.toHaveProperty('actorId');
  expect(doc.undo()).toBe(true);
  expect(doc.workingScene!.actors[0]!.id).toBe('lead');
  const invalid = { ...scene(), actors: scene().actors.filter((actor) => actor.id !== 'hero'), actions: [] };
  const issue = validateSceneDefinition(invalid).find((issue) => issue.path === 'dialogue[1].actorId');
  expect(issue?.message).toContain('Choose an existing Actor');
});

test('selection cancels active gestures, excludes other object selections and is retained per scene', () => {
  const doc = document();
  const before = doc.workingScene;
  doc.beginActorDrag('hero');
  doc.moveActorDrag({ x: 900, y: 800 });
  doc.selectDialogueLine('opening');
  expect(doc.workingScene).toBe(before);
  expect(doc.hasActiveGesture).toBe(false);
  expect(doc.canUndo).toBe(false);
  expect(doc.selectedDialogueLine?.id).toBe('opening');
  doc.createScene({ id: 'other' });
  expect(doc.selectedDialogueLine).toBeNull();
  doc.selectScene('opening');
  expect(doc.selectedDialogueLine?.id).toBe('opening');
  for (const select of [
    () => doc.selectActor('hero'),
    () => doc.selectAction('walk'),
    () => doc.selectCamera(),
    () => doc.selectImage(null),
  ]) {
    doc.selectDialogueLine('opening');
    select();
    expect(doc.selectedDialogueLine).toBeNull();
  }
});

test('deterministic half-open intervals and shared timeline snapping include dialogue edges', () => {
  const source = scene();
  expect(getDialogueLineAtTime(source, -1)).toBeUndefined();
  expect(getDialogueLineAtTime(source, 0)?.id).toBe('opening');
  expect(getDialogueLineAtTime(source, 499.999)?.id).toBe('opening');
  expect(getDialogueLineAtTime(source, 500)?.id).toBe('hero-line');
  expect(getDialogueLineAtTime(source, 1000)).toBeUndefined();
  expect(getDialogueLineAtTime(source, 2000)).toBeUndefined();
  expect(getDialogueLineAtTime(source, NaN)).toBeUndefined();
  expect(
    snapSceneTime({ ...source, dialogue: [{ ...line, time: 123.456 }], actions: [] }, null, 124, 1000, -1000, true),
  ).toBeCloseTo(123.456);
  expect(snapSceneTime(source, null, 124, 1000, -1000, false)).toBe(124);
});

test('inspector starts collapsed and treats markup as literal text', () => {
  const doc = document();
  doc.updateDialogueLine('opening', { text: '<script>alert(1)</script>\n日本語' });
  doc.selectDialogueLine('opening');
  const html = renderToStaticMarkup(createElement(SceneDialogueInspector, { document: doc }));
  expect(html).not.toContain('<details open');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('日本語');
  expect(html).toContain('Dialogue progression');
  expect(html).toContain('Wait for Enter');
});

test('progression edits use scene history, preserve legacy fields and persist through JSON', () => {
  const doc = document();
  const original = doc.workingScene;
  expect(doc.updateDialogueLine('opening', { progression: 'advance-required' })).toBe(true);
  const edited = doc.workingScene;
  expect(edited!.dialogue![0]!.progression).toBe('advance-required');
  expect(edited!.dialogue![1]).not.toHaveProperty('progression');
  expect(parseSceneJson(serializeSceneDefinition(edited)).dialogue).toEqual(edited!.dialogue);
  expect(doc.undo()).toBe(true);
  expect(doc.workingScene).toBe(original);
  expect(doc.redo()).toBe(true);
  expect(doc.workingScene).toBe(edited);
});

test('Actor hold idle authoring shares immutable history, validates live catalogs and remains optional', () => {
  const animations = ['wave'];
  const doc = new SceneEditorDocument({}, () => animations);
  expect(doc.importJson(serializeSceneDefinition(scene()))).toBe(true);
  const original = doc.workingScene;
  expect(doc.setActorAppearance('hero', 'dialogueIdle', 'wave')).toBe(true);
  const edited = doc.workingScene;
  expect(edited!.actors[0]!.dialogueIdle).toEqual({ animation: 'wave', policy: 'overlay-snap' });
  expect(doc.undo()).toBe(true);
  expect(doc.workingScene).toBe(original);
  expect(doc.redo()).toBe(true);
  expect(doc.workingScene).toBe(edited);
  expect(doc.setActorAppearance('hero', 'dialogueIdle', 'missing')).toBe(false);
  expect(doc.workingScene).toBe(edited);
  animations.length = 0;
  expect(doc.updateProperties({ name: 'Rejected' })).toBe(false);
  expect(doc.validationIssues.some((issue) => issue.path === 'actors[0].dialogueIdle.animation')).toBe(true);
  animations.push('wave');
  expect(doc.setActorAppearance('hero', 'dialogueIdle', null)).toBe(true);
  expect(doc.workingScene!.actors[0]).not.toHaveProperty('dialogueIdle');
});

test('simultaneous holds have separate selectable timeline lanes in stable playback order', () => {
  const doc = document();
  doc.updateDialogueLine('opening', { progression: 'advance-required' });
  expect(doc.addDialogueLine({ ...line, progression: 'advance-required' })).toBe(true);
  const html = renderToStaticMarkup(
    createElement(SceneDialogueTrack, {
      scene: doc.workingScene!,
      document: doc,
      playback: new SceneEditorPlayback(),
      width: 200,
      x: (time) => time / 10,
    }),
  );
  expect(html).toContain('height:64px');
  expect(html).toContain('top:32px');
  expect(html).toContain('Wait for Enter');
  expect(html).toContain('scene-dialogue-hold-marker');
  expect(html).toContain('Enter · 1');
  expect(html).toContain('Enter · 2');
  expect(html.indexOf('Dialogue dialogue-1:')).toBeLessThan(html.indexOf('Dialogue opening:'));
});

test('JSON and standalone ZIPs preserve dialogue and scene-local speaker identities after character rebasing', async () => {
  const source = scene();
  source.actors[0]!.dialogueIdle = { animation: 'wave', policy: 'overlay-snap' };
  const files = await buildScenePackage(source, assetFixture());
  const restored = await validateScenePackage(decodePackageZip(encodePackageZip(files)));
  expect(restored.definition.dialogue).toEqual(source.dialogue);
  expect(restored.definition.actors[0]!.dialogueIdle).toEqual(source.actors[0]!.dialogueIdle);
  expect(restored.definition.actors[0]!.character.manifest).not.toBe(source.actors[0]!.character.manifest);
  expect(parseSceneJson(serializeSceneDefinition(restored.definition)).dialogue).toEqual(source.dialogue);
});

function voiceProject() {
  const workspace = new ProjectWorkspace('Dialogue film', 'film');
  workspace.addAudio(
    { id: 'voice', name: 'Voice', path: 'audio/voice.wav', category: 'voice', durationSeconds: 2 },
    new Uint8Array(readFileSync(new URL('./fixtures/audio/tone.wav', import.meta.url))),
  );
  workspace.createScene({ id: 'talk' });
  workspace.scenes.addAudioTrack('voice');
  workspace.scenes.addAudioClip({
    assetId: 'voice',
    trackId: 'voice-1',
    time: 0,
    duration: 1000,
    sourceOffset: 0,
    volume: 1,
    loop: false,
  });
  workspace.scenes.addDialogueLine({
    ...line,
    progression: 'advance-required',
    voiceClipId: workspace.scenes.selectedAudioClip!.id,
  });
  return workspace;
}

test('voice associations are metadata, dependency inspection sees them and clip removal requires clearing references', () => {
  const workspace = voiceProject();
  const doc = workspace.scenes;
  const clip = doc.workingScene!.audioClips![0]!;
  const id = doc.selectedDialogueLine!.id;
  expect(workspace.inspect('export').counts.error).toBe(0);
  expect(
    workspace
      .inspect()
      .dependencies.some(({ from, to }) => from.kind === 'dialogue' && from.id === id && to.kind === 'audio'),
  ).toBe(true);
  const before = doc.workingScene;
  expect(doc.removeAudioClip(clip.id)).toBe(false);
  expect(doc.removeAudioTrack('voice-1', { removeClips: true })).toBe(false);
  expect(doc.workingScene).toBe(before);
  expect(doc.validationIssues.some((issue) => /clear the voice reference/.test(issue.message))).toBe(true);
  expect(doc.updateDialogueLine(id, { voiceClipId: null, time: 3000, duration: 1500 })).toBe(true);
  expect(doc.workingScene!.audioClips![0]).toEqual(clip);
  expect(doc.removeAudioClip(clip.id)).toBe(true);
  doc.undo();
  doc.undo();
  expect(doc.workingScene).toBe(before);
});

test('project/standalone ZIPs and standalone recovery retain dialogue with voice metadata and detect authored changes', async () => {
  const workspace = voiceProject();
  const doc = workspace.scenes;
  expect(doc.addAudioTrack('ambience')).toBe(true);
  expect(
    doc.addAudioClip({
      ...doc.workingScene!.audioClips![0]!,
      trackId: 'ambience-1',
      loop: true,
      playback: 'dialogue-hold',
    }),
  ).toBe(true);
  const authored = doc.workingScene!;
  const captured = await buildProjectPackage(workspace);
  const imported = await importProjectPackage(decodePackageZip(encodePackageZip(captured.files)));
  expect(imported.scenes.workingScene).toEqual(authored);
  expect(imported.scenes.workingScene!.audioClips![1]!.playback).toBe('dialogue-hold');
  const portable = await buildProjectScenePackage(workspace, authored);
  expect((await validateScenePackage(portable)).definition.dialogue).toEqual(authored.dialogue);
  const standalone = new SceneEditorDocument();
  expect(standalone.importJson(serializeSceneDefinition(authored))).toBe(true);
  standalone.registerAudio(authored.audioAssets![0]!.path, doc.readAudio(authored.audioAssets![0]!.path));
  const registry = new SceneCharacterRegistry();
  try {
    const draft = sceneDraftSource(standalone, registry, 'dialogue-draft')!;
    const recovered = await importProjectPackage(await draft.build());
    expect(recovered.scenes.workingScene!.dialogue).toEqual(authored.dialogue);
    expect(recovered.scenes.workingScene!.audioClips).toEqual(authored.audioClips);
    const before = sceneFingerprint(standalone.workingScene!);
    standalone.updateDialogueLine(authored.dialogue![0]!.id, { text: '変更\nnew line' });
    expect(sceneFingerprint(standalone.workingScene!)).not.toBe(before);
    expect(standalone.dirty).toBe(true);
  } finally {
    registry.dispose();
  }
});

test('project inspection records instance speaker dependencies and identifies invalid dialogue by line ID', () => {
  const source = scene();
  const definition = {
    version: 1,
    id: 'film',
    name: 'Film',
    characters: [],
    scenes: [{ id: source.id, path: 'scenes/opening.json' }],
  };
  const inspect = (value: unknown) =>
    new ProjectInspector().inspect({ definition, characters: new Map(), scenes: new Map([[source.id, value]]) });
  expect(inspect(source).dependencies).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        from: { kind: 'dialogue', owner: 'opening', id: 'hero-line' },
        to: { kind: 'actor', owner: 'opening', id: 'hero' },
      }),
    ]),
  );
  const invalid = { ...source, dialogue: [{ ...line, actorId: 'missing' }] };
  const issue = inspect(invalid).issues.find((issue) => issue.path === 'dialogue[0].actorId');
  expect(issue?.message).toContain('dialogue "opening": Missing Actor "missing"');
});
