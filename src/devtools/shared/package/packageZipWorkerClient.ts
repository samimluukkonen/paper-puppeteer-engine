import { startWorkerTask } from '../workerTask.js';
import type { PackageFiles } from './characterPackage.js';
import type { PackageZipRequest, PackageZipResponse, PackageZipResult } from './packageZipTasks.js';

export interface PackageZipProcessor {
  encode(files: PackageFiles, signal: AbortSignal): Promise<{ bytes: Uint8Array<ArrayBuffer>; files: PackageFiles }>;
  decode(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<PackageFiles>;
  /** Consumes an exclusively owned buffer, detaching it when posted, including on later cancellation or failure. */
  decodeOwned(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<PackageFiles>;
}

/** One worker per task; abort terminates computation and late replies cannot install a checkpoint or preview. */
async function runPackageZip(
  request: PackageZipRequest,
  signal: AbortSignal,
  transfer?: Transferable[],
): Promise<PackageZipResult> {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./packageZip.worker.ts', import.meta.url), { type: 'module' });
  const response = await startWorkerTask<PackageZipResponse>(worker, request, {
    signal,
    ...(transfer ? { transfer } : {}),
    errorMessage: 'Could not process the package ZIP.',
    messageErrorMessage: 'Could not read the package ZIP result.',
  }).result;
  if (!response.success) throw new Error(response.message);
  return response.result;
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
  async decodeOwned(bytes, signal) {
    const result = await runPackageZip({ operation: 'decode', bytes }, signal, [bytes.buffer]);
    if (result.operation !== 'decode') throw new Error('Unexpected package ZIP decode result.');
    return result.files;
  },
};
