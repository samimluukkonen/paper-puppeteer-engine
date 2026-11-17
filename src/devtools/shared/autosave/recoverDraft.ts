import type { PackageFiles } from '../package/characterPackage.js';
import type { DraftInfo, LocalDraftStore } from './LocalDraftStore.js';

/** Restoring owners receive portable package bytes; recovery itself never knows the project format. */
export type RestoreDraft = (files: PackageFiles, key: string) => void | Promise<void>;

/** No lease is held while the user inspects drafts. Claim only for the explicit restore, and always release it. */
export async function recoverDraft(
  store: Pick<LocalDraftStore, 'claim' | 'read' | 'release'>,
  owner: string,
  candidate: DraftInfo,
  restore: RestoreDraft,
): Promise<void> {
  await store.claim(candidate.key, owner);
  try {
    await restore(await store.read(candidate.id), candidate.key);
  } finally {
    await store.release(candidate.key, owner);
  }
}
