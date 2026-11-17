import { assert, expect, test } from 'vitest';
import { recoverDraft } from '../src/devtools/shared/autosave/recoverDraft.js';

const draft = { id: 'draft-7', key: 'project:demo', name: 'Demo', savedAt: 1 };
const bytes = new Map([['project.json', new Uint8Array([1, 2, 3])]]);

function recordingStore() {
  const calls: string[] = [];
  return {
    calls,
    claim: (key: string, owner: string) => (calls.push(`claim ${key} ${owner}`), Promise.resolve()),
    read: (id: string) => (calls.push(`read ${id}`), Promise.resolve(bytes)),
    release: (key: string, owner: string) => (calls.push(`release ${key} ${owner}`), Promise.resolve()),
  };
}

test('recovery hands the claimed draft bytes and key to the restoring owner, then releases the lease', async () => {
  const store = recordingStore();
  await recoverDraft(store, 'tab-1', draft, (files, key) => {
    store.calls.push(`restore ${key} ${files.get('project.json')!.join(',')}`);
  });
  assert.deepEqual(store.calls, [
    'claim project:demo tab-1',
    'read draft-7',
    'restore project:demo 1,2,3',
    'release project:demo tab-1',
  ]);
});

test('a restore that fails still releases the lease and reports the failure', async () => {
  const store = recordingStore();
  await expect(
    recoverDraft(store, 'tab-1', draft, () => Promise.reject(new Error('Unsupported project package.'))),
  ).rejects.toThrow('Unsupported project package.');
  assert.deepEqual(store.calls, ['claim project:demo tab-1', 'read draft-7', 'release project:demo tab-1']);
});
