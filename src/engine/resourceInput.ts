import { abortable } from './abortable.js';

interface ResponseLimits {
  readonly maxBytes: number;
  readonly signal: AbortSignal;
  readonly limitError: () => Error;
  readonly emptyError?: () => Error;
  readonly validateResponse?: (response: Response) => void;
  readonly countBytes?: (bytes: number) => void;
}

/** Shared streaming boundary. Cancellation never waits for a host's stalled cancel callback. */
export async function readResponseBody(
  response: Response,
  options: ResponseLimits,
  chunk: (bytes: Uint8Array<ArrayBuffer>) => void,
): Promise<void> {
  const { signal } = options;
  const reader = response.body?.getReader();
  const cancel = (reason: unknown): void => {
    void reader?.cancel(reason).catch(() => {});
  };
  const abort = (): void => cancel(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    options.validateResponse?.(response);
    if (Number(response.headers.get('content-length')) > options.maxBytes) throw options.limitError();
    if (!reader && options.emptyError) throw options.emptyError();
    let size = 0;
    while (reader) {
      const next = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > options.maxBytes) throw options.limitError();
      options.countBytes?.(next.value.byteLength);
      chunk(next.value);
    }
  } catch (error) {
    cancel(error);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader?.releaseLock();
  }
}

/** Binary consumers share the same bounds and stream ownership as decoded JSON. */
export async function readResponseBytes(response: Response, options: ResponseLimits): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  await readResponseBody(response, options, (bytes) => {
    chunks.push(bytes);
    size += bytes.byteLength;
  });
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

interface ResourceRequestOptions {
  readonly signal?: AbortSignal;
  /** Character metadata requests intentionally share one controller across sibling workers. */
  readonly controller?: AbortController;
  readonly timeoutMs: number;
  readonly timeoutMessage: string;
  readonly init?: Omit<RequestInit, 'signal'>;
}

/** Own a request deadline through body consumption; late custom-fetch responses are canceled too. */
export async function withResourceResponse<Result>(
  url: string,
  fetcher: typeof fetch,
  options: ResourceRequestOptions,
  read: (response: Response, signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  const controller = options.controller ?? new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException(options.timeoutMessage, 'TimeoutError')),
    options.timeoutMs,
  );
  let response: Response | undefined;
  try {
    options.signal?.throwIfAborted();
    controller.signal.throwIfAborted();
    const pending = fetcher(url, { ...options.init, signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) {
        void value.body?.cancel(controller.signal.reason).catch(() => {});
        controller.signal.throwIfAborted();
      }
      return value;
    });
    response = await abortable(pending, controller.signal);
    return await abortable(read(response, controller.signal), controller.signal);
  } catch (error) {
    if (response && !response.bodyUsed && !response.body?.locked) void response.body?.cancel(error).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
