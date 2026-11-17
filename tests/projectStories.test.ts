import { expect, test } from 'vitest';
import { buildProjectDraft } from '../src/devtools/project/projectDrafts.js';
import { assetDependents, ProjectInspector } from '../src/devtools/project/projectInspection.js';
import {
  buildProjectPackage,
  buildProjectScenePackage,
  importProjectPackage,
} from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import type { StoryDefinition } from '../src/engine/StoryDefinition.js';

function fixture() {
  const workspace = new ProjectWorkspace('Film', 'project');
  for (const id of ['a', 'b']) workspace.createScene({ id, name: id });
  const story: StoryDefinition = {
    version: 1,
    id: 'film',
    name: 'Film',
    scenes: [
      { id: 'opening', sceneAssetId: 'a' },
      { id: 'middle', sceneAssetId: 'b' },
      { id: 'reprise', sceneAssetId: 'a' },
    ],
  };
  return { workspace, story };
}

test('stories share project history, dirty tracking and authored autosave revision', () => {
  const { workspace, story } = fixture();
  const before = workspace.autosaveRevision;
  workspace.setStory(story);
  expect(workspace.definition.stories).toEqual([story]);
  expect(workspace.autosaveRevision).not.toBe(before);
  expect(workspace.dirty).toBe(true);
  workspace.undo();
  expect(workspace.definition.stories).toBeUndefined();
  expect(workspace.autosaveRevision).toBe(before);
  workspace.redo();
  workspace.setStory({ ...story, name: 'Renamed' });
  expect(workspace.definition.stories).toHaveLength(1);
  workspace.removeStory(story.id);
  expect(workspace.definition.stories).toEqual([]);
  workspace.undo();
  expect(workspace.definition.stories?.[0]?.name).toBe('Renamed');
});

test('story edges protect scene removal; removing references allows removal and history restoration', () => {
  const { workspace, story } = fixture();
  workspace.setStory(story);
  const report = workspace.inspect('export');
  expect(report.counts.error).toBe(0);
  const uses = assetDependents(report, { kind: 'scene', owner: 'a', id: 'a' }).filter(
    ({ from }) => from.kind === 'story',
  );
  expect(uses).toHaveLength(2);
  expect(() => workspace.remove('scenes', 'a')).toThrow(/used by stories/);
  workspace.removeStory(story.id);
  workspace.remove('scenes', 'a');
  workspace.undo();
  workspace.undo();
  expect(workspace.inspect('export').counts.error).toBe(0);
  expect(workspace.definition.stories).toEqual([story]);
});

test.each(['export', 'draft'] as const)('stories survive %s archives, reopening and recovery', async (mode) => {
  const { workspace, story } = fixture();
  workspace.setStory(story);
  const files = mode === 'export' ? (await buildProjectPackage(workspace)).files : await buildProjectDraft(workspace);
  const reopened = await importProjectPackage(decodePackageZip(encodePackageZip(files)));
  expect(reopened.definition.stories).toEqual([story]);
  expect(reopened.definition.scenes).toHaveLength(2);
  expect(reopened.inspect('export').counts.error).toBe(0);
  if (mode === 'draft') {
    reopened.markRecovered('recovery-film');
    expect(reopened.recoveryKey).toBe('recovery-film');
    expect(reopened.hasUnsavedChanges).toBe(true);
    expect(reopened.definition.stories).toEqual([story]);
  }
  const manifest = new TextDecoder().decode(files.get('project.json'));
  expect(manifest).not.toContain('instanceId');
  expect(manifest).not.toContain('runner');
});

test('empty story drafts persist through both archive paths with a non-playable warning', async () => {
  const { workspace, story } = fixture();
  workspace.setStory({ ...story, scenes: [] });
  for (const mode of ['draft', 'export']) {
    const files = mode === 'draft' ? await buildProjectDraft(workspace) : (await buildProjectPackage(workspace)).files;
    const reopened = await importProjectPackage(files);
    expect(reopened.definition.stories?.[0]?.scenes).toEqual([]);
    expect(reopened.inspect().issues).toContainEqual(
      expect.objectContaining({
        asset: { kind: 'story', owner: 'project', id: 'film' },
        severity: 'warning',
      }),
    );
  }
});

test('old projects reopen without story data and standalone scene exports ignore unrelated stories', async () => {
  const { workspace } = fixture();
  const reopened = await importProjectPackage((await buildProjectPackage(workspace)).files);
  expect(reopened.definition.stories).toBeUndefined();
  reopened.setStory({ version: 1, id: 'draft', name: 'Draft', scenes: [] });
  const files = await buildProjectScenePackage(reopened, reopened.scenes.scene('a')!);
  expect(files.has('scene.json')).toBe(true);
  expect(files.has('project.json')).toBe(false);
});

test('broken story references fail authoring/import and leave the existing workspace intact', async () => {
  const { workspace, story } = fixture();
  expect(() => workspace.setStory({ ...story, scenes: [{ id: 'missing', sceneAssetId: 'missing' }] })).toThrow(
    /Missing scene asset/,
  );
  const files = (await buildProjectPackage(workspace)).files;
  const bytes = files.get('project.json')!;
  const archive = JSON.parse(new TextDecoder().decode(bytes)) as { project: { stories?: StoryDefinition[] } };
  archive.project.stories = [{ ...story, scenes: [{ id: 'broken', sceneAssetId: 'missing' }] }];
  files.set('project.json', new TextEncoder().encode(JSON.stringify(archive)));
  await expect(importProjectPackage(files)).rejects.toThrow(/Missing scene asset/);
  expect(workspace.definition.stories).toBeUndefined();
  expect(workspace.definition.scenes).toHaveLength(2);
});

test('inspection reports missing scenes and transitive broken character assets on their story', () => {
  const { story } = fixture();
  const scene = createEmptyScene({ id: 'a' });
  scene.actors.push({
    id: 'hero',
    character: { manifest: 'characters/hero/character.json' },
    position: { x: 0, y: 0 },
  });
  const report = new ProjectInspector().inspect(
    {
      definition: {
        version: 1,
        id: 'project',
        name: 'Film',
        stories: [story],
        scenes: [{ id: 'a', path: 'scenes/a.json' }],
        characters: [{ id: 'hero', name: 'Hero', manifest: 'characters/hero/character.json' }],
      },
      characters: new Map(),
      scenes: new Map([['a', scene]]),
    },
    'export',
  );
  const issues = report.issues.filter(({ asset }) => asset.kind === 'story');
  expect(issues.some(({ message }) => message.includes('Missing scene asset "b"'))).toBe(true);
  expect(issues.some(({ message }) => message.includes('Working document is missing'))).toBe(true);
});

test('entry transitions validate atomically, duplicate in one history operation and survive project export', async () => {
  const { workspace, story } = fixture();
  workspace.setStory(story);
  workspace.setStorySceneTransition('film', 'middle', { type: 'fade', duration: 600, color: '#334455' });
  const before = workspace.definition.stories;
  expect(() =>
    workspace.setStorySceneTransition('film', 'middle', { type: 'fade', duration: -1, color: '#334455' }),
  ).toThrow();
  expect(workspace.definition.stories).toEqual(before);
  const duplicate = workspace.duplicateStoryScene('film', 'middle');
  expect(workspace.definition.stories![0]!.scenes.find(({ id }) => id === duplicate)?.transition).toEqual({
    type: 'fade',
    duration: 600,
    color: '#334455',
  });
  workspace.undo();
  expect(workspace.definition.stories).toEqual(before);
  const reopened = await importProjectPackage((await buildProjectPackage(workspace)).files);
  expect(reopened.definition.stories).toEqual(before);
});
