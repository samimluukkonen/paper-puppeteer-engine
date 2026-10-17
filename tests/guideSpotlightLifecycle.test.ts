import { afterEach, assert, test, vi } from 'vitest';
import { GuideController } from '../src/devtools/shared/guides/GuideController.js';
import { GuideSpotlight } from '../src/ui/GuideSpotlight.js';

const hooks = vi.hoisted(() => ({
  refs: [] as unknown[],
  practiceStep: null as unknown,
  contain: vi.fn(),
  releaseInteraction: vi.fn(),
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
  useState: (value: unknown) => [value === null ? hooks.practiceStep : value, vi.fn()],
  useLayoutEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
vi.mock('../src/ui/guideInteraction.js', () => ({ containGuideInteraction: hooks.contain }));
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }));
vi.mock('../src/ui/observeGuideTarget.js', () => ({ observeGuideTarget: hooks.observe }));
afterEach(() => {
  hooks.effects = [];
  hooks.refs = [];
  hooks.practiceStep = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test.each([false, true])(
  'spotlight cleanup restores focus and releases modal, observation and practice resources; practice=%s',
  async (practice) => {
    class ElementStub {
      isConnected = true;
      focus = vi.fn();
      closest = () => null;
    }
    const opener = new ElementStub();
    const dialog = { showModal: vi.fn(), show: vi.fn(), close: vi.fn() };
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
    const controller = new GuideController({
      editor: 'animation',
      capabilities: ['character', 'valid-rig', 'animation'],
    });
    controller.start(practice ? 'animation-onion-skinning' : 'animation-new');
    const snapshot = controller.getSnapshot();
    assert.equal(snapshot.status, 'active');
    if (snapshot.status !== 'active') throw new Error('Expected active guide');
    if (practice) hooks.practiceStep = snapshot.currentStep;
    hooks.contain.mockReturnValue(hooks.releaseInteraction);
    const targets = { resolve: () => null, reveal: () => true };
    GuideSpotlight({ controller, snapshot, targets });
    const cleanup = hooks.effects.map((effect) => effect());
    assert.lengthOf(dialog.showModal.mock.calls, practice ? 0 : 1);
    assert.lengthOf(dialog.show.mock.calls, practice ? 1 : 0);
    assert.strictEqual(hooks.observe.mock.calls[0]![0], targets);
    assert.equal(hooks.observe.mock.calls[0]![1], practice ? 'animation-onion' : 'animation-new');
    assert.deepEqual(observe.mock.calls, [[card]]);
    for (const release of cleanup) release?.();
    await Promise.resolve();
    assert.lengthOf(dialog.close.mock.calls, 2);
    assert.deepEqual(opener.focus.mock.calls, [[{ preventScroll: true }]]);
    assert.lengthOf(hooks.stopObserving.mock.calls, 1);
    assert.lengthOf(disconnect.mock.calls, 1);
    assert.lengthOf(hooks.releaseInteraction.mock.calls, practice ? 1 : 0);
  },
);
