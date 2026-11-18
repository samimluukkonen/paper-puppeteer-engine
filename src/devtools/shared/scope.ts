/**
 * Owns releases opened together and closes them together, latest first.
 * `DisposableStack` is unavailable at the ES2022 target.
 */
export class Scope {
  private releases: (() => void)[] | undefined = [];

  /** Registers a release; after close it runs at once so a late bind cannot leak. */
  add(release: () => void): void {
    if (this.releases) this.releases.push(release);
    else release();
  }

  /** Runs every release in reverse order once; failures are rethrown together. */
  close(): void {
    const releases = this.releases;
    if (!releases) return;
    this.releases = undefined;
    const errors: unknown[] = [];
    for (let index = releases.length - 1; index >= 0; index--) {
      try {
        releases[index]!();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Scope releases failed.');
  }
}
