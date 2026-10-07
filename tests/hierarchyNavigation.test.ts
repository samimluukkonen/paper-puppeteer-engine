import { assert, test, vi } from 'vitest';
import { navigateHierarchy, setHierarchyTabStop } from '../src/devtools/shared/hierarchyNavigation.js';

function fixture() {
  return [1, 2, 3, 2, 3].map((level) => ({
    level,
    button: { tabIndex: -1, focus: vi.fn(), click: vi.fn() },
  }));
}

function event(key: string) {
  return {
    key,
    defaultPrevented: false,
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
  };
}

test.each([
  ['ArrowDown', 0, 1],
  ['ArrowUp', 2, 1],
  ['ArrowLeft', 2, 1],
  ['ArrowLeft', 3, 0],
  ['ArrowRight', 0, 1],
  ['ArrowRight', 2, 2],
  ['ArrowUp', 0, 0],
  ['ArrowDown', 4, 4],
  ['Home', 3, 0],
  ['End', 0, 4],
] as const)('%s from entry %s focuses and selects entry %s', (key, from, to) => {
  const entries = fixture();
  const input = event(key);
  navigateHierarchy(input, entries[from]!.button, entries);
  assert.equal(input.preventDefault.mock.calls.length, 1);
  for (const [index, { button }] of entries.entries()) {
    const changed = from !== to && index === to;
    assert.equal(button.focus.mock.calls.length, Number(changed));
    assert.equal(button.click.mock.calls.length, Number(changed));
    if (changed) assert.deepEqual(button.focus.mock.calls[0], [{ preventScroll: true }]);
  }
});

test.each(['defaultPrevented', 'isComposing', 'altKey', 'ctrlKey', 'metaKey'] as const)(
  '%s preserves native and modified keyboard behavior',
  (guard) => {
    const entries = fixture();
    const input = { ...event('ArrowDown'), [guard]: true };
    navigateHierarchy(input, entries[0]!.button, entries);
    assert.equal(input.preventDefault.mock.calls.length, 0);
    assert.isTrue(entries.every(({ button }) => button.click.mock.calls.length === 0));
  },
);

test('unrecognized keys and detached buttons do not trigger navigation', () => {
  const entries = fixture();
  for (const [input, button] of [
    [event(' '), entries[0]!.button],
    [event('ArrowDown'), fixture()[0]!.button],
  ] as const) {
    navigateHierarchy(input, button, entries);
    assert.equal(input.preventDefault.mock.calls.length, 0);
  }
});

test('Tab enters the selected hierarchy entry and falls back to the first when cleared', () => {
  const entries = fixture();
  setHierarchyTabStop(entries);
  assert.deepEqual(
    entries.map(({ button }) => button.tabIndex),
    [0, -1, -1, -1, -1],
  );
  setHierarchyTabStop(entries, entries[3]!.button);
  assert.deepEqual(
    entries.map(({ button }) => button.tabIndex),
    [-1, -1, -1, 0, -1],
  );
  setHierarchyTabStop(entries);
  assert.equal(entries[0]!.button.tabIndex, 0);
  assert.doesNotThrow(() => setHierarchyTabStop([]));
});
