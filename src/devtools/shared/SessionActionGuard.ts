/** Pending I/O belongs to one editor session; imports replace each other and exports commit in request order. */
export class SessionActionGuard {
  private generation = 0;
  private importSequence = 0;
  private exportSequence = 0;
  private committedExportSequence = 0;

  constructor(private readonly signal: AbortSignal) {}

  invalidate(): void {
    ++this.generation;
    this.cancelImports();
  }

  cancelImports(): void {
    ++this.importSequence;
  }

  private sessionCheck(sameSession: () => boolean): () => boolean {
    const generation = this.generation;
    return () => !this.signal.aborted && this.generation === generation && sameSession();
  }

  beginImport(sameSession: () => boolean): { isCurrent: () => boolean } {
    const sequence = ++this.importSequence;
    const inSession = this.sessionCheck(sameSession);
    return { isCurrent: () => inSession() && sequence === this.importSequence };
  }

  beginExport(sameSession: () => boolean) {
    const sequence = ++this.exportSequence;
    const isCurrent = this.sessionCheck(sameSession);
    return {
      isCurrent,
      isLatest: () => isCurrent() && sequence === this.exportSequence,
      commit: (): boolean => {
        if (!isCurrent() || sequence < this.committedExportSequence) return false;
        this.committedExportSequence = sequence;
        return true;
      },
    };
  }
}
