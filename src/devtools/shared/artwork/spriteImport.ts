import { DEFAULT_CHARACTER_TEXTURE_LIMITS as limits } from '../../../engine/characterTextureLimits.js';

export interface SpriteMetadata {
  readonly filename: string;
  readonly format: 'image/png' | 'image/webp';
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

export interface ImportedSprite extends SpriteMetadata {
  readonly blob: Blob;
  readonly url: string;
  readonly image: HTMLImageElement;
  dispose(this: void): void;
}

function checkDimensions(width: number, height: number): void {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error('The image needs positive integer dimensions. Export a new PNG or WebP.');
  if (width > limits.maxImageDimension || height > limits.maxImageDimension || width * height > limits.maxImagePixels)
    throw new Error(`Resize the sprite to at most ${limits.maxImageDimension} pixels per side and 16 megapixels.`);
}

/** Inspect dimensions before allowing the browser to allocate decoded pixels. */
export function inspectSpriteHeader(bytes: Uint8Array): Pick<SpriteMetadata, 'format' | 'width' | 'height'> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number): string => String.fromCharCode(...bytes.slice(start, start + length));
  let format: SpriteMetadata['format'];
  let width: number;
  let height: number;
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every((value, index) => bytes[index] === value)
  ) {
    format = 'image/png';
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    format = 'image/webp';
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      if (view.getUint32(16, true) !== 10) throw new Error('Invalid WebP header. Export the sprite again.');
      width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      width = 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8);
      height = 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10);
    } else if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else throw new Error('Invalid or unsupported WebP header. Export a static PNG or WebP sprite.');
    if (chunk === 'VP8X' && bytes[20]! & 0x02)
      throw new Error('Animated WebP is not supported. Export a static sprite.');
  } else throw new Error('This file is not a valid PNG or WebP image. Export the sprite as PNG or static WebP.');
  checkDimensions(width, height);
  return { format, width, height };
}

/** One decoded image serves the HTML comparison and Phaser; disposal also releases its object URL. */
export async function importSprite(file: File, signal: AbortSignal): Promise<ImportedSprite> {
  signal.throwIfAborted();
  if (!file.size) throw new Error('The selected file is empty. Choose an exported PNG or WebP sprite.');
  if (file.size > limits.maxImageBytes) throw new Error('The sprite exceeds 10 MiB. Export a smaller PNG or WebP.');
  if (!/\.(png|webp)$/i.test(file.name) || (file.type && !['image/png', 'image/webp'].includes(file.type)))
    throw new Error('Choose a PNG (.png) or static WebP (.webp) image.');
  const header = inspectSpriteHeader(new Uint8Array(await file.slice(0, 30).arrayBuffer()));
  signal.throwIfAborted();
  if (
    (file.type && file.type !== header.format) ||
    !file.name.toLowerCase().endsWith(header.format === 'image/png' ? '.png' : '.webp')
  )
    throw new Error('The filename or image type does not match its contents. Export the sprite again.');
  const blob = file.slice(0, file.size, header.format);
  const url = URL.createObjectURL(blob);
  const image = new Image();
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
      const abort = (): void => finish(signal.reason ?? new Error('Sprite import cancelled.'));
      const timeout = setTimeout(() => finish(new Error('Image decoding timed out. Export the sprite again.')), 15000);
      signal.addEventListener('abort', abort, { once: true });
      image.src = url;
      void Promise.resolve()
        .then(() => image.decode())
        .then(
          () => finish(),
          () => finish(new Error('The image is corrupt or cannot be decoded by this browser. Export it as a new PNG.')),
        );
    });
    signal.throwIfAborted();
    checkDimensions(image.naturalWidth, image.naturalHeight);
    if (image.naturalWidth !== header.width || image.naturalHeight !== header.height)
      throw new Error('Decoded dimensions do not match the image header. Export the sprite again.');
    return { ...header, filename: file.name, bytes: file.size, blob, url, image, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
