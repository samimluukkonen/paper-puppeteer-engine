import { assert, test, vi } from 'vitest';
import { registerGraphGuideTargets } from '../src/devtools/animation-editor/graphGuideTargets.js';
import { GUIDE_TARGETS as ids } from '../src/devtools/shared/guides/anchors.js';
import { GuideTargets } from '../src/devtools/shared/guides/GuideTargets.js';

function fixture() {
  let graph = false;
  let hidden = false;
  let precision = false;
  const bounds = { x: 20, y: 30, width: 200, height: 100, right: 220, bottom: 130 };
  const details = {
    tagName: 'DETAILS',
    parentElement: null,
    getAttribute: () => null,
    setAttribute: () => {
      precision = true;
    },
    ownerDocument: { defaultView: { getComputedStyle: () => ({}) } },
    getBoundingClientRect: () => bounds,
  };
  const item = (id: string, inGraph: boolean, tangent = false) => ({
    tagName: 'DIV',
    parentElement: tangent ? details : null,
    getAttribute: (name: string) => (name === 'data-guide-id' ? id : null),
    closest: (selector: string) => (selector.includes('[hidden]') && (hidden || inGraph !== graph) ? details : null),
    ownerDocument: { defaultView: { getComputedStyle: () => ({}) } },
    getClientRects: () => (tangent && !precision ? [] : [bounds]),
    getBoundingClientRect: () => bounds,
    scrollIntoView: vi.fn(),
  });
  const property = item(ids.animationGraphProperty, true);
  const canvas = item(ids.animationGraphCanvas, true);
  const tangent = item(ids.animationGraphTangents, true, true);
  const ruler = item(ids.animationRuler, false);
  const elements = [property, canvas, tangent, ruler];
  const app = { closest: () => (hidden ? details : null), querySelectorAll: () => elements } as unknown as HTMLElement;
  const guides = new GuideTargets({ querySelectorAll: () => [] } as unknown as ParentNode);
  const revealView = vi.fn((active: boolean) => {
    graph = active;
  });
  const release = registerGraphGuideTargets(app, guides, revealView);
  return {
    guides,
    property,
    revealView,
    release,
    setHidden: (value: boolean) => {
      hidden = value;
    },
  };
}
test('graph/timeline guide preparation reveals the matching view and opens only tangent disclosure', () => {
  const f = fixture();
  assert.isNull(f.guides.resolve(ids.animationGraphProperty));
  assert.isTrue(f.guides.reveal(ids.animationGraphProperty));
  assert.deepEqual(f.revealView.mock.lastCall, [true]);
  assert.deepEqual(f.guides.resolve(ids.animationGraphProperty), { x: 20, y: 30, width: 200, height: 100 });
  assert.strictEqual(f.guides.resolveElement(ids.animationGraphProperty), f.property as unknown as Element);
  assert.isNull(f.guides.resolve(ids.animationGraphTangents));
  assert.isTrue(f.guides.reveal(ids.animationGraphTangents));
  assert.isNotNull(f.guides.resolve(ids.animationGraphTangents));
  assert.isTrue(f.guides.reveal(ids.animationRuler));
  assert.deepEqual(f.revealView.mock.lastCall, [false]);
  assert.isNotNull(f.guides.resolve(ids.animationRuler));
  assert.isNull(f.guides.resolve(ids.animationGraphProperty));
  f.release();
});
test('missing targets and inactive workspaces do not switch views; teardown releases every registration', () => {
  const f = fixture();
  assert.isFalse(f.guides.reveal(ids.animationGraphKeys));
  assert.lengthOf(f.revealView.mock.calls, 0);
  f.setHidden(true);
  assert.isFalse(f.guides.reveal(ids.animationGraphCanvas));
  assert.lengthOf(f.revealView.mock.calls, 0);
  f.setHidden(false);
  assert.isTrue(f.guides.reveal(ids.animationGraphCanvas));
  f.release();
  f.release();
  assert.isNull(f.guides.resolve(ids.animationGraphCanvas));
  assert.isNull(f.guides.resolveElement(ids.animationGraphCanvas));
  // Remount must be able to own the same IDs without duplicate providers.
  const next = registerGraphGuideTargets(
    { closest: () => null, querySelectorAll: () => [] } as unknown as HTMLElement,
    f.guides,
    f.revealView,
  );
  next();
});
