export interface WorkerTask<Response> {
  readonly result: Promise<Response>;
  cancel(): void;
}

interface WorkerTaskOptions {
  readonly signal?: AbortSignal;
  readonly errorMessage: string;
  readonly messageErrorMessage: string;
  readonly cancelReason?: unknown;
  readonly timeoutMs?: number;
  readonly timeoutMessage?: string;
}

/** Own one worker until its first reply, failure or cancellation; late callbacks cannot settle it again. */
export function startWorkerTask<Response>(
  worker: Worker,
  request: unknown,
  options: WorkerTaskOptions,
): WorkerTask<Response> {
  let cancel = (): void => {};
  const result = new Promise<Response>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      complete();
    };
    const abort = (): void => finish(() => reject(options.signal!.reason));
    cancel = () =>
      finish(() => reject(options.cancelReason ?? new DOMException('Worker task cancelled.', 'AbortError')));
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<Response>) => finish(() => resolve(event.data));
    worker.onerror = (event) => {
      event.preventDefault();
      finish(() => reject(new Error(event.message || options.errorMessage)));
    };
    worker.onmessageerror = () => finish(() => reject(new Error(options.messageErrorMessage)));
    try {
      options.signal?.throwIfAborted();
      if (options.timeoutMs !== undefined)
        timeout = setTimeout(
          () =>
            finish(() => reject(new DOMException(options.timeoutMessage ?? 'Worker task timed out.', 'TimeoutError'))),
          options.timeoutMs,
        );
      // Clone inputs so cancellation never detaches buffers retained by the caller.
      worker.postMessage(request);
    } catch (error) {
      finish(() => reject(error));
    }
  });
  return { result, cancel: () => cancel() };
}
