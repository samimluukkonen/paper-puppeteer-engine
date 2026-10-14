import { type PackageZipRequest, type PackageZipResponse, processPackageZip } from './packageZipTasks.js';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PackageZipRequest>) => void) | null;
  postMessage(response: PackageZipResponse, transfer: ArrayBuffer[]): void;
};

worker.onmessage = (event) => {
  try {
    const result = processPackageZip(event.data);
    const buffers = [...result.files.values()].map((bytes) => bytes.buffer);
    if (result.operation === 'encode') buffers.push(result.bytes.buffer);
    worker.postMessage({ success: true, result }, [...new Set(buffers)]);
  } catch (error) {
    worker.postMessage({ success: false, message: error instanceof Error ? error.message : String(error) }, []);
  }
};
