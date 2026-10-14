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
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  const confirm = vi.fn((_message: string) => true);
  const windowTarget = Object.assign(new EventTarget(), { localStorage: storage, confirm });
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('document', documentTarget);
  const status = vi.fn<(message: string) => void>();
  const retainedCounts = vi.fn<(count: number) => void>();
  const recovery = new DraftRecovery<Snapshot>(status, retainedCounts);
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
  return { recovery, session, values, storage, confirm, status, retainedCounts, edit, windowTarget, documentTarget };
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

test.each([false, true])(
  'explicit discard cancels pending writes and removes only its owned draft (flushed: %s)',
  (flushed) => {
    const { recovery, session, edit, values, confirm } = fixture();
    recovery.bind(session);
    edit(44);
    if (flushed) recovery.flush();
    const otherKey = 'paper-puppeteer:draft:a:session:other-tab';
    const other = JSON.stringify({ version: 1, source: 'original', data: { value: 99 } });
    values.set(otherKey, other);
    recovery.discard();
    recovery.bind({ ...session, snapshot: () => ({ value: 0 }), dirty: () => false }, { recover: false });
    vi.advanceTimersByTime(1000);
    assert.deepEqual([...values], [[otherKey, other]]);
    assert.equal(confirm.mock.calls.length, 0);
  },
);

test('discard removes a recovered draft before its pending replacement is written', () => {
  const { recovery, session, values } = fixture(
    JSON.stringify({ version: 1, source: 'original', data: { value: 44 } }),
  );
  recovery.bind(session);
  recovery.discard();
  recovery.unbind();
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
    assert.include([...values.values()].at(-1)!, '"value":4');
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
  assert.include([...values.values()].at(-1)!, '"value":1');
  vi.advanceTimersByTime(300);
  assert.ok(
    [...values].some(
      ([key, text]) => key.startsWith('paper-puppeteer:draft:b:session:') && text.includes('"value":99'),
    ),
  );
});

test('an invalid intermediate edit retains the last valid stored draft', () => {
  const { recovery, session, edit, values } = fixture();
  recovery.bind(session);
  edit(1);
  vi.advanceTimersByTime(300);
  const valid = [...values.values()].at(-1);
  edit(NaN);
  vi.advanceTimersByTime(300);
  assert.equal([...values.values()].at(-1), valid);
});

