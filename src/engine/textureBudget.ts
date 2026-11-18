import { DEFAULT_CHARACTER_TEXTURE_LIMITS } from './characterTextureDefaults.js';
import { IMAGE_HEADER_BYTES, inspectImageHeader } from './imageHeader.js';
import { validateInputLimit } from './jsonInput.js';
import { DEFAULT_SCENE_WORKLOAD_LIMITS } from './sceneWorkloadLimits.js';

type TextureLimits = { [Key in keyof typeof DEFAULT_CHARACTER_TEXTURE_LIMITS]: number };
export interface CharacterTextureLimitOptions extends Partial<TextureLimits> {
  /** Require an allowed image header before decoding (PNG, plus WebP when allowWebp is true).
   * Defaults to true; disable only for trusted artwork.
   */
  requirePng?: boolean;
  /** Allow static WebP alongside PNG, with header dimension checks before decoding. Defaults to false. */
  allowWebp?: boolean;
}

export class CharacterTextureLimitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CharacterTextureLimitError';
  }
}

/**
 * @internal Cumulative transfer and decoded-pixel budget for texture binaries, independent of any renderer.
 * Phaser-free so editors can check artwork through `/core`; `CharacterTextureBudget` adds the loader guard.
 */
export class TextureBudget {
  protected readonly limits: TextureLimits;
  protected readonly requirePng: boolean;
  protected readonly allowWebp: boolean;
  private readonly bytes = new Map<string, number>();
  private readonly pixels = new Map<string, number>();
  private totalBytes = 0;
  private totalPixels = 0;

  constructor(options: CharacterTextureLimitOptions) {
    if (options.requirePng !== undefined && typeof options.requirePng !== 'boolean')
      throw new Error('requirePng must be a boolean.');
    this.requirePng = options.requirePng ?? true;
    if (options.allowWebp !== undefined && typeof options.allowWebp !== 'boolean')
      throw new Error('allowWebp must be a boolean.');
    this.allowWebp = options.allowWebp ?? false;
    this.limits = Object.fromEntries(
      Object.entries(DEFAULT_CHARACTER_TEXTURE_LIMITS).map(([name, fallback]) => [
        name,
        validateInputLimit(options[name as keyof TextureLimits] ?? fallback, name),
      ]),
    ) as TextureLimits;
  }

  protected countBytes(key: string, bytes: number): void {
    if (bytes > this.limits.maxImageBytes)
      throw new CharacterTextureLimitError(`Image "${key}" exceeds the ${this.limits.maxImageBytes}-byte limit.`);
    const before = this.bytes.get(key) ?? 0;
    if (bytes <= before) return;
    const total = this.totalBytes + bytes - before;
    if (total > this.limits.maxTotalImageBytes)
      throw new CharacterTextureLimitError(
        `Character artwork exceeds the ${this.limits.maxTotalImageBytes}-byte total limit.`,
      );
    this.bytes.set(key, bytes);
    this.totalBytes = total;
  }

  protected countPixels(key: string, width: number, height: number): void {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
      throw new CharacterTextureLimitError(`Image "${key}" must have finite positive integer dimensions.`);
    if (width > this.limits.maxImageDimension || height > this.limits.maxImageDimension)
      throw new CharacterTextureLimitError(
        `Image "${key}" exceeds the ${this.limits.maxImageDimension}-pixel dimension limit.`,
      );
    const pixels = width * height;
    if (pixels > this.limits.maxImagePixels)
      throw new CharacterTextureLimitError(`Image "${key}" exceeds the ${this.limits.maxImagePixels}-pixel limit.`);
    const before = this.pixels.get(key) ?? 0;
    if (pixels <= before) return;
    const total = this.totalPixels + pixels - before;
    if (total > this.limits.maxTotalImagePixels)
      throw new CharacterTextureLimitError(
        `Character artwork exceeds the ${this.limits.maxTotalImagePixels}-pixel total limit.`,
      );
    this.pixels.set(key, pixels);
    this.totalPixels = total;
  }

