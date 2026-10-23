/** Stop waiting promptly even when a host-provided asynchronous operation ignores cancellation.
 * Keep rejection handlers on the original operation so late failures remain handled.
 */
export function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) {
      signal.removeEventListener('abort', abort);
      abort();
    }
  });
}
