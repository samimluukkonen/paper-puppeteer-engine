import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ProjectInspector } from '../src/devtools/project/projectInspection.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { storyDiagnostics } from '../src/devtools/project/storyDiagnostics.js';
import { StorySequencePanel } from '../src/devtools/project/StorySequencePanel.js';
import { buildProjectDraft } from '../src/devtools/shared/autosave/projectDrafts.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';

function fixture() {
  const workspace = new ProjectWorkspace('Sequence', 'film');
  workspace.createScene({ id: 'a', name: 'Opening' });
  workspace.createScene({ id: 'b', name: 'Meeting' });
  workspace.markExported(
    workspace.definition,
    new Map(),
    ['a', 'b'].map((id) => createEmptyScene({ id, name: id === 'a' ? 'Opening' : 'Meeting' })),
  );
  const id = workspace.createStory('First encounter');
  const first = workspace.addStoryScene(id, 'a');
  const second = workspace.addStoryScene(id, 'b');
  return { workspace, id, first, second };
}

test('visual story commands keep stable identities and one history entry per completed move', () => {
  const { workspace, id, first, second } = fixture();
  const sceneA = workspace.scenes.scene('a');
  const sceneB = workspace.scenes.scene('b');
  const length = workspace.history.length;
  workspace.reorderStoryScene(id, second, 0);
  expect(workspace.history.length).toBe(length + 1);
  expect(workspace.definition.stories![0]!.scenes.map(({ id }) => id)).toEqual([second, first]);
  workspace.undo();
  expect(workspace.definition.stories![0]!.scenes.map(({ id }) => id)).toEqual([first, second]);
  workspace.redo();
  workspace.reorderStoryScene(id, second, 0);
  expect(workspace.history.length).toBe(length + 1); // No-op moves do not create history.
  const copy = workspace.duplicateStoryScene(id, second);
  expect(copy).not.toBe(second);
  expect(workspace.definition.stories![0]!.scenes).toEqual([
    { id: second, sceneAssetId: 'b' },
    { id: copy, sceneAssetId: 'b' },
    { id: first, sceneAssetId: 'a' },
  ]);
  workspace.removeStoryScene(id, second);
  expect(workspace.definition.scenes).toHaveLength(2);
  expect(workspace.scenes.scene('a')).toBe(sceneA);
  expect(workspace.scenes.scene('b')).toBe(sceneB);
  expect(workspace.sceneDirty('a')).toBe(false);
  expect(workspace.sceneDirty('b')).toBe(false);
  workspace.undo();
  expect(workspace.definition.stories![0]!.scenes[0]!.id).toBe(second);
  workspace.renameStory(id, '  Renamed story  ');
  expect(workspace.definition.stories![0]!.name).toBe('Renamed story');
  workspace.undo();
  expect(workspace.definition.stories![0]!.name).toBe('First encounter');
});

test('invalid references, destinations and names leave project and source histories intact', () => {
  const { workspace, id, first } = fixture();
  const before = workspace.definition;
  const revision = workspace.autosaveRevision;
  const length = workspace.history.length;
  expect(() => workspace.addStoryScene(id, 'missing')).toThrow(/Missing scene/);
  expect(() => workspace.addStoryScene(id, 'a', 'missing')).toThrow(/Unknown story entry/);
  expect(() => workspace.reorderStoryScene(id, first, 4)).toThrow(/outside/);
  expect(() => workspace.reorderStoryScene(id, first, 0.5)).toThrow(/outside/);
  expect(() => workspace.removeStoryScene(id, 'missing')).toThrow(/Unknown/);
  expect(() => workspace.duplicateStoryScene(id, 'missing')).toThrow(/Unknown/);
  expect(() => workspace.renameStory(id, '   ')).toThrow();
  expect(() => workspace.createStory('   ')).toThrow();
  expect(workspace.definition).toEqual(before);
  expect(workspace.autosaveRevision).toBe(revision);
  expect(workspace.history.length).toBe(length);
  const another = workspace.createStory('Second');
  expect(another).not.toBe(id);
});

