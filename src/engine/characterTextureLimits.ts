import type Phaser from 'phaser';
import { IMAGE_HEADER_BYTES } from './imageHeader.js';
import { CharacterTextureLimitError, TextureBudget } from './textureBudget.js';

export { DEFAULT_CHARACTER_TEXTURE_LIMITS } from './characterTextureDefaults.js';
export { CharacterTextureLimitError, type CharacterTextureLimitOptions } from './textureBudget.js';

const failures = new WeakMap<Phaser.Loader.File, CharacterTextureLimitError>();

/** @internal Preserve limit diagnostics through Phaser's file failure notifications. */
export function getCharacterTextureLimitError(file: Phaser.Loader.File): CharacterTextureLimitError | undefined {
  return failures.get(file);
}

/** @internal One character load owns its cumulative transfer and decoded-pixel budget. */
export class CharacterTextureBudget extends TextureBudget {
  /** Guard only this helper's files; unrelated assets keep the host loader's own behavior. */
  guard(file: Phaser.Loader.File, active: () => boolean, sharedBudget?: CharacterTextureBudget): void {
    // One callback owner preserves the original failure when either budget rejects.
    const budgets = sharedBudget ? [this, sharedBudget] : [this];
    const progress = file.onProgress.bind(file);
    const loaded = file.onLoad.bind(file);
    const errored = file.onError.bind(file);
    const process = file.onProcess.bind(file);
    const processError = file.onProcessError.bind(file);
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
        processError();
      }
    };
    file.onProgress = (event): void => {
      if (!active() || failed || finished) return;
      try {
        for (const budget of budgets) {
          if (event.lengthComputable && event.total > budget.limits.maxImageBytes)
            throw new CharacterTextureLimitError(
              `Image "${file.key}" exceeds the ${budget.limits.maxImageBytes}-byte limit.`,
            );
          budget.countBytes(file.key, event.loaded);
        }
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
        if (response instanceof Blob) for (const budget of budgets) budget.countBytes(file.key, response.size);
      } catch (error) {
        rejectDownload(error);
        return;
      }
      loaded(xhr, event);
    };
    file.onError = (xhr, event): void => {
      if (active() && !failed && !finished) errored(xhr, event);
    };
    file.onProcessError = (): void => {
      if (!active() || failed || finished) return;
      rejectProcessing(new CharacterTextureLimitError(`Could not decode image "${file.key}".`));
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
        .slice(0, IMAGE_HEADER_BYTES)
        .arrayBuffer()
        .then(
          (buffer) => {
            if (!active() || failed || finished || file.state !== state) return;
            try {
              for (const budget of budgets) budget.checkImageHeader(file.key, new Uint8Array(buffer));
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
        for (const budget of budgets) budget.countPixels(file.key, image.naturalWidth, image.naturalHeight);
      } catch (error) {
        rejectProcessing(error);
        return;
      }
      finished = true;
      complete();
    };
  }
}
