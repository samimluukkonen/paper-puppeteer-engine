import { afterEach, assert, test, vi } from 'vitest';
import { protectUnsavedChanges } from '../src/devtools/shared/protectUnsavedChanges.js';

afterEach(() => vi.unstubAllGlobals());

test('navigation protection follows the current session and releases its listener', () => {
  const target = new EventTarget();
  vi.stubGlobal('window', target);
  let dirty = false;
  const release = protectUnsavedChanges(() => dirty);
  const navigate = () => {
    const event = new Event('beforeunload', { cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.isFalse(navigate());
  dirty = true;
  assert.isTrue(navigate());
  dirty = false;
  assert.isFalse(navigate());
  release();
  dirty = true;
  assert.isFalse(navigate());
});
