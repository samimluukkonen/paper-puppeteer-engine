import { dispatchListeners, throwNotificationErrors } from '../../engine/core.js';

/**
 * How an owner handles listener failures.
 * - `report`: deliver to every listener, then hand failures to the host's `reportError`, so a broken UI subscriber
 *   never turns a successful document/resource operation into a failed edit.
 * - `collect`: deliver to every listener and return the failures to the caller, which owns what happens next.
 */
export type SubscriberErrorPolicy = 'report' | 'collect';

/** The one devtools owner of UI subscriptions: delivery order, error isolation and the revision snapshot. */
export class Subscribers {
  private readonly listeners = new Set<() => void>();
  private readonly label: string;
  private readonly onError: SubscriberErrorPolicy;
  private revision = 0;

  constructor(options: { label: string; onError?: SubscriberErrorPolicy }) {
    this.label = options.label;
    this.onError = options.onError ?? 'report';
  }

  /** Stable arrow so React's `useSyncExternalStore` keeps one subscription. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The revision, bumped once per `notify()`. */
  readonly getSnapshot = (): number => this.revision;

  /**
   * Bump the revision and deliver to a snapshot of the current listeners. Listeners added or removed during delivery
   * affect only later notifications. Returns the failures in `collect` mode and `[]` in `report` mode.
   */
  notify(): unknown[] {
    this.revision++;
    const errors = dispatchListeners(this.listeners, (listener) => listener());
    if (this.onError === 'collect') return errors;
    reportNotificationErrors(errors, this.label);
    return [];
  }

  clear(): void {
    this.listeners.clear();
  }

  /** Current subscription count, for leak checks. */
  get size(): number {
    return this.listeners.size;
  }
}

/** Report failures without turning successful document/resource operations into failed edits. */
function reportNotificationErrors(errors: readonly unknown[], message: string): void {
  try {
    throwNotificationErrors(errors, message);
  } catch (error) {
    if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
    else
      queueMicrotask(() => {
        throw error;
      });
  }
}