test.each(['export', 'recovery'] as const)(
  'visual story and dialogue edits survive %s without mixing document owners',
  async (mode) => {
    const { workspace, id, first, second } = fixture();
    workspace.scenes.selectScene('a');
    workspace.scenes.addDialogueLine({ text: 'Read me', time: 0, duration: 0, progression: 'advance-required' });
    const dialogue = workspace.scenes.workingScene;
    workspace.reorderStoryScene(id, second, 0);
    workspace.duplicateStoryScene(id, first);
    workspace.removeStoryScene(id, second);
    workspace.renameStory(id, 'Saved sequence');
    const saved = workspace.definition.stories;
    workspace.undo();
    expect(workspace.scenes.scene('a')).toBe(dialogue);
    workspace.redo();
    const files =
      mode === 'recovery' ? await buildProjectDraft(workspace) : (await buildProjectPackage(workspace)).files;
    const restored = await importProjectPackage(files);
    expect(restored.definition.stories).toEqual(saved);
    expect(restored.scenes.scene('a')!.dialogue).toEqual(dialogue!.dialogue);
    expect(restored.scenes.scene('b')!.dialogue).toBeUndefined();
    expect(restored.inspect('export').counts.error).toBe(0);
  },
);

test('sequence panel has empty and populated states, source actions and preview availability', () => {
  const empty = new ProjectWorkspace('Empty');
  const render = (workspace: ProjectWorkspace) =>
    renderToStaticMarkup(
      createElement(StorySequencePanel, {
        workspace,
        busy: false,
        openScene: () => {},
      }),
    );
  expect(render(empty)).toContain('Create a story');
  expect(render(empty)).toContain('disabled="">Preview Entire Story');
  const { workspace } = fixture();
  const html = render(workspace);
  expect(html).toContain('Opening');
  expect(html).toContain('Meeting');
  expect(html).toContain('Move entry 2 up');
  expect(html).toContain('Duplicate entry');
  expect(html).toContain('Open source scene');
  expect(html).not.toContain('disabled="">Preview Entire Story');
});

test('story diagnostics preserve source navigation for missing scenes and invalid hold, idle, audio and transition data', () => {
  const story = {
    version: 1 as const,
    id: 'story',
    name: 'Story',
    scenes: [
      { id: 'first', sceneAssetId: 'a' },
      { id: 'missing', sceneAssetId: 'missing' },
    ],
  };
  const scene = {
    ...createEmptyScene({ id: 'a' }),
    actors: [
      {
        id: 'hero',
        character: { manifest: 'hero.json' },
        position: { x: 0, y: 0 },
        dialogueIdle: { animation: 'missing-idle', policy: 'overlay-snap' },
      },
    ],
    dialogue: [{ id: 'bad', text: 'Invalid', time: 0, duration: 0, progression: 'unsupported' }],
    audioTracks: [{ id: 'track', name: 'Track', type: 'sfx' }],
    audioClips: [
      {
        id: 'bad-audio',
        assetId: 'missing-audio',
        trackId: 'track',
        time: 0,
        duration: 100,
        playback: 'dialogue-hold',
      },
    ],
    transitions: [{ id: 'bad-transition', type: 'unsupported', time: 0, duration: 100 }],
  };
  const report = new ProjectInspector().inspect(
    {
      definition: {
        version: 1,
        id: 'project',
        name: 'Project',
        characters: [],
        scenes: [{ id: 'a', path: 'a.json' }],
        stories: [story],
      },
      characters: new Map(),
      scenes: new Map([['a', scene]]),
    },
    'draft',
  );
  const issues = storyDiagnostics(report, story);
  expect(issues.some(({ issue, sceneId }) => sceneId === 'missing' && issue.message.includes('Missing scene'))).toBe(
    true,
  );
  expect(issues.some(({ issue, sceneId }) => sceneId === 'a' && issue.path.includes('dialogue'))).toBe(true);
  expect(issues.some(({ issue, sceneId }) => sceneId === 'a' && issue.path.includes('transitions'))).toBe(true);
  expect(issues.some(({ issue, sceneId }) => sceneId === 'a' && issue.path.includes('audio'))).toBe(true);
});