test("a clean second tab cannot delete another tab's draft on update, navigation or disposal", () => {
  const { recovery, session, edit, values } = fixture();
  recovery.bind(session);
  const clean = new DraftRecovery<Snapshot>(() => {});
  recoveries.push(clean);
  clean.bind({ ...session, snapshot: () => ({ value: 0 }), dirty: () => false });
  edit(42);
  recovery.flush();
  const stored = [...values.values()].at(-1);
  clean.update();
  clean.flush();
  clean.dispose();
  assert.equal([...values.values()].at(-1), stored);
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
  const newer = [...values.values()].at(-1);
  edit(42, false);
  assert.equal([...values.values()].at(-1), newer);
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
  assert.equal([...values.values()].at(-1), newer);
  edit(3);
  recovery.flush();
  assert.equal(values.get('paper-puppeteer:draft:a'), newer);
  assert.ok([...values.values()].some((text) => text.includes('"value":3')));
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

test('declining restoration preserves the stored draft and leaves the loaded document intact', () => {
  const { recovery, session, confirm, values } = fixture(
    JSON.stringify({ version: 1, source: 'original', data: { value: 8 } }),
  );
  confirm.mockReturnValue(false);
  recovery.bind(session);
  assert.equal(vi.mocked(session.restore).mock.calls.length, 0);
  assert.isFalse(session.dirty());
  assert.equal(values.size, 1);
});

test('declining recovery in a second tab preserves the first tab backup through unchanged updates and close', () => {
  const { recovery, session, edit, values, confirm } = fixture();
  recovery.bind(session);
  edit(42);
  recovery.flush();
  const stored = [...values.entries()];
  confirm.mockReturnValue(false);
  const second = new DraftRecovery<Snapshot>(() => {});
  recoveries.push(second);
  second.bind({ ...session, snapshot: () => ({ value: 0 }), dirty: () => false });
  assert.equal(confirm.mock.calls.length, 1);
  assert.deepEqual([...values.entries()], stored);
  recovery.update();
  recovery.flush();
  recovery.dispose();
  second.dispose();
  assert.deepEqual([...values.entries()], stored);
});

test('recovery offers the newest compatible draft first regardless of storage order', () => {
  const { recovery, session, values, confirm } = fixture();
  const olderKey = 'paper-puppeteer:draft:a:session:older';
  const newerKey = 'paper-puppeteer:draft:a:session:newer';
  const older = JSON.stringify({ version: 1, source: 'original', data: { value: 1 }, savedAt: '2026-10-10T10:00:00Z' });
  values.set(olderKey, older);
  values.set(
    newerKey,
    JSON.stringify({ version: 1, source: 'original', data: { value: 2 }, savedAt: '2026-10-11T10:00:00Z' }),
  );
  recovery.bind(session);
  assert.equal(session.snapshot().value, 2);
  assert.equal(confirm.mock.calls.length, 1);
  assert.include(confirm.mock.calls[0]![0], 'Saved 2026-10-11T10:00:00Z');
  recovery.flush();
  assert.equal(values.get(olderKey), older);
  assert.isFalse(values.has(newerKey));
});

test('declining the newest draft offers the next compatible draft and excludes invalid candidates', () => {
  const { recovery, session, values, confirm } = fixture();
  const add = (id: string, value: number, savedAt: string, source = 'original'): void => {
    values.set(
      `paper-puppeteer:draft:a:session:${id}`,
      JSON.stringify({ version: 1, source, data: { value }, savedAt }),
    );
  };
  add('old', 1, '2026-10-10T10:00:00Z');
  add('new', 2, '2026-10-11T10:00:00Z');
  add('stale', 3, '2026-10-12T10:00:00Z', 'different source');
  confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
  recovery.bind(session);
  assert.equal(session.snapshot().value, 1);
  assert.include(confirm.mock.calls[0]![0], 'Draft 1 of 2. Saved 2026-10-11');
  assert.include(confirm.mock.calls[1]![0], 'Draft 2 of 2. Saved 2026-10-10');
  assert.isTrue(values.has('paper-puppeteer:draft:a:session:new'));
  assert.isTrue(values.has('paper-puppeteer:draft:a:session:stale'));
});

test('dated drafts precede legacy drafts and missing, invalid or equal dates retain stable order', () => {
  const { recovery, session, values, confirm, storage } = fixture();
  const dates = [undefined, 'invalid date', '2026-10-11T10:00:00Z', '2026-10-11T10:00:00Z'];
  dates.forEach((savedAt, value) => {
    values.set(
      `paper-puppeteer:draft:a:session:${value}`,
      JSON.stringify({ version: 1, source: 'original', data: { value }, savedAt }),
    );
  });
  confirm.mockReturnValue(false);
  recovery.bind(session);
  assert.equal(confirm.mock.calls.length, 4);
  assert.include(confirm.mock.calls[0]![0], 'Saved 2026-10-11');
  assert.include(confirm.mock.calls[1]![0], 'Saved 2026-10-11');
  assert.notInclude(confirm.mock.calls[2]![0], 'Saved');
  assert.include(confirm.mock.calls[3]![0], 'Saved invalid date');
  assert.equal(storage.removeItem.mock.calls.length, 0);
  assert.equal(values.size, 4);
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
  const replacement = z.object({ source: z.string(), data: schema }).parse(JSON.parse([...values.values()].at(-1)!));
  assert.equal(replacement.source, current);
  assert.deepEqual(replacement.data, { value: 8 });
  recovery.unbind();
  values.clear();
  values.set('paper-puppeteer:draft:a', stored);
  confirm.mockClear();
  recovery.bind({ ...session, source: draftSource({ tracks: {} }), dirty: () => false });
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(values.get('paper-puppeteer:draft:a'), stored);
});

test('compact source identities migrate legacy drafts under a small storage quota', () => {
  const source = { animation: { payload: 'x'.repeat(100_000) } };
  const legacy = JSON.stringify({ version: 1, source: JSON.stringify(source), data: { value: 8 } });
  const { recovery, session, values, storage, status } = fixture(legacy);
  storage.setItem.mockImplementation((key, text) => {
    if (text.length > 1024) throw new Error('Quota exceeded');
    values.set(key, text);
  });
  const fingerprint = draftSource(source);
  recovery.bind({ ...session, source: fingerprint });
  assert.equal(session.snapshot().value, 8);
  recovery.flush();
  assert.equal(values.size, 1);
  assert.isFalse(values.has('paper-puppeteer:draft:a'));
  const stored = [...values.values()][0]!;
  assert.isBelow(stored.length, 1024);
  const draft = z.object({ source: z.string(), data: schema }).parse(JSON.parse(stored));
  assert.equal(draft.source, fingerprint);
  assert.deepEqual(draft.data, { value: 8 });
  assert.notInclude(status.mock.calls.at(-1)![0], 'Could not save');
});

test.each(['broken JSON', JSON.stringify({ version: 2, source: 'original', data: { value: 8 } })])(
  'invalid draft %s is rejected before prompting or modifying the document',
  (stored) => {
    const { recovery, session, confirm, values } = fixture(stored);
    recovery.bind(session);
    assert.equal(confirm.mock.calls.length, 0);
    assert.equal(vi.mocked(session.restore).mock.calls.length, 0);
    assert.equal(values.size, 0);
  },
);

test.each([
  { source: 'old source', data: { value: 8 } },
  { source: 'original', data: { value: 'invalid' } },
])('incompatible drafts survive clean sessions, edits, saves and disposal: %j', (draft) => {
  const stored = JSON.stringify({ version: 1, ...draft, revision: 'original-revision' });
  const { recovery, session, confirm, values, edit, status } = fixture(stored);
  recovery.bind(session);
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(vi.mocked(session.restore).mock.calls.length, 0);
  assert.include(status.mock.calls.at(-1)![0], 'retained');
  const archive = recovery.retainedDraftsJson()!;
  assert.include(archive, stored);
  assert.deepEqual(JSON.parse(archive), { version: 1, drafts: [JSON.parse(stored) as unknown] });
  edit(10);
  recovery.flush();
  assert.equal(values.size, 2);
  edit(10, false);
  assert.equal(values.size, 1);
  assert.equal(values.get('paper-puppeteer:draft:a'), stored);
  recovery.dispose();
  assert.equal(values.get('paper-puppeteer:draft:a'), stored);
});

test('failed restoration retains the draft for manual download', () => {
  const stored = JSON.stringify({ version: 1, source: 'original', data: { value: 8 } });
  const { recovery, session, values } = fixture(stored);
  session.restore = () => false;
  recovery.bind(session);
  assert.equal(values.get('paper-puppeteer:draft:a'), stored);
  assert.include(recovery.retainedDraftsJson()!, stored);
});

test('replacing a source within one controller cannot overwrite its retained draft', () => {
  const { recovery, session, edit, values } = fixture();
  recovery.bind(session);
  edit(8);
  recovery.flush();
  const [key, stored] = [...values][0]!;
  recovery.bind({ ...session, source: 'updated source' });
  edit(10);
  recovery.flush();
  assert.equal(values.get(key), stored);
  assert.equal(values.size, 2);
  assert.include(recovery.retainedDraftsJson()!, stored);
  edit(10, false);
  assert.equal(values.size, 1);
  assert.equal(values.get(key), stored);
  recovery.bind(session);
  assert.deepEqual(session.snapshot(), { value: 8 });
  assert.isTrue(session.dirty());
  assert.isUndefined(recovery.retainedDraftsJson());
});

test('retained downloads belong to the bound document and compatible recovery preserves other drafts', () => {
  const stored = JSON.stringify({ version: 1, source: 'old source', data: { value: 8 } });
  const { recovery, session, values, status, retainedCounts } = fixture(stored);
  const compatibleKey = 'paper-puppeteer:draft:a:session:compatible';
  values.set(compatibleKey, JSON.stringify({ version: 1, source: 'original', data: { value: 9 } }));
  recovery.bind(session);
  assert.equal(retainedCounts.mock.calls.at(-1)![0], 1);
  assert.include(status.mock.calls.at(-1)![0], 'Draft restored');
  assert.include(status.mock.calls.at(-1)![0], 'retained');
  recovery.flush();
  assert.equal(values.get('paper-puppeteer:draft:a'), stored);
  assert.isFalse(values.has(compatibleKey));
  recovery.bind({ ...session, key: 'b', dirty: () => false });
  assert.equal(retainedCounts.mock.calls.at(-1)![0], 0);
  assert.isUndefined(recovery.retainedDraftsJson());
  recovery.bind({ ...session, dirty: () => false });
  assert.include(recovery.retainedDraftsJson()!, stored);
  recovery.unbind();
  assert.equal(retainedCounts.mock.calls.at(-1)![0], 0);
  assert.isUndefined(recovery.retainedDraftsJson());
  assert.equal(values.get('paper-puppeteer:draft:a'), stored);
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

test('draft revisions work on HTTP hosts where crypto.randomUUID is unavailable', () => {
  const { recovery, session, edit, values } = fixture();
  vi.stubGlobal('crypto', { getRandomValues: (array: Uint32Array) => array.fill(7) });
  recovery.bind(session);
  edit(42);
  recovery.flush();
  assert.include([...values.values()].at(-1)!, '"value":42');
  assert.include([...values.values()].at(-1)!, '"revision":"7-7-7-7"');
});

test('explicit import baselines skip recovery without prompting or restoring an older matching draft', () => {
  const stored = JSON.stringify({ version: 1, source: 'original', data: { value: 99 } });
  const { recovery, session, confirm, values, edit } = fixture(stored);
  recovery.bind(session, { recover: false });
  assert.equal(confirm.mock.calls.length, 0);
  assert.equal(vi.mocked(session.restore).mock.calls.length, 0);
  assert.isFalse(session.dirty());
  assert.deepEqual(session.snapshot(), { value: 0 });
  // The older entry can belong to another tab; subsequent authored edits save the new session normally.
  assert.equal([...values.values()].at(-1), stored);
  edit(5);
  vi.advanceTimersByTime(300);
  assert.include([...values.values()].at(-1)!, '"value":5');
  assert.equal(values.get('paper-puppeteer:draft:a'), stored);
});

test('concurrent dirty sessions retain independent drafts through edits, save and recovery', () => {
  const { recovery, session, edit, values } = fixture();
  recovery.bind(session);
  let otherSnapshot: Readonly<Snapshot> = Object.freeze({ value: 0 });
  let otherDirty = false;
  const other = new DraftRecovery<Snapshot>(() => {});
  recoveries.push(other);
  other.bind({ ...session, snapshot: () => otherSnapshot, dirty: () => otherDirty });
  edit(10);
  recovery.flush();
  otherSnapshot = Object.freeze({ value: 20 });
  otherDirty = true;
  other.update();
  other.flush();
  edit(11);
  recovery.flush();
  assert.equal(values.size, 2);
  assert.deepEqual(
    [...values.values()]
      .map((text) => z.object({ data: schema }).parse(JSON.parse(text)).data.value)
      .sort((left, right) => left - right),
    [11, 20],
  );
  edit(0, false);
  assert.equal(values.size, 1);
  assert.include([...values.values()][0]!, '"value":20');
  const restored = new DraftRecovery<Snapshot>(() => {});
  recoveries.push(restored);
  restored.bind(session);
  assert.equal(session.snapshot().value, 20);
  restored.flush();
  assert.equal(values.size, 1);
});
