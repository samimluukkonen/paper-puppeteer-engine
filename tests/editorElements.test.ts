import { assert, test } from 'vitest';
import { optionalElement, requireElement } from '../src/devtools/shared/editorElements.js';

// Node has no DOM; stand-in element classes let instanceof tell the types apart.
const InputStandIn = class InputStandIn {} as unknown as typeof HTMLInputElement;
const SelectStandIn = class SelectStandIn {} as unknown as typeof HTMLSelectElement;

function rootWith(elements: Record<string, object>): ParentNode {
  return { querySelector: (selector: string) => elements[selector] ?? null } as unknown as ParentNode;
}

test('requireElement returns the element with that id', () => {
  const input = new InputStandIn();
  const root = rootWith({ '#animation-event-time': input });
  assert.strictEqual(requireElement(root, 'animation-event-time', InputStandIn), input);
});

test('requireElement names the id when the element is missing', () => {
  assert.throws(
    () => requireElement(rootWith({}), 'animation-facing', SelectStandIn),
    'Missing editor element #animation-facing',
  );
});

test('requireElement names the id and expected type when the element has the wrong type', () => {
  const root = rootWith({ '#animation-facing': new InputStandIn() });
  assert.throws(
    () => requireElement(root, 'animation-facing', SelectStandIn),
    /#animation-facing is not a SelectStandIn/,
  );
});

test('optionalElement returns null only when the element is absent', () => {
  const select = new SelectStandIn();
  assert.isNull(optionalElement(rootWith({}), 'rig-tools-open', SelectStandIn));
  assert.strictEqual(optionalElement(rootWith({ '#rig-tools-open': select }), 'rig-tools-open', SelectStandIn), select);
  assert.throws(
    () => optionalElement(rootWith({ '#rig-tools-open': new InputStandIn() }), 'rig-tools-open', SelectStandIn),
    /#rig-tools-open is not a SelectStandIn/,
  );
});
