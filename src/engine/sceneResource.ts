/** @internal Bounded, cancellable HTTP(S) reads for scene JSON, ZIPs and package artwork. */
export async function readSceneResource(
  url: string,
  fetcher: typeof fetch,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Scene resources must use HTTP(S).');
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException(`Scene request timed out: ${url}`, 'TimeoutError')),
    30_000,
  );
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
  const cancel = (): void => {
    void reader?.cancel(controller.signal.reason).catch(() => {});
  };
  controller.signal.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    const response = await fetcher(url, { signal: controller.signal, redirect: 'error' });
    reader = response.body?.getReader();
    if (!response.ok || response.redirected)
      throw new Error(`Could not load scene resource "${url}" (${response.status}).`);
    if (Number(response.headers.get('content-length')) > maxBytes)
      throw new Error(`Scene resource exceeds ${maxBytes} bytes: ${url}`);
    if (!reader) throw new Error(`Empty scene resource "${url}".`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      controller.signal.throwIfAborted();
      const chunk = await reader.read();
      controller.signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maxBytes) throw new Error(`Scene resource exceeds ${maxBytes} bytes: ${url}`);
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancel);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
