import { writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { waitForPreviewPaint } from './fixtures.js';

/** Compare renderer pixels independently of CSS fitting when save/feedback rows resize the preview. */
export async function capturePreviewFrame(page: Page, canvas: Locator, path?: string): Promise<Buffer> {
  await waitForPreviewPaint(page);
  const data = await canvas.evaluate(async (element) => {
    // WebGL's drawing buffer is available within the rendering frame, before browser compositing clears it.
    const png = await new Promise<string>((resolve, reject) =>
      requestAnimationFrame(() => {
        try {
          resolve((element as HTMLCanvasElement).toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      }),
    );
    const bitmap = await createImageBitmap(await (await fetch(png)).blob());
    try {
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let painted = false;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index]) {
          painted = true;
          break;
        }
      }
      if (!painted) throw new Error('Preview canvas has not painted a nontransparent frame.');
    } finally {
      bitmap.close();
    }
    return png;
  });
  const bytes = Buffer.from(data.split(',')[1]!, 'base64');
  if (path) await writeFile(path, bytes);
  return bytes;
}
