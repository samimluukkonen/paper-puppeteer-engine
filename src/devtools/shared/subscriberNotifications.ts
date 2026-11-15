import { dispatchListeners, throwNotificationErrors } from '../../engine/core.js';

/** Report UI subscriber failures without turning successful document/resource operations into failed edits. */
export function notifySubscribers(listeners: ReadonlySet<() => void>, message: string): void {
  const errors = dispatchListeners(listeners, (listener) => listener());
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
