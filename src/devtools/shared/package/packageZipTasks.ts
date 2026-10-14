import type { PackageFiles } from './characterPackage.js';
import { decodePackageZip, encodePackageZip } from './packageZip.js';

export type PackageZipRequest =
  | { operation: 'encode'; files: PackageFiles }
  | { operation: 'decode'; bytes: Uint8Array<ArrayBuffer> };

export type PackageZipResult =
  | { operation: 'encode'; bytes: Uint8Array<ArrayBuffer>; files: PackageFiles }
  | { operation: 'decode'; files: PackageFiles };

export type PackageZipResponse = { success: true; result: PackageZipResult } | { success: false; message: string };

/** The download checkpoint owns files decoded from the exact encoded archive. Runs in the worker. */
export function processPackageZip(request: PackageZipRequest): PackageZipResult {
  if (request.operation === 'decode') return { operation: 'decode', files: decodePackageZip(request.bytes) };
  const bytes = encodePackageZip(request.files);
  return { operation: 'encode', bytes, files: decodePackageZip(bytes) };
}
