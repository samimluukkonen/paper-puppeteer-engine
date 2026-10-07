import { afterEach, assert, test, vi } from 'vitest';
import { z } from 'zod';
import { DraftRecovery, type DraftSession } from '../src/devtools/shared/DraftRecovery.js';
import { draftSource } from '../src/devtools/shared/draftSource.js';

const schema = z.strictObject({ value: z.number() });
type Snapshot = z.infer<typeof schema>;
const recoveries: DraftRecovery<Snapshot>[] = [];
afterEach(() => {
  for (const recovery of recoveries.splice(0)) recovery.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture(stored?: string) {
  vi.useFakeTimers();
  const values = new Map<string, string>(stored === undefined ? [] : [['paper-puppeteer:draft:a', stored]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  const confirm = vi.fn(() => true);
  const windowTarget = Object.assign(new EventTarget(), { localStorage: storage, confirm });
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('document', documentTarget);
  const status = vi.fn<(message: string) => void>();
  const recovery = new DraftRecovery<Snapshot>(status);
  recoveries.push(recovery);
  let snapshot: Snapshot = Object.freeze({ value: 0 });
  let dirty = false;
  const session: DraftSession<Snapshot> = {
    key: 'a',
    source: 'original',
    label: 'test',
    snapshot: () => snapshot,
    dirty: () => dirty,
    data: (snapshot) => snapshot,
    validate: (data) => schema.safeParse(data).success,
    restore: vi.fn((data) => {
      snapshot = schema.parse(data);
      dirty = true;
      return true;
    }),
  };
  const edit = (value: number, unsaved = true) => {
    snapshot = Object.freeze({ value });
    dirty = unsaved;
    recovery.update();
  };
  return { recovery, session, values, storage, confirm, status, edit, windowTarget, documentTarget };
}

test('authored edits debounce and unchanged playback notifications do not postpone or repeat writes', () => {
  const { recovery, session, edit, storage } = fixture();
  recovery.bind(session);
  edit(1);
  vi.advanceTimersByTime(200);
  recovery.update();
  assert.equal(storage.setItem.mock.calls.length, 0);
  vi.advanceTimersByTime(100);
  assert.equal(storage.setItem.mock.calls.length, 1);
  for (let frame = 0; frame < 100; frame++) recovery.update();
  vi.advanceTimersByTime(1000);
  assert.equal(storage.setItem.mock.calls.length, 1);
  edit(2);
  edit(3);
  vi.advanceTimersByTime(300);
  assert.include(storage.setItem.mock.calls.at(-1)![1], '"value":3');
});

test('saving, discarding, or undoing to a clean baseline removes the draft and cancels pending writes', () => {
  const { recovery, session, edit, values } = fixture();
  recovery.bind(session);
  edit(1);
  vi.advanceTimersByTime(300);
  assert.equal(values.size, 1);
  edit(0, false);
  assert.equal(values.size, 0);
  edit(2);
  edit(0, false);
  vi.advanceTimersByTime(1000);
  assert.equal(values.size, 0);
});

test.each(['pagehide', 'beforeunload', 'hidden', 'dispose'])(
  'final edits flush on %s before debounce fires',
  (event) => {
    const { recovery, session, edit, values, windowTarget, documentTarget } = fixture();
    recovery.bind(session);
    edit(4);
    if (event === 'dispose') recovery.dispose();
    else if (event === 'hidden') {
      documentTarget.visibilityState = 'hidden';
      documentTarget.dispatchEvent(new Event('visibilitychange'));
    } else windowTarget.dispatchEvent(new Event(event));
    assert.include(values.get('paper-puppeteer:draft:a')!, '"value":4');
  },
);

test('switching documents flushes the last captured snapshot under its own key', () => {
  const { recovery, session, edit, values } = fixture();
  recovery.bind(session);
  edit(1);
  // The adapter now points to the new document before the selection notification binds its session.
  session.snapshot = () => ({ value: 99 });
  const next = { ...session, key: 'b', snapshot: () => ({ value: 99 }), dirty: () => true };
  recovery.bind(next);
  assert.include(values.get('paper-puppeteer:draft:a')!, '"value":1');
  vi.advanceTimersByTime(300);
  assert.include(values.get('paper-puppeteer:draft:b')!, '"value":99');
});

test('an invalid intermediate edit retains the last valid stored draft', () => {
  const { recovery, session, edit, values } = fixture();
  recovery.bind(session);
  edit(1);
  vi.advanceTimersByTime(300);
  const valid = values.get('paper-puppeteer:draft:a');
  edit(NaN);
  vi.advanceTimersByTime(300);
  assert.equal(values.get('paper-puppeteer:draft:a'), valid);
});

test("a clean second tab cannot delete another tab's draft on update, navigation or disposal", () => {
  const { recovery, session, edit, values } = fixture();
  recovery.bind(session);
  const clean = new DraftRecovery<Snapshot>(() => {});
  recoveries.push(clean);
  clean.bind({ ...session, snapshot: () => ({ value: 0 }), dirty: () => false });
  edit(42);
  recovery.flush();
  const stored = values.get('paper-puppeteer:draft:a');
  clean.update();
  clean.flush();
  clean.dispose();
  assert.equal(values.get('paper-puppeteer:draft:a'), stored);
});

test('saving an older revision preserves a newer draft, including identical authored values', () => {
  const { recovery, session, edit, values } = fixture();
  recovery.bind(session);
  edit(42);
  recovery.flush();
  const second = new DraftRecovery<Snapshot>(() => {});
  recoveries.push(second);
  second.bind({ ...session, snapshot: () => ({ value: 42 }), dirty: () => true, restore: () => true });
  second.flush();
  const newer = values.get('paper-puppeteer:draft:a');
  edit(42, false);
  assert.equal(values.get('paper-puppeteer:draft:a'), newer);
});

test("lifecycle flushes do not rewrite unchanged snapshots or overwrite a newer tab's draft", () => {
  const { recovery, session, edit, storage, values } = fixture();
  recovery.bind(session);
  edit(1);
  recovery.flush();
  const newer = JSON.stringify({ version: 1, source: 'original', data: { value: 2 }, revision: 'other-tab' });
  values.set('paper-puppeteer:draft:a', newer);
  recovery.flush();
  recovery.flush();
  assert.equal(storage.setItem.mock.calls.length, 1);
  assert.equal(values.get('paper-puppeteer:draft:a'), newer);
  edit(3);
  recovery.flush();
  assert.include(values.get('paper-puppeteer:draft:a')!, '"value":3');
});

test('compatible validated drafts restore only after accepting the prompt', () => {
  const { recovery, session, confirm, status } = fixture(
    JSON.stringify({ version: 1, source: 'original', data: { value: 8 } }),
  );
  recovery.bind(session);
  assert.equal(confirm.mock.calls.length, 1);
  assert.deepEqual(vi.mocked(session.restore).mock.calls, [[{ value: 8 }]]);
  assert.isTrue(session.dirty());
  assert.include(status.mock.calls.at(-1)![0], 'Draft restored');
});

test('declining restoration deletes the stored draft and leaves the loaded document intact', () => {
  const { recovery, session, confirm, values } = fixture(
    JSON.stringify({ version: 1, source: 'original', data: { value: 8 } }),
  );
  confirm.mockReturnValue(false);
  recovery.bind(session);
  assert.equal(vi.mocked(session.restore).mock.calls.length, 0);
  assert.isFalse(session.dirty());
  assert.equal(values.size, 0);
});

test('legacy fingerprints restore equivalent reordered sources but still reject authored changes', () => {
  const original = JSON.stringify({ tracks: { root: [{ time: 0, x: 1 }], child: [{ time: 0, y: 2 }] } });
  const stored = JSON.stringify({ version: 1, source: original, data: { value: 8 } });
  const { recovery, session, confirm, values } = fixture(stored);
  const current = draftSource({ tracks: { child: [{ y: 2, time: 0 }], root: [{ x: 1, time: 0 }] } });
  recovery.bind({ ...session, source: current });
  assert.equal(confirm.mock.calls.length, 1);
  assert.isTrue(session.dirty());
  recovery.flush();
  assert.include(values.get('paper-puppeteer:draft:a')!, '\\"child\\"');
  recovery.unbind();
  values.set('paper-puppeteer:draft:a', stored);
  confirm.mockClear();
  recovery.bind({ ...session, source: draftSource({ tracks: {} }), dirty: () => false });
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(values.size, 0);
});

test.each([
  'broken JSON',
  JSON.stringify({ version: 2, source: 'original', data: { value: 8 } }),
  JSON.stringify({ version: 1, source: 'old source', data: { value: 8 } }),
  JSON.stringify({ version: 1, source: 'original', data: { value: 'invalid' } }),
])('invalid or stale draft %s is rejected before prompting or modifying the document', (stored) => {
  const { recovery, session, confirm, values } = fixture(stored);
  recovery.bind(session);
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(vi.mocked(session.restore).mock.calls.length, 0);
  assert.equal(values.size, 0);
});

test('unavailable browser storage and quota failures leave authoring usable and report recovery status', () => {
  const { recovery, session, storage, status, edit } = fixture();
  recovery.bind(session);
  storage.setItem.mockImplementation(() => {
    throw new Error('Quota exceeded');
  });
  edit(9);
  assert.doesNotThrow(() => vi.advanceTimersByTime(300));
  assert.include(status.mock.calls.at(-1)![0], 'Could not save');
  assert.equal(session.snapshot().value, 9);
  Object.defineProperty(window, 'localStorage', {
    get() {
      throw new Error('Storage disabled');
    },
  });
  assert.doesNotThrow(() => recovery.bind(session));
  assert.include(status.mock.calls.at(-1)![0], 'Download JSON');
});
