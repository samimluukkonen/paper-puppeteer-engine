import type { PackageFiles } from './characterPackage.js';
import type { PackageZipRequest, PackageZipResponse, PackageZipResult } from './packageZipTasks.js';

export interface PackageZipProcessor {
  encode(files: PackageFiles, signal: AbortSignal): Promise<{ bytes: Uint8Array<ArrayBuffer>; files: PackageFiles }>;
  decode(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<PackageFiles>;
}

/** One worker per task; abort terminates computation and late replies cannot install a checkpoint or preview. */
function runPackageZip(request: PackageZipRequest, signal: AbortSignal): Promise<PackageZipResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./packageZip.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      complete();
    };
    const abort = (): void => finish(() => reject(signal.reason));
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<PackageZipResponse>) => {
      const response = event.data;
      finish(() => {
        if (response.success) resolve(response.result);
        else reject(new Error(response.message));
      });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(() => reject(new Error(event.message || 'Could not process the package ZIP.')));
    };
    worker.onmessageerror = () => finish(() => reject(new Error('Could not read the package ZIP result.')));
    try {
      signal.throwIfAborted();
      // Clone inputs so canceling a task never detaches buffers retained by its caller.
      worker.postMessage(request);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export const packageZipWorker: PackageZipProcessor = {
  async encode(files, signal) {
    const result = await runPackageZip({ operation: 'encode', files }, signal);
    if (result.operation !== 'encode') throw new Error('Unexpected package ZIP encode result.');
    return result;
  },
  async decode(bytes, signal) {
    const result = await runPackageZip({ operation: 'decode', bytes }, signal);
    if (result.operation !== 'decode') throw new Error('Unexpected package ZIP decode result.');
    return result.files;
  },
};
