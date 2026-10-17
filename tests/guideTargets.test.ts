import { assert, test, vi } from 'vitest';
import { GuideTargets, type GuideRectangle } from '../src/devtools/shared/guides/index.js';

const bounds: GuideRectangle = { x: 20, y: 30, width: 200, height: 100 };

/** Only the DOM surface used by the resolver; no Phaser, browser installation, or simulated scene. */
function anchor(id: string) {
  const attributes = new Map([['data-guide-id', id]]);
  const node = {
    tagName: 'DIV',
    parentElement: null as Element | null,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: vi.fn((name: string, value: string) => {
      attributes.set(name, value);
    }),
    closest: vi.fn<(selector: string) => Element | null>(() => null),
    getClientRects: vi.fn(() => [bounds]),
    getBoundingClientRect: vi.fn(() => bounds),
    scrollIntoView: vi.fn(),
    ownerDocument: { defaultView: { getComputedStyle: vi.fn(() => ({ visibility: 'visible' })) } },
  };
  return { node, element: node as unknown as Element, attributes };
}

function root(elements: Element[]) {
  const querySelectorAll = vi.fn<(selector: string) => Element[]>(() => elements);
  return { querySelectorAll, parent: { querySelectorAll } as unknown as ParentNode };
}

test('DOM controls and entire panels use the same viewport rectangle, measured anew after layout changes', () => {
  const control = anchor('time');
  const panel = anchor('panel');
  const host = root([control.element, panel.element]);
  const targets = new GuideTargets(host.parent);
  assert.deepEqual(targets.resolve('time'), bounds);
  assert.deepEqual(targets.resolve('panel'), bounds);
  assert.notStrictEqual(targets.resolve('time'), bounds, 'do not expose provider-owned geometry');
  control.node.getBoundingClientRect.mockReturnValue({ x: 50, y: -10, width: 300, height: 50 });
  assert.deepEqual(targets.resolve('time'), { x: 50, y: -10, width: 300, height: 50 });
  assert.deepEqual(host.querySelectorAll.mock.calls[0], ['[data-guide-id]']);
});

test('missing, duplicate, collapsed, hidden, inert, and invisible targets resolve to null', () => {
  const item = anchor('target');
  const host = root([item.element]);
  const targets = new GuideTargets(host.parent);
  assert.isNull(targets.resolve('missing'));
  item.node.getClientRects.mockReturnValue([]);
  assert.isNull(targets.resolve('target'));
  item.node.getClientRects.mockReturnValue([bounds]);
  item.node.closest.mockReturnValue(item.element);
  assert.isNull(targets.resolve('target'));
  item.node.closest.mockReturnValue(null);
  item.node.ownerDocument.defaultView.getComputedStyle.mockReturnValue({ visibility: 'hidden' });
  assert.isNull(targets.resolve('target'));
  item.node.ownerDocument.defaultView.getComputedStyle.mockReturnValue({ visibility: 'collapse' });
  assert.isNull(targets.resolve('target'));
  const duplicate = new GuideTargets(root([item.element, anchor('target').element]).parent);
  assert.isNull(duplicate.resolve('target'));
  assert.isFalse(duplicate.reveal('target'));
});

test('target IDs match exact attributes without becoming CSS selectors', () => {
  const id = 'target"], [data-danger="x';
  const item = anchor(id);
  const host = root([item.element]);
  assert.deepEqual(new GuideTargets(host.parent).resolve(id), bounds);
  assert.deepEqual(host.querySelectorAll.mock.calls, [['[data-guide-id]']]);
});

test('safe DOM reveal opens only disclosures, requests the existing drawer, and scrolls without clicking', () => {
  const item = anchor('properties');
  const details = anchor('panel');
  details.node.tagName = 'DETAILS';
  item.node.parentElement = details.element;
  const dispatchEvent = vi.fn<(event: Event) => boolean>(() => true);
  const shell = { dispatchEvent } as unknown as Element;
  const inspector = { closest: vi.fn(() => shell) } as unknown as Element;
  item.node.closest.mockImplementation((selector) => (selector === '[data-guide-inspector]' ? inspector : null));
  const targets = new GuideTargets(root([item.element]).parent);
  assert.isFalse(details.attributes.has('open'), 'inspectors start collapsed');
  assert.isTrue(targets.reveal('properties'));
  assert.equal(details.attributes.get('open'), '');
  assert.deepEqual(item.node.scrollIntoView.mock.calls, [
    [{ block: 'nearest', inline: 'nearest', behavior: 'instant' }],
  ]);
  assert.lengthOf(dispatchEvent.mock.calls, 1);
  assert.equal(dispatchEvent.mock.calls[0]![0].type, 'workspace:reveal-inspector');
  assert.isFalse(targets.reveal('missing'));
  item.node.closest.mockReturnValue(item.element);
  assert.isFalse(targets.reveal('properties'), 'do not unhide an inactive editor');
});

test('geometry providers support canvas regions, live measurement, explicit reveal, and safe cleanup', () => {
  const host = root([]);
  const targets = new GuideTargets(host.parent);
  const getRectangle = vi.fn<() => GuideRectangle | null>(() => bounds);
  const reveal = vi.fn(() => true);
  const provider = { getRectangle, reveal };
  const release = targets.registerGeometry('ik-handle', provider);
  assert.deepEqual(targets.resolve('ik-handle'), bounds);
  assert.lengthOf(host.querySelectorAll.mock.calls, 0, 'canvas geometry never uses DOM selectors');
  getRectangle.mockReturnValue({ x: 100, y: 200, width: 12, height: 12 });
  assert.deepEqual(targets.resolve('ik-handle'), { x: 100, y: 200, width: 12, height: 12 });
  assert.isTrue(targets.reveal('ik-handle'));
  assert.lengthOf(reveal.mock.calls, 1);
  assert.throws(() => targets.registerGeometry('ik-handle', provider), /duplicate/);
  assert.throws(() => targets.registerGeometry('', provider), /Invalid/);
  getRectangle.mockReturnValue(null);
  assert.isNull(targets.resolve('ik-handle'));
  release();
  getRectangle.mockReturnValue(bounds);
  const releaseNew = targets.registerGeometry('ik-handle', provider);
  release();
  assert.deepEqual(targets.resolve('ik-handle'), bounds, 'old cleanup must not remove a later registration');
  releaseNew();
  assert.isNull(targets.resolve('ik-handle'));
});

test('invalid and disposed geometry fails safely without selecting a DOM fallback', () => {
  const item = anchor('canvas');
  const targets = new GuideTargets(root([item.element]).parent);
  const getRectangle = vi.fn<() => GuideRectangle | null>(() => null);
  const release = targets.registerGeometry('canvas', { getRectangle });
  assert.isNull(targets.resolve('canvas'));
  assert.isFalse(targets.reveal('canvas'));
  for (const invalid of [
    { ...bounds, x: NaN },
    { ...bounds, y: Infinity },
    { ...bounds, width: 0 },
    { ...bounds, height: -1 },
  ]) {
    getRectangle.mockReturnValue(invalid);
    assert.isNull(targets.resolve('canvas'));
  }
  getRectangle.mockImplementation(() => {
    throw new Error('Scene disposed');
  });
  assert.isNull(targets.resolve('canvas'));
  release();
  assert.deepEqual(targets.resolve('canvas'), bounds);
  const releaseBroken = targets.registerGeometry('canvas', {
    getRectangle: () => bounds,
    reveal: () => {
      throw new Error('Panel disposed');
    },
  });
  assert.isFalse(targets.reveal('canvas'));
  releaseBroken();
});
