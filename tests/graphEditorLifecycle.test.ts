import { setMaxListeners } from 'node:events';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, assert, test, vi } from 'vitest';
import { AnimationEditorState } from '../src/devtools/animation-editor/AnimationEditorState.js';
import { GraphEditorController } from '../src/devtools/animation-editor/GraphEditorController.js';
import { GraphEditorPanel } from '../src/devtools/animation-editor/GraphEditorPanel.js';
import { Rig } from '../src/engine/Rig.js';

afterEach(() => vi.unstubAllGlobals());
test('React graph markup has stable SVG hosts, labelled controls and initially collapsed tangent details', () => {
  const html = renderToStaticMarkup(createElement(GraphEditorPanel));
  assert.include(html, 'id="graph-editor"');
  assert.include(html, 'id="graph-drawing"');
  assert.include(html, 'aria-label="Graph property"');
  assert.include(html, 'aria-label="Tangent precision editing"');
  assert.notMatch(html, /<details[^>]*open/);
});
class GraphElement extends EventTarget {
  hidden = true;
  textContent = '';
  classList = { toggle: vi.fn() };
  setAttribute = vi.fn();
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 640, height: 220 };
  }
  hasPointerCapture() {
    return false;
  }
}
test('controller teardown cancels graph proposals, disconnects resize and removes listeners before remount', () => {
  const browser = new EventTarget();
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', { querySelector: () => null });
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  const elements = new Map<string, GraphElement>();
  const app = {
    querySelector(selector: string) {
      if (!elements.has(selector)) elements.set(selector, new GraphElement());
      return elements.get(selector)!;
    },
  } as unknown as HTMLElement;
  const rig = new Rig({ root: 'root', bones: [{ id: 'root' }] });
  const state = new AnimationEditorState(rig, [
    {
      name: 'test',
      duration: 1000,
      loop: false,
      tracks: {
        root: [
          { time: 0, x: 0 },
          { time: 1000, x: 1 },
        ],
      },
    },
  ]);
  state.selectAnimation('test');
  const ref = { channel: { kind: 'bone', id: 'root', property: 'x' } as const, time: 0 };
  const create = () => {
    const controller = new GraphEditorController(app, () => state);
    controller.render();
    return controller;
  };
  // AbortSignal owns many graph control listeners, just as it does in browsers.
  const abort = globalThis.AbortController;
  vi.stubGlobal(
    'AbortController',
    class extends abort {
      constructor() {
        super();
        setMaxListeners(0, this.signal);
      }
    },
  );
  const first = create();
  state.graph.beginGraphEdit(ref);
  state.graph.previewGraphEdit({ value: 0.5 });
  first.dispose();
  assert.isFalse(state.graph.graphEditActive);
  assert.equal(disconnect.mock.calls.length, 1);
  state.graph.beginGraphEdit(ref);
  browser.dispatchEvent(new Event('blur'));
  assert.isTrue(state.graph.graphEditActive);
  const second = create();
  browser.dispatchEvent(new Event('blur'));
  assert.isFalse(state.graph.graphEditActive);
  second.dispose();
  assert.equal(disconnect.mock.calls.length, 2);
  assert.equal(state.historyLength, 0);
});
