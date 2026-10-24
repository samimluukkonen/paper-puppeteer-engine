import { DEFAULT_CHARACTER_TEXTURE_LIMITS as limits } from '../../../engine/characterTextureLimits.js';
import { decodeImage } from '../../../engine/decodeImage.js';
import { IMAGE_HEADER_BYTES, inspectImageHeader } from '../../../engine/imageHeader.js';

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
  const header = inspectImageHeader(bytes);
  if (!header) throw new Error('This file is not a valid PNG or WebP image. Export the sprite as PNG or static WebP.');
  checkDimensions(header.width, header.height);
  return header;
}

/** One decoded image serves the HTML comparison and Phaser; disposal also releases its object URL. */
export async function importSprite(file: File, signal: AbortSignal): Promise<ImportedSprite> {
  signal.throwIfAborted();
  if (!file.size) throw new Error('The selected file is empty. Choose an exported PNG or WebP sprite.');
  if (file.size > limits.maxImageBytes) throw new Error('The sprite exceeds 10 MiB. Export a smaller PNG or WebP.');
  if (!/\.(png|webp)$/i.test(file.name) || (file.type && !['image/png', 'image/webp'].includes(file.type)))
    throw new Error('Choose a PNG (.png) or static WebP (.webp) image.');
  const header = inspectSpriteHeader(new Uint8Array(await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer()));
  signal.throwIfAborted();
  if (
    (file.type && file.type !== header.format) ||
    !file.name.toLowerCase().endsWith(header.format === 'image/png' ? '.png' : '.webp')
  )
    throw new Error('The filename or image type does not match its contents. Export the sprite again.');
  const decoded = await decodeImage(new Uint8Array(await file.arrayBuffer()), signal);
  return { ...decoded, filename: file.name, bytes: file.size };
}
