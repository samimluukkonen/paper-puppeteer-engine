import { safeFilename } from '../assetFilename.js';

/** Deliberately small ZIP subset: UTF-8, stored files, CRC32, no encryption/ZIP64.
 * PNG/WebP are already compressed. Imports accept exactly the archive form we export.
 */
export const PACKAGE_MAX_BYTES = 100 * 1024 * 1024;
export const PACKAGE_MAX_FILES = 256;
export const PACKAGE_MAX_FILE_BYTES = 10 * 1024 * 1024;

export function packagePath(path: string): string {
  if (
    !path ||
    path.length > 512 ||
    path.startsWith('/') ||
    /[\\:%?#]/.test(path) ||
    path.split('').some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    path.split('/').some((part) => !part || part === '.' || part === '..' || safeFilename(part) !== part)
  )
    throw new Error(`Invalid package path "${path}". Use plain relative paths within the character folder.`);
  return path;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; ++bit) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; ++index) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]!) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

/** Check the same portable file layout before validation, previews and ZIP encoding. */
export function validatePackageFiles(files: ReadonlyMap<string, Uint8Array>): void {
  if (!files.size || files.size > PACKAGE_MAX_FILES) throw new Error('Package must contain 1–256 files.');
  let total = 22;
  const paths = new Set<string>();
  for (const [path, bytes] of files) {
    packagePath(path);
    const folded = path.toLowerCase();
    if (paths.has(folded)) throw new Error(`Duplicate package path "${path}" (case insensitive).`);
    paths.add(folded);
    if (!bytes.length || bytes.length > PACKAGE_MAX_FILE_BYTES) throw new Error(`"${path}" must be 1 byte–10 MiB.`);
    total += bytes.length + 76 + new TextEncoder().encode(path).length * 2;
  }
  // A file cannot also be an extraction directory (including on case-insensitive hosts).
  for (const path of paths) {
    const parts = path.split('/');
    parts.pop();
    while (parts.length) {
      if (paths.has(parts.join('/'))) throw new Error(`Package file/directory collision at "${path}".`);
      parts.pop();
    }
  }
  if (total > PACKAGE_MAX_BYTES) throw new Error('Package exceeds 100 MiB.');
}

export function encodePackageZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  validatePackageFiles(files);
  const encoder = new TextEncoder();
  const entries = [...files].map(([path, bytes]) => ({ name: encoder.encode(path), bytes, crc: crc32(bytes) }));
  const size = entries.reduce((sum, entry) => sum + 76 + entry.name.length * 2 + entry.bytes.length, 22);
  const output = new Uint8Array(size);
  const view = new DataView(output.buffer);
  const u16 = (at: number, value: number): void => view.setUint16(at, value, true);
  const u32 = (at: number, value: number): void => view.setUint32(at, value, true);
  let offset = 0;
  const offsets: number[] = [];
  for (const { name, bytes, crc } of entries) {
    offsets.push(offset);
    u32(offset, 0x04034b50);
    u16(offset + 4, 20);
    u16(offset + 6, 0x800);
    u32(offset + 14, crc);
    u32(offset + 18, bytes.length);
    u32(offset + 22, bytes.length);
    u16(offset + 26, name.length);
    output.set(name, offset + 30);
    output.set(bytes, offset + 30 + name.length);
    offset += 30 + name.length + bytes.length;
  }
  const centralOffset = offset;
  entries.forEach(({ name, bytes, crc }, index) => {
    u32(offset, 0x02014b50);
    u16(offset + 4, 20);
    u16(offset + 6, 20);
    u16(offset + 8, 0x800);
    u32(offset + 16, crc);
    u32(offset + 20, bytes.length);
    u32(offset + 24, bytes.length);
    u16(offset + 28, name.length);
    u32(offset + 42, offsets[index]!);
    output.set(name, offset + 46);
    offset += 46 + name.length;
  });
  u32(offset, 0x06054b50);
  u16(offset + 8, entries.length);
  u16(offset + 10, entries.length);
  u32(offset + 12, offset - centralOffset);
  u32(offset + 16, centralOffset);
  return output;
}

export function decodePackageZip(bytes: Uint8Array): ReadonlyMap<string, Uint8Array<ArrayBuffer>> {
  if (bytes.length < 22 || bytes.length > PACKAGE_MAX_BYTES) throw new Error('Invalid ZIP size (maximum 100 MiB).');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number): number => view.getUint16(at, true);
  const u32 = (at: number): number => view.getUint32(at, true);
  const end = bytes.length - 22;
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20) || u16(end + 8) !== u16(end + 10))
    throw new Error('Unsupported ZIP. Import a package ZIP downloaded by this editor.');
  const count = u16(end + 10);
  const central = u32(end + 16);
  if (!count || count > PACKAGE_MAX_FILES || central + u32(end + 12) !== end)
    throw new Error('Invalid ZIP directory or resource count.');
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let offset = central;
  let localEnd = 0;
  for (let index = 0; index < count; ++index) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory entry.');
    const size = u32(offset + 24),
      local = u32(offset + 42),
      nameLength = u16(offset + 28);
    const entryEnd = offset + 46 + nameLength;
    if (
      u16(offset + 8) !== 0x800 ||
      u16(offset + 10) ||
      u16(offset + 30) ||
      u16(offset + 32) ||
      u16(offset + 34) ||
      size !== u32(offset + 20) ||
      entryEnd > end ||
      local !== localEnd ||
      local + 30 > central ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== 0x800 ||
      u16(local + 8) ||
      u16(local + 28) ||
      u16(local + 26) !== nameLength ||
      u32(local + 18) !== size ||
      u32(local + 22) !== size ||
      u32(local + 14) !== u32(offset + 16)
    )
      throw new Error('Unsupported or damaged ZIP entry. Use the original editor download.');
    const path = packagePath(decoder.decode(bytes.subarray(offset + 46, entryEnd)));
    const dataStart = local + 30 + nameLength;
    if (dataStart + size > central || decoder.decode(bytes.subarray(local + 30, dataStart)) !== path || files.has(path))
      throw new Error(`Invalid or duplicate ZIP entry "${path}".`);
    if (size > PACKAGE_MAX_FILE_BYTES) throw new Error(`"${path}" exceeds 10 MiB.`);
    const data = new Uint8Array(bytes.subarray(dataStart, dataStart + size));
    if (crc32(data) !== u32(offset + 16)) throw new Error(`Damaged ZIP file "${path}" (CRC mismatch).`);
    files.set(path, data);
    localEnd = dataStart + size;
    offset = entryEnd;
  }
  if (offset !== end || localEnd !== central) throw new Error('Invalid ZIP layout.');
  validatePackageFiles(files);
  return files;
}
