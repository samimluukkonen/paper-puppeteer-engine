import { inspectImageHeader } from './imageHeader.js';

/** Browser image lease shared by imports, package validation and scene rendering. */
export async function decodeImage(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) {
  signal.throwIfAborted();
  const header = inspectImageHeader(bytes);
  if (!header) throw new Error('Choose a PNG or static WebP image.');
  const image = new Image();
  const blob = new Blob([bytes], { type: header.format });
  const url = URL.createObjectURL(blob);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    image.src = '';
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: unknown): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = (): void => finish(signal.reason ?? new Error('Image decoding cancelled.'));
      const timeout = setTimeout(() => finish(new Error('Image decoding timed out. Export the image again.')), 15000);
      signal.addEventListener('abort', abort, { once: true });
      image.src = url;
      void Promise.resolve()
        .then(() => image.decode())
        .then(
          () => finish(),
          () =>
            finish(new Error('The image is corrupt or cannot be decoded by this browser. Export a new PNG or WebP.')),
        );
    });
    signal.throwIfAborted();
    if (image.naturalWidth !== header.width || image.naturalHeight !== header.height)
      throw new Error('Decoded dimensions do not match the image header. Export the image again.');
    return { ...header, image, blob, url, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
