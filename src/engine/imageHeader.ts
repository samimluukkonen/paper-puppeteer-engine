export interface ImageHeader {
  readonly format: 'image/png' | 'image/webp';
  readonly width: number;
  readonly height: number;
}

export const IMAGE_HEADER_BYTES = 30;

/** Inspect PNG/static WebP dimensions without decoding pixels. Callers enforce their own size budgets. */
export function inspectImageHeader(bytes: Uint8Array, allowWebp = true): ImageHeader | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number): string =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  if (
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every((value, index) => bytes[index] === value)
  )
    return { format: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  if (!allowWebp || bytes.length < IMAGE_HEADER_BYTES || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP')
    return undefined;
  const chunk = ascii(12, 4);
  let width: number;
  let height: number;
  if (chunk === 'VP8X') {
    if (view.getUint32(16, true) !== 10) throw new Error('Invalid WebP header. Export the sprite again.');
    if (bytes[20]! & 0x02) throw new Error('Animated WebP is not supported. Export a static sprite.');
    width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
    height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
  } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    width = 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8);
    height = 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10);
  } else if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    width = view.getUint16(26, true) & 0x3fff;
    height = view.getUint16(28, true) & 0x3fff;
  } else throw new Error('Invalid or unsupported WebP header. Export a static PNG or WebP sprite.');
  return { format: 'image/webp', width, height };
}
