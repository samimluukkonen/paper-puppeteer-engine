import type Phaser from 'phaser';
import { validateInputLimit } from './jsonInput.js';

export const DEFAULT_CHARACTER_TEXTURE_LIMITS = Object.freeze({
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalImageBytes: 50 * 1024 * 1024,
  maxImageDimension: 8192,
  maxImagePixels: 16 * 1024 * 1024,
  maxTotalImagePixels: 64 * 1024 * 1024,
});

type TextureLimits = { [Key in keyof typeof DEFAULT_CHARACTER_TEXTURE_LIMITS]: number };
export interface CharacterTextureLimitOptions extends Partial<TextureLimits> {
  /** Require a PNG header before browser decoding. Defaults to true; disable only for trusted artwork. */
  requirePng?: boolean;
}

export class CharacterTextureLimitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CharacterTextureLimitError';
  }
}

const failures = new WeakMap<Phaser.Loader.File, CharacterTextureLimitError>();

/** @internal Preserve limit diagnostics through Phaser's file failure notifications. */
export function getCharacterTextureLimitError(file: Phaser.Loader.File): CharacterTextureLimitError | undefined {
  return failures.get(file);
}

/** @internal One character load owns its cumulative transfer and decoded-pixel budget. */
export class CharacterTextureBudget {
  private readonly limits: TextureLimits;
  private readonly requirePng: boolean;
  private readonly bytes = new Map<string, number>();
  private readonly pixels = new Map<string, number>();
  private totalBytes = 0;
  private totalPixels = 0;

  constructor(options: CharacterTextureLimitOptions) {
    if (options.requirePng !== undefined && typeof options.requirePng !== 'boolean')
      throw new Error('requirePng must be a boolean.');
    this.requirePng = options.requirePng ?? true;
    this.limits = Object.fromEntries(
      Object.entries(DEFAULT_CHARACTER_TEXTURE_LIMITS).map(([name, fallback]) => [
        name,
        validateInputLimit(options[name as keyof TextureLimits] ?? fallback, name),
      ]),
    ) as TextureLimits;
  }

  private countBytes(key: string, bytes: number): void {
    if (bytes > this.limits.maxImageBytes)
      throw new CharacterTextureLimitError(`Image "${key}" exceeds the ${this.limits.maxImageBytes}-byte limit.`);
    const before = this.bytes.get(key) ?? 0;
    if (bytes <= before) return;
    this.bytes.set(key, bytes);
    this.totalBytes += bytes - before;
    if (this.totalBytes > this.limits.maxTotalImageBytes)
      throw new CharacterTextureLimitError(
        `Character artwork exceeds the ${this.limits.maxTotalImageBytes}-byte total limit.`,
      );
  }

