import { Scope } from '../shared/scope.js';

/**
 * Opens one scope per loaded character. Ready, failure and teardown all release through it,
 * so a binding registered by `open` cannot outlive its character on any path.
 */
export function characterScope<Args extends unknown[]>(
  open: (scope: Scope, ...args: Args) => void,
  failed: (message: string) => void,
): { ready: (...args: Args) => void; failed: (message: string) => void; close: () => void } {
  let current: Scope | undefined;
  const close = (): void => {
    const scope = current;
    current = undefined;
    scope?.close();
  };
  return {
    ready: (...args) => {
      close();
      current = new Scope();
      open(current, ...args);
    },
    failed: (message) => {
      try {
        close();
      } finally {
        failed(message);
      }
    },
    close,
  };
}
