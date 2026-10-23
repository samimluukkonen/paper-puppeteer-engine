import { readResponseBytes, withResourceResponse } from './resourceInput.js';

/** @internal Bounded, cancellable HTTP(S) reads for scene JSON, ZIPs and package artwork. */
export async function readSceneResource(
  url: string,
  fetcher: typeof fetch,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Scene resources must use HTTP(S).');
  return withResourceResponse(
    url,
    fetcher,
    {
      ...(signal ? { signal } : {}),
      timeoutMs: 30_000,
      timeoutMessage: `Scene request timed out: ${url}`,
      init: { redirect: 'error' },
    },
    (response, requestSignal) =>
      readResponseBytes(response, {
        maxBytes,
        signal: requestSignal,
        limitError: () => new Error(`Scene resource exceeds ${maxBytes} bytes: ${url}`),
        emptyError: () => new Error(`Empty scene resource "${url}".`),
        validateResponse: (value) => {
          if (!value.ok || value.redirected)
            throw new Error(`Could not load scene resource "${url}" (${value.status}).`);
        },
      }),
  );
}
