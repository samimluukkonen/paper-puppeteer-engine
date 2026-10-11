import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { IKBakePanel } from '../src/devtools/animation-editor/IKBakePanel.js';
import { ikBakeEditor } from './helpers/ikBakeEditor.js';

const effects = vi.hoisted(() => ({ cleanup: [] as Array<() => void> }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: (effect: () => () => void) => effects.cleanup.push(effect()),
}));
afterEach(() => {
  effects.cleanup = [];
});

test('panel reflects constraint selection, validation, FPS and real plan summary', () => {
  const { controller } = ikBakeEditor();
  let markup = renderToStaticMarkup(IKBakePanel({ controller }));
  assert.include(markup, 'Select one or more IK constraints');
  assert.include(markup, 'disabled=""');
  controller.setConstraint('arm', true);
  controller.setFPS('5');
  markup = renderToStaticMarkup(IKBakePanel({ controller }));
  assert.include(markup, 'checked=""');
  assert.include(markup, 'value="5"');
  assert.include(markup, 'Generated keys: 12');
  assert.include(markup, 'Existing keys to replace: 2');
  assert.include(markup, 'Constraints deactivated for this animation: arm');
  controller.setFPS('0');
  markup = renderToStaticMarkup(IKBakePanel({ controller }));
  assert.include(markup, 'role="alert"');
  assert.notInclude(markup, 'aria-label="Bake summary"');
  controller.dispose();
});

test('React unmount hides the preview without changing authored data or detaching the editor', () => {
  const { controller, state, show } = ikBakeEditor();
  controller.setConstraint('arm', true);
  controller.togglePreview();
  const original = state.workingAnimation;
  IKBakePanel({ controller });
  effects.cleanup[0]!();
  assert.isFalse(controller.getSnapshot().preview);
  assert.isNull(show.mock.lastCall![0]);
  assert.strictEqual(state.workingAnimation, original);
  assert.equal(state.historyLength, 0);
  assert.isTrue(controller.getSnapshot().plan?.success);
  controller.dispose();
  effects.cleanup[0]!();
  assert.isNull(controller.getSnapshot().plan);
});
