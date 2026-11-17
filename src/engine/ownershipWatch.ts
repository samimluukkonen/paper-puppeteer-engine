/**
 * Internal ownership invalidation sink, owned by one SceneRunner and attached to its Actors'
 * playback and movement controllers.
 *
 * Invariants for reporters:
 * - Invalidate conservatively on every command that can change playback or movement ownership
 *   (start, replace, stop, pause, cancel, abort, dispose). A host callback can change any Actor,
 *   so the owner must not assume only the Actor that just updated changed.
 * - Clock advances and natural completions retain ownership and must not invalidate; the owner
 *   relies on this to keep checking work linear.
 *
 * Owners compare `revision` with the last value they checked; it only changes through invalidate().
 */
export interface OwnershipWatch {
  invalidate(): void;
  readonly revision: number;
}

export function createOwnershipWatch(): OwnershipWatch {
  let revision = 0;
  return {
    invalidate() {
      revision++;
    },
    get revision() {
      return revision;
    },
  };
}

/** One attachment slot. attach() returns a release that only detaches if it is still current. */
export class OwnershipWatchSlot {
  private current: OwnershipWatch | undefined;

  attach(watch: OwnershipWatch): () => void {
    this.current = watch;
    return () => {
      if (this.current === watch) this.current = undefined;
    };
  }

  invalidate(): void {
    this.current?.invalidate();
  }
}