  private countPixels(key: string, width: number, height: number): void {
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
    this.pixels.set(key, pixels);
    this.totalPixels += pixels - before;
    if (this.totalPixels > this.limits.maxTotalImagePixels)
      throw new CharacterTextureLimitError(
        `Character artwork exceeds the ${this.limits.maxTotalImagePixels}-pixel total limit.`,
      );
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
        const prefix = atob(base64.slice(0, 32));
        this.checkImageHeader(
          key,
          Uint8Array.from(prefix, (character) => character.charCodeAt(0)),
        );
      } else {
        this.countBytes(key, new TextEncoder().encode(encoded.replace(/%[\da-f]{2}/gi, 'x')).byteLength);
        const header: number[] = [];
        for (let index = 0; index < encoded.length && header.length < 24; index++) {
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

  private checkImageHeader(key: string, bytes: Uint8Array): void {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
    if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
      if (this.requirePng)
        throw new CharacterTextureLimitError(
          `Image "${key}" must have a PNG header before decoding. Set requirePng to false only for trusted artwork.`,
        );
      return;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.countPixels(key, view.getUint32(16), view.getUint32(20));
  }

  /** Guard only this helper's files; unrelated assets keep the host loader's own behavior. */
  guard(file: Phaser.Loader.File, active: () => boolean): void {
    const progress = file.onProgress.bind(file);
    const loaded = file.onLoad.bind(file);
    const errored = file.onError.bind(file);
    const process = file.onProcess.bind(file);
    const complete = file.onProcessComplete.bind(file);
    let failed = false;
    let finished = false;
    const recordFailure = (error: unknown): void => {
      failed = true;
      failures.set(
        file,
        error instanceof CharacterTextureLimitError
          ? error
          : new CharacterTextureLimitError(`Could not inspect image "${file.key}".`, { cause: error }),
      );
    };
    const rejectDownload = (error: unknown): void => {
      recordFailure(error);
      file.resetXHR();
      if (file.xhrLoader) file.xhrLoader.ontimeout = null;
      file.xhrLoader?.abort();
      file.xhrLoader = null;
      file.loader.nextFile(file, false);
    };
    const rejectProcessing = (error: unknown): void => {
      recordFailure(error);
      const image: unknown = file.data;
      if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
        image.onload = image.onerror = null;
        if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
        image.src = '';
      }
      // Phaser does not emit loaderror for processing errors itself. Record it
      // before completion so scene sessions cannot accept missing artwork.
      try {
        file.loader.emit('loaderror', file);
      } finally {
        file.onProcessError();
      }
    };
    file.onProgress = (event): void => {
      if (!active() || failed || finished) return;
      try {
        if (event.lengthComputable && event.total > this.limits.maxImageBytes)
          throw new CharacterTextureLimitError(
            `Image "${file.key}" exceeds the ${this.limits.maxImageBytes}-byte limit.`,
          );
        this.countBytes(file.key, event.loaded);
      } catch (error) {
        rejectDownload(error);
        return;
      }
      progress(event);
    };
    file.onLoad = (xhr, event): void => {
      if (!active() || failed || finished) return;
      const response: unknown = xhr.response;
      try {
        if (response instanceof Blob) this.countBytes(file.key, response.size);
      } catch (error) {
        rejectDownload(error);
        return;
      }
      loaded(xhr, event);
    };
    file.onError = (xhr, event): void => {
      if (active() && !failed && !finished) errored(xhr, event);
    };
    file.onProcess = (): void => {
      if (!active() || failed || finished) return;
      const response: unknown = file.xhrLoader?.response;
      if (!(response instanceof Blob)) {
        // Inline images already passed the header check before being queued.
        if (this.requirePng && !file.base64) {
          rejectProcessing(new CharacterTextureLimitError(`Could not inspect image "${file.key}" before decoding.`));
          return;
        }
        process();
        return;
      }
      const state = file.state;
      // Require a recognizable header before browser decoding unless the host
      // explicitly trusts alternative image formats.
      void response
        .slice(0, 24)
        .arrayBuffer()
        .then(
          (buffer) => {
            if (!active() || failed || finished || file.state !== state) return;
            try {
              this.checkImageHeader(file.key, new Uint8Array(buffer));
            } catch (error) {
              rejectProcessing(error);
              return;
            }
            process();
          },
          (error: unknown) => {
            if (active() && !failed && !finished && file.state === state) rejectProcessing(error);
          },
        )
        .catch((error: unknown) => {
          if (active() && !failed && !finished) rejectProcessing(error);
        });
    };
    file.onProcessComplete = (): void => {
      if (!active() || failed || finished) return;
      const image: unknown = file.data;
      try {
        if (
          image === null ||
          typeof image !== 'object' ||
          !('naturalWidth' in image) ||
          !('naturalHeight' in image) ||
          typeof image.naturalWidth !== 'number' ||
          typeof image.naturalHeight !== 'number'
        )
          throw new CharacterTextureLimitError(`Could not inspect image "${file.key}" dimensions.`);
        this.countPixels(file.key, image.naturalWidth, image.naturalHeight);
      } catch (error) {
        rejectProcessing(error);
        return;
      }
      finished = true;
      complete();
    };
  }
}
