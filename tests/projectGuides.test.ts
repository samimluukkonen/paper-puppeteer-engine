import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, test } from 'vitest';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { GUIDE_TARGETS } from '../src/devtools/shared/guides/anchors.js';
import { GuideLauncher } from '../src/devtools/shared/guides/GuideLauncher.js';
import { projectGuideHost } from '../src/devtools/shared/guides/projectGuideHost.js';
import { guideRegistry } from '../src/devtools/shared/guides/registry.js';
import { FeatureGuideCatalog } from '../src/ui/FeatureGuideCatalog.js';

const guide = guideRegistry.getGuideById('project-audio-assets')!;

test('project audio guide uses stable anchors and reveal-only steps without asset prerequisites', () => {
  assert.equal(guide.title, 'Importing and Managing Audio');
  assert.equal(guide.editor, 'project');
  assert.equal(guide.category, 'audio');
  assert.lengthOf(guide.steps, 7);
  assert.deepEqual(guideRegistry.getGuidesForEditor('project'), [guide]);
  const anchors = new Set<string>(Object.values(GUIDE_TARGETS));
  for (const step of guide.steps) {
    assert.isTrue(anchors.has(step.targetId));
    assert.equal(step.preparation, 'reveal-target');
    assert.notEqual(step.mode, 'try-it');
    assert.isUndefined(step.prerequisites);
  }
  assert.deepEqual(
    guide.prerequisites?.map(({ capability }) => capability),
    ['tool:project'],
  );
});

test('project launch rechecks live availability, preserves metadata/binaries/history and never navigates to an editor', () => {
  let project: ProjectWorkspace | undefined;
  const host = projectGuideHost(() => !!project);
  const launcher = new GuideLauncher(host);
  assert.isFalse(launcher.getAvailability(guide.id).available);
  assert.isFalse(launcher.launch(guide.id).ok);
  project = new ProjectWorkspace('Audio guides', 'film');
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/audio/tone.wav', import.meta.url)));
  project.addAudio({ id: 'tone', name: 'Tone', path: 'audio/tone.wav', category: 'music' }, bytes);
  project.updateAudio('tone', { name: 'Changed' });
  project.undo();
  const before = [
    project.definition,
    project.autosaveRevision,
    project.dirty,
    project.history.canUndo,
    project.history.canRedo,
  ];
  assert.deepEqual(launcher.launch(guide.id), { ok: true });
  assert.isFalse(launcher.getAvailability(guide.id).available, 'one active guide per session');
  for (let index = 1; index < guide.steps.length; index++) assert.isTrue(launcher.controller.next().ok);
  assert.isTrue(launcher.controller.previous().ok);
  assert.isTrue(launcher.controller.restart().ok);
  assert.isTrue(launcher.controller.exit().ok);
  assert.deepEqual(
    [project.definition, project.autosaveRevision, project.dirty, project.history.canUndo, project.history.canRedo],
    before,
  );
  assert.deepEqual(project.audioSource('tone')!.bytes, bytes);
  assert.isFalse(host.getNavigationAvailability('rig').available);
  assert.isFalse(host.navigate('animation'));
  project = undefined;
  assert.isFalse(launcher.launch(guide.id).ok, 'a previously available project cannot authorize a later launch');
});

test('project catalog shares search/category controls and does not request a character for audio tours', () => {
  const launcher = new GuideLauncher(projectGuideHost(() => false));
  const html = renderToStaticMarkup(
    createElement(FeatureGuideCatalog, {
      editor: 'project',
      setEditor: () => {},
      guides: guideRegistry.getGuidesForEditor('project'),
      getAvailability: (id) => launcher.getAvailability(id),
      onStart: (id) => launcher.launch(id),
      onClose: () => {},
      hasCharacter: false,
      error: '',
      setError: () => {},
    }),
  );
  assert.include(html, 'Project Workspace');
  assert.include(html, 'Search guides');
  assert.include(html, guide.title);
  assert.include(html, 'Open Project Workspace');
  assert.notInclude(html, 'No character is loaded');
});
