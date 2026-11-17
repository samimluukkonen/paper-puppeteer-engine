import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, test } from 'vitest';
import { createNewCharacter } from '../src/devtools/animation-editor/characterDocuments.js';
import type { CharacterEditorContext, SceneEditorContext } from '../src/devtools/project/projectBridge.js';
import { SceneAnimationLibrary } from '../src/devtools/scene-editor/SceneAnimationLibrary.js';
import type { AnimationLibraryEntry } from '../src/devtools/shared/animationLibraryData.js';
import { ProjectContextProvider } from '../src/ui/projectContext.js';

const definition = createNewCharacter({ id: 'hero', name: 'Hero' }).definition;
const entry = (name: string): AnimationLibraryEntry => ({
  character: 'hero',
  characterName: 'Hero',
  rigIdentity: 'hero',
  clip: { name, duration: 1, loop: false, tracks: {} },
});

// Only the members SceneAnimationLibrary reads; the provider, not window.parent, supplies the context.
const project = {
  kind: 'scene',
  subscribe: () => () => {},
  animationLibraryRevision: () => 0,
  choices: [{ id: 'hero', label: 'Hero', manifest: 'hero.json', rigIdentity: 'hero' }],
  animationLibrary: () => [entry('walk'), entry('run')],
} satisfies Partial<SceneEditorContext> as Partial<SceneEditorContext> as SceneEditorContext;

const render = (context: SceneEditorContext | undefined) =>
  renderToStaticMarkup(
    createElement(ProjectContextProvider, {
      value: context,
      children: createElement(SceneAnimationLibrary, { definition, manifest: 'hero.json', onUse: () => {} }),
    }),
  );

test('scene animation library reads the project library from the provided scene context', () => {
  assert.notProperty(globalThis, 'window');
  assert.include(render(project), 'Animation Library (2)');
});

test('scene animation library falls back to the character clips without a project context', () => {
  assert.include(render(undefined), `Animation Library (${definition.animations.length})`);
});

test('each editor context exposes only its own kind members', () => {
  const scene = {} as SceneEditorContext;
  const character = {} as CharacterEditorContext;
  // @ts-expect-error The scene editor has no character definition to read.
  assert.isUndefined(scene.definition);
  // @ts-expect-error The animation editor has no scene document to read.
  assert.isUndefined(character.scenes);
});