  /** Validate complete package binaries against the same per-texture runtime allocation budget. */
  checkImage(key: string, bytes: Uint8Array): void {
    const previousBytes = this.bytes.get(key);
    const previousPixels = this.pixels.get(key);
    try {
      this.countBytes(key, bytes.byteLength);
      this.checkImageHeader(key, bytes);
    } catch (error) {
      // A rejected header/pixel allocation must not retain a partial byte reservation.
      this.release(key);
      if (previousBytes !== undefined) {
        this.bytes.set(key, previousBytes);
        this.totalBytes += previousBytes;
      }
      if (previousPixels !== undefined) {
        this.pixels.set(key, previousPixels);
        this.totalPixels += previousPixels;
      }
      throw error;
    }
  }

  /** Release an exclusively owned allocation after its texture/consumers are destroyed. */
  release(key: string): void {
    this.totalBytes -= this.bytes.get(key) ?? 0;
    this.totalPixels -= this.pixels.get(key) ?? 0;
    this.bytes.delete(key);
    this.pixels.delete(key);
  }

  /** Inline image URLs use Phaser's image-element path; bound their encoded payload before queueing. */
  checkInlineImage(key: string, url: string): void {
    if (!url.startsWith('data:')) return;
    const comma = url.indexOf(',');
    if (comma < 0) throw new CharacterTextureLimitError(`Image "${key}" has an invalid data URL.`);
    const encoded = url.slice(comma + 1);
    try {
      if (/;base64$/i.test(url.slice(0, comma))) {
        const base64 = decodeURIComponent(encoded).replace(/\s/g, '');
        this.countBytes(key, Math.floor(base64.replace(/=+$/, '').length * 0.75));
        const prefix = atob(base64.slice(0, Math.ceil(IMAGE_HEADER_BYTES / 3) * 4));
        this.checkImageHeader(
          key,
          Uint8Array.from(prefix, (character) => character.charCodeAt(0)),
        );
      } else {
        this.countBytes(key, new TextEncoder().encode(encoded.replace(/%[\da-f]{2}/gi, 'x')).byteLength);
        const header: number[] = [];
        for (let index = 0; index < encoded.length && header.length < IMAGE_HEADER_BYTES; index++) {
          const hex = encoded.slice(index + 1, index + 3);
          if (encoded[index] === '%' && /^[\da-f]{2}$/i.test(hex)) {
            header.push(parseInt(hex, 16));
            index += 2;
          } else header.push(...new TextEncoder().encode(encoded[index]));
        }
        this.checkImageHeader(key, new Uint8Array(header));
      }
    } catch (error) {
      if (error instanceof CharacterTextureLimitError) throw error;
      throw new CharacterTextureLimitError(`Image "${key}" has an invalid data URL.`, { cause: error });
    }
  }

  protected checkImageHeader(key: string, bytes: Uint8Array): void {
    let header: ReturnType<typeof inspectImageHeader>;
    try {
      header = inspectImageHeader(bytes, this.allowWebp);
    } catch (error) {
      throw new CharacterTextureLimitError(`Image "${key}" has an invalid header: ${String(error)}`, { cause: error });
    }
    if (!header || (header.format === 'image/webp' && !this.allowWebp)) {
      if (this.requirePng)
        throw new CharacterTextureLimitError(
          `Image "${key}" must have a ${this.allowWebp ? 'PNG or static WebP' : 'PNG'} header before decoding. Set requirePng to false only for trusted artwork.`,
        );
      return;
    }
    this.countPixels(key, header.width, header.height);
  }
}

/** Texture limits shared across every character in one scene. */
export const SCENE_TEXTURE_LIMITS: Readonly<CharacterTextureLimitOptions> = Object.freeze({
  allowWebp: true,
  maxTotalImageBytes: DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalImageBytes,
  maxTotalImagePixels: DEFAULT_SCENE_WORKLOAD_LIMITS.maxTotalImagePixels,
});
