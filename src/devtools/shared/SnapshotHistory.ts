/** Bounded history of owned snapshots; capture must return an independent or immutable value. */
export class SnapshotHistory<Entry> {
  private readonly past: Entry[] = [];
  private readonly future: Entry[] = [];
  private operation: { before: Entry } | undefined;

  constructor(
    private readonly capture: () => Entry,
    private readonly restore: (entry: Entry) => void,
    private readonly equals: (left: Entry, right: Entry) => boolean,
    readonly limit = 100,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('History limit must be a nonnegative safe integer.');
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get length(): number {
    return this.past.length;
  }
  get inOperation(): boolean {
    return this.operation !== undefined;
  }

  beginOperation(): void {
    this.operation ??= { before: this.capture() };
  }

  /** Returns whether an operation ended, including one with no authored changes. */
  endOperation(): boolean {
    if (!this.operation) return false;
    const { before } = this.operation;
    this.operation = undefined;
    this.record(before);
    return true;
  }

  /** Failed edits roll back the whole operation, preserving existing undo/redo entries. */
  change(edit: () => void): void {
    const before = this.operation ? this.operation.before : this.capture();
    try {
      edit();
      if (!this.operation) this.record(before);
    } catch (error) {
      this.operation = undefined;
      this.rollback(before, error);
    }
  }

  private rollback(before: Entry, error: unknown): never {
    try {
      this.restore(before);
    } catch (rollbackError) {
      // oxlint-disable-next-line eslint/preserve-caught-error -- Both failures are already retained in AggregateError.errors.
      throw new AggregateError([error, rollbackError], 'History operation and rollback failed.');
    }
    throw error;
  }

  private restoreEntry(entry: Entry, before: Entry): void {
    try {
      this.restore(entry);
    } catch (error) {
      this.rollback(before, error);
    }
  }

  private record(before: Entry): void {
    if (this.equals(before, this.capture())) return;
    this.pushPast(before);
    this.future.length = 0;
  }

  private pushPast(entry: Entry): void {
    if (this.limit === 0) return;
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
  }

  undo(): boolean {
    this.endOperation();
    if (!this.past.length) return false;
    const previous = this.past[this.past.length - 1]!;
    const current = this.capture();
    this.restoreEntry(previous, current);
    this.past.pop();
    this.future.push(current);
    return true;
  }

  redo(): boolean {
    this.endOperation();
    if (!this.future.length) return false;
    const next = this.future[this.future.length - 1]!;
    const current = this.capture();
    this.restoreEntry(next, current);
    this.future.pop();
    this.pushPast(current);
    return true;
  }
}
