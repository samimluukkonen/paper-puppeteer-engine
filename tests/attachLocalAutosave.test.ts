import { afterEach, assert, beforeEach, test, vi } from 'vitest';
import {
  attachLocalAutosave,
  LocalAutosave,
  type PageLifecycleEvents,
} from '../src/devtools/shared/autosave/LocalAutosave.js';
import type { DraftStorage } from '../src/devtools/shared/autosave/LocalDraftStore.js';

class MemoryStorage implements DraftStorage {
  saved: string[] = [];
  claim(): Promise<void> {
    return Promise.resolve();
  }
  release = vi.fn(() => Promise.resolve());
  discard(): Promise<void> {
    return Promise.resolve();
  }
  save(_key: string, _owner: string, _name: string, revision: string): Promise<void> {
    this.saved.push(revision);
    return Promise.resolve();
  }
}

/** Counts registered listeners so tests can see that detach leaves none behind. */
class FakeTarget extends EventTarget {
  readonly listeners = new Set<string>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    super.addEventListener(type, listener);
    this.listeners.add(type);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    super.removeEventListener(type, listener);
    this.listeners.delete(type);
  }
}
class FakeDocument extends FakeTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

const detachers: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  detachers.splice(0).forEach((detach) => detach());
  vi.useRealTimers();
});

function fixture() {
  const storage = new MemoryStorage();
  const page = { window: new FakeTarget(), document: new FakeDocument() } satisfies PageLifecycleEvents;
  let revision = '1';
  const autosave = new LocalAutosave('scenes:/test', storage, () => ({
    revision,
    name: 'Test',
    dirty: true,
    build: () => Promise.resolve(new Map()),
  }));
  return {
    storage,
    page,
    autosave,
    /** Changes the authored revision without notifying anyone. */
    edit(value: string) {
      revision = value;
    },
    attach(options: Parameters<typeof attachLocalAutosave>[1] = {}) {
      const detach = attachLocalAutosave(autosave, { page, ...options });
      detachers.push(detach);
      return detach;
    },
  };
}

test('attaching starts saving and polls for edits nobody announced', async () => {
  const f = fixture();
  f.attach();
  await vi.advanceTimersByTimeAsync(1000);
  assert.deepEqual(f.storage.saved, ['1']);
  f.edit('2');
  await vi.advanceTimersByTimeAsync(1500);
  assert.deepEqual(f.storage.saved, ['1', '2']);
});

test('a change notification schedules the save without waiting for the poll', async () => {
  const f = fixture();
  const listeners = new Set<() => void>();
  f.attach({
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  await vi.advanceTimersByTimeAsync(1000);
  f.edit('2');
  listeners.forEach((listener) => listener());
  await vi.advanceTimersByTimeAsync(1000);
  assert.deepEqual(f.storage.saved, ['1', '2']);
});

test('pagehide releases the draft lease and stops saving until pageshow', async () => {
  const f = fixture();
  f.attach();
  await vi.advanceTimersByTimeAsync(1000);
  f.page.window.dispatchEvent(new Event('pagehide'));
  assert.equal(f.storage.release.mock.calls.length, 1);
  f.edit('2');
  await vi.advanceTimersByTimeAsync(5000);
  assert.deepEqual(f.storage.saved, ['1']);
  f.page.window.dispatchEvent(new Event('pageshow'));
  await vi.advanceTimersByTimeAsync(1000);
  assert.deepEqual(f.storage.saved, ['1', '2']);
});

test('hiding the tab saves immediately and showing it does not', async () => {
  const f = fixture();
  f.attach();
  await vi.advanceTimersByTimeAsync(1000);
  f.edit('2');
  f.page.document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  assert.deepEqual(f.storage.saved, ['1']);
  f.page.document.visibilityState = 'hidden';
  f.page.document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  assert.deepEqual(f.storage.saved, ['1', '2']);
});

test('detach removes every listener, subscription and timer and disposes the autosave', async () => {
  const f = fixture();
  const listeners = new Set<() => void>();
  const detach = f.attach({
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  await vi.advanceTimersByTimeAsync(1000);
  detach();
  assert.equal(listeners.size, 0);
  assert.equal(f.page.window.listeners.size, 0);
  assert.equal(f.page.document.listeners.size, 0);
  assert.equal(vi.getTimerCount(), 0);
  assert.equal(f.storage.release.mock.calls.length, 1);
});

test('a second detach does nothing', () => {
  const f = fixture();
  const detach = f.attach();
  detach();
  detach();
  assert.equal(f.storage.release.mock.calls.length, 1);
});
