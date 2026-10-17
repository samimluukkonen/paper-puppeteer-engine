import { afterEach, assert, test, vi } from 'vitest';
import { GuideController } from '../src/devtools/shared/guides/GuideController.js';
import { GuideSpotlight } from '../src/ui/GuideSpotlight.js';

const hooks = vi.hoisted(() => ({
  refs: [] as unknown[],
  effects: [] as Array<() => void | (() => void)>,
  observe: vi.fn(),
  stopObserving: vi.fn(),
}));
// Exercise the component's effect teardown contract. Geometry/event disposal runs in observeGuideTarget.test.ts;
// actual modal interaction and layout run in the local browser suite.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useId: () => 'lifecycle',
  useRef: () => ({ current: hooks.refs.shift() }),
  useState: (value: unknown) => [value, vi.fn()],
  useLayoutEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }));
vi.mock('../src/ui/observeGuideTarget.js', () => ({ observeGuideTarget: hooks.observe }));
afterEach(() => {
  hooks.effects = [];
  hooks.refs = [];
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('spotlight unmount closes its modal, restores focus and releases target observation and card measurement', () => {
  class ElementStub {
    isConnected = true;
    focus = vi.fn();
    closest = () => null;
  }
  const opener = new ElementStub();
  const dialog = { showModal: vi.fn(), close: vi.fn() };
  const card = { getBoundingClientRect: () => ({ width: 360, height: 320 }) };
  const heading = { focus: vi.fn() };
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('document', { activeElement: opener, body: {}, querySelector: vi.fn() });
  vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 1000 });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = observe;
      disconnect = disconnect;
    },
  );
  hooks.refs = [dialog, card, heading];
  hooks.observe.mockReturnValue(hooks.stopObserving);
  const controller = new GuideController({ editor: 'animation', capabilities: ['character', 'valid-rig'] });
  controller.start('animation-new');
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, 'active');
  if (snapshot.status !== 'active') throw new Error('Expected active guide');
  const targets = { resolve: () => null, reveal: () => true };
  GuideSpotlight({ controller, snapshot, targets });
  const cleanup = hooks.effects.map((effect) => effect());
  assert.lengthOf(dialog.showModal.mock.calls, 1);
  assert.strictEqual(hooks.observe.mock.calls[0]![0], targets);
  assert.equal(hooks.observe.mock.calls[0]![1], 'animation-new');
  assert.deepEqual(observe.mock.calls, [[card]]);
  for (const release of cleanup) release?.();
  assert.lengthOf(dialog.close.mock.calls, 1);
  assert.deepEqual(opener.focus.mock.calls, [[{ preventScroll: true }]]);
  assert.lengthOf(hooks.stopObserving.mock.calls, 1);
  assert.lengthOf(disconnect.mock.calls, 1);
});
