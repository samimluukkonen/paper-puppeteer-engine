import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { IKBakePanel } from '../src/devtools/animation-editor/IKBakePanel.js';
import { ikBakeEditor, waitForIKBake } from './helpers/ikBakeEditor.js';

const effects = vi.hoisted(() => ({ cleanup: [] as Array<() => void> }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: (effect: () => () => void) => effects.cleanup.push(effect()),
}));
afterEach(() => {
  effects.cleanup = [];
});

test('panel reflects constraint selection, validation, FPS and real plan summary', async () => {
  const { controller } = ikBakeEditor();
  let markup = renderToStaticMarkup(IKBakePanel({ controller }));
  assert.include(markup, 'Select one or more IK constraints');
  assert.include(markup, 'disabled=""');
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  controller.setFPS('5');
  await waitForIKBake(controller);
  markup = renderToStaticMarkup(IKBakePanel({ controller }));
  assert.include(markup, 'checked=""');
  assert.include(markup, 'value="5"');
  assert.include(markup, 'Generated keys: 12');
  assert.include(markup, 'Existing keys to replace: 2');
  assert.include(markup, 'Constraints deactivated for this animation: arm');
  assert.include(markup, 'aria-label="Bake fidelity"');
  assert.include(markup, 'At keys: maximum joint error');
  assert.include(markup, 'Between keys: maximum joint error');
  controller.setFPS('0');
  await waitForIKBake(controller);
  markup = renderToStaticMarkup(IKBakePanel({ controller }));
  assert.include(markup, 'role="alert"');
  assert.notInclude(markup, 'aria-label="Bake summary"');
  assert.notInclude(markup, 'aria-label="Bake fidelity"');
  controller.dispose();
});

test('React unmount hides the preview without changing authored data or detaching the editor', async () => {
  const { controller, state, show } = ikBakeEditor();
  controller.setConstraint('arm', true);
  await waitForIKBake(controller);
  controller.togglePreview();
  const original = state.workingAnimation;
  IKBakePanel({ controller });
  effects.cleanup[0]!();
  assert.isFalse(controller.getSnapshot().preview);
  assert.isNull(show.mock.lastCall![0]);
  assert.strictEqual(state.workingAnimation, original);
  assert.equal(state.historyLength, 0);
  assert.isNull(controller.getSnapshot().plan);
  controller.dispose();
  effects.cleanup[0]!();
  assert.isNull(controller.getSnapshot().plan);
});
