import { expect, test } from 'vitest';
import { parseProjectDefinition } from '../src/devtools/project/ProjectDefinition.js';
import { generateJsonSchemas } from '../src/engine/jsonSchemas.js';
import { createEmptyScene } from '../src/engine/SceneDefinition.js';
import {
  parseStoryDefinition,
  parseStoryJson,
  serializeStoryDefinition,
  validateStoryDefinition,
  StoryValidationError,
  type StoryDefinition,
} from '../src/engine/StoryDefinition.js';

const story: StoryDefinition = {
  version: 1,
  id: 'film',
  name: 'Film',
  description: 'A linear film',
  scenes: [
    { id: 'opening', sceneAssetId: 'a' },
    { id: 'reprise', sceneAssetId: 'a' },
  ],
};
const scenes = new Map([['a', createEmptyScene({ id: 'a' })]]);

test('story round trip owns detached ordered references, preserving duplicate scene assets', () => {
  const parsed = parseStoryJson(serializeStoryDefinition(story), { scenes, requirePlayable: true });
  expect(parsed).toEqual(story);
  parsed.scenes[0]!.id = 'changed';
  expect(story.scenes[0]!.id).toBe('opening');
  expect(generateJsonSchemas()).toHaveProperty('story.schema.json');
});

test('empty stories are serializable drafts and fail playable validation', () => {
  const draft = { ...story, scenes: [] };
  expect(parseStoryJson(serializeStoryDefinition(draft))).toEqual(draft);
  expect(validateStoryDefinition(draft)).toEqual([expect.objectContaining({ severity: 'warning' })]);
  expect(() => parseStoryDefinition(draft, { requirePlayable: true })).toThrow(StoryValidationError);
});

test.each([
  {
    ...story,
    scenes: [
      { id: 'same', sceneAssetId: 'a' },
      { id: 'SAME', sceneAssetId: 'a' },
    ],
  },
  { ...story, scenes: [{ id: 'entry', sceneAssetId: 'missing' }] },
  { ...story, scenes: { 0: story.scenes[0] } },
  { ...story, scenes: [story.scenes[0], undefined] },
  { ...story, scenes: [{ ...story.scenes[0], order: 2 }] },
  { ...story, scenes: [{ ...story.scenes[0], transition: { type: 'crossfade' } }] },
  { ...story, transitions: [] },
  { ...story, version: 2 },
])('reject invalid references, identity, order, transitions and format: %j', (input) => {
  expect(() => parseStoryDefinition(input, { scenes })).toThrow(StoryValidationError);
});

test('story validation uses existing scene rules and authoritative dependency catalogs', () => {
  const scene = {
    ...scenes.get('a')!,
    actors: [{ id: 'hero', character: { manifest: 'missing.json' }, position: { x: 0, y: 0 } }],
  };
  const issues = validateStoryDefinition(story, {
    scenes: new Map([['a', scene]]),
    sceneOptions: { characters: new Map() },
  });
  expect(issues.some(({ severity, message }) => severity === 'error' && message.includes('missing.json'))).toBe(true);
  expect(() => parseStoryDefinition(story, { scenes: new Map([['a', { ...scene, id: 'wrong' }]]) })).toThrow(
    /different document ID/,
  );
});

test('version-1 projects remain unchanged and validate unique story IDs and entry IDs', () => {
  const old = { version: 1, id: 'project', name: 'Project', characters: [], scenes: [] };
  expect(parseProjectDefinition(old)).toEqual(old);
  expect(() => parseProjectDefinition({ ...old, stories: [story, { ...story, id: 'FILM' }] })).toThrow(
    /Duplicate story ID/,
  );
  expect(() =>
    parseProjectDefinition({ ...old, stories: [{ ...story, scenes: [story.scenes[0], story.scenes[0]] }] }),
  ).toThrow(/Duplicate story entry ID/);
});
