import { inspectAudioData } from './AudioAsset.js';

export const AUDIO_MAX_DECODED_BYTES = 128 * 1024 * 1024;
export const AUDIO_DECODE_BUDGET_ERROR =
  'Decoded audio exceeds the 128 MiB audio budget or has invalid duration. Use shorter audio or a lower sample rate, then reopen the Audio section or scene.';

/** Hold the slot until the actual operation settles, even if its caller stops waiting. */
export class AudioDecodeQueue {
  private tail = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation);
    this.tail = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }
}

interface AudioMetadata {
  readonly duration: number;
  readonly channels: number;
  readonly sampleRate: number;
}

function ascii(bytes: Uint8Array, at: number, value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (bytes[at + i] !== value.charCodeAt(i)) return false;
  }
  return true;
}

function wavMetadata(bytes: Uint8Array, view: DataView): AudioMetadata[] {
  let channels = 0;
  let sampleRate = 0;
  let blockAlign = 0;
  let format = 0;
  let samples = 0;
  let dataBytes = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + size > bytes.length) break;
    if (ascii(bytes, at, 'fmt ') && size >= 16) {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      blockAlign = view.getUint16(start + 12, true);
      // WAVE_FORMAT_EXTENSIBLE stores its base format in the subformat GUID.
      if (format === 0xfffe && size >= 40) format = view.getUint16(start + 24, true);
    } else if (ascii(bytes, at, 'fact') && size >= 4) samples = view.getUint32(start, true);
    else if (ascii(bytes, at, 'data')) dataBytes += size;
    at = start + size + (size % 2);
  }
  if ((format === 1 || format === 3) && blockAlign) samples = Math.max(samples, dataBytes / blockAlign);
  if (!samples) return []; // Unknown compressed WAV without a fact sample count.
  return [{ duration: samples / sampleRate, channels, sampleRate }];
}

function mp3Metadata(bytes: Uint8Array): AudioMetadata[] {
  let at = 0;
  // Skip ID3v2 payloads rather than treating embedded pictures as MPEG frames.
  while (at + 10 <= bytes.length && ascii(bytes, at, 'ID3')) {
    const sizeBytes = bytes.subarray(at + 6, at + 10);
    if (sizeBytes.some((byte) => byte >= 128)) return [];
    const size = sizeBytes.reduce((total, byte) => total * 128 + byte, 0);
    at += 10 + size + (bytes[at + 3] === 4 && bytes[at + 5]! & 0x10 ? 10 : 0);
  }
  let duration = 0;
  let channels = 0;
  let sampleRate = 0;
  const mpeg1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  for (; at + 4 <= bytes.length;) {
    const second = bytes[at + 1]!;
    const third = bytes[at + 2]!;
    const version = (second >> 3) & 3;
    const rateIndex = (third >> 2) & 3;
    const bitrateIndex = third >> 4;
    if (
      bytes[at] !== 0xff ||
      (second & 0xe0) !== 0xe0 ||
      version === 1 ||
      (second & 6) !== 2 ||
      rateIndex === 3 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15
    ) {
      at++;
      continue; // Unsupported layers/free bitrate remain the browser's responsibility.
    }
    const rate = [44100, 48000, 32000][rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (version === 3 ? mpeg1 : mpeg2)[bitrateIndex]! * 1000;
    const size = Math.floor(((version === 3 ? 144 : 72) * bitrate) / rate) + ((third >> 1) & 1);
    if (at + size > bytes.length) break;
    duration += (version === 3 ? 1152 : 576) / rate;
    channels = Math.max(channels, bytes[at + 3]! >> 6 === 3 ? 1 : 2);
    sampleRate = Math.max(sampleRate, rate);
    at += size;
  }
  return duration ? [{ duration, channels, sampleRate }] : [];
}

function oggMetadata(bytes: Uint8Array, view: DataView): AudioMetadata[] {
  const streams = new Map<number, { channels: number; sampleRate: number; samples: number }>();
  for (let at = 0; at + 27 <= bytes.length;) {
    if (!ascii(bytes, at, 'OggS') || bytes[at + 4] !== 0) break;
    const segments = bytes[at + 26]!;
    const start = at + 27 + segments;
    if (start > bytes.length) break;
    let size = 0;
    for (let i = at + 27; i < start; i++) size += bytes[i]!;
    if (start + size > bytes.length) break;
    const serial = view.getUint32(at + 14, true);
    if (bytes[at + 5]! & 2) {
      if (size >= 30 && bytes[start] === 1 && ascii(bytes, start + 1, 'vorbis'))
        streams.set(serial, {
          channels: bytes[start + 11]!,
          sampleRate: view.getUint32(start + 12, true),
          samples: 0,
        });
      else if (size >= 19 && ascii(bytes, start, 'OpusHead'))
        // Opus granules always use 48 kHz; the input-rate field is informational.
        streams.set(serial, { channels: bytes[start + 9]!, sampleRate: 48000, samples: 0 });
    }
    const stream = streams.get(serial);
    const granule = view.getBigUint64(at + 6, true);
    if (stream && granule !== 0xffffffffffffffffn) stream.samples = Math.max(stream.samples, Number(granule));
    at = start + size;
  }
  // Summing logical streams conservatively includes chained and multiplexed audio.
  return [...streams.values()].map(({ channels, sampleRate, samples }) => ({
    duration: samples / sampleRate,
    channels,
    sampleRate,
  }));
}

/** Best-effort container preflight; unrecognized codecs still use the post-decode boundary.
 * Metadata is untrusted and cannot replace validation of the browser's actual AudioBuffer.
 */
export function preflightAudioDecode(bytes: Uint8Array, budget: number, outputSampleRate?: number): void {
  const format = inspectAudioData(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metadata =
    format === 'wav' ? wavMetadata(bytes, view) : format === 'mp3' ? mp3Metadata(bytes) : oggMetadata(bytes, view);
  let duration = 0;
  let channels = 0;
  let rate = outputSampleRate ?? 0;
  for (const entry of metadata) {
    if (!Number.isFinite(entry.duration) || entry.duration <= 0 || !entry.channels || !entry.sampleRate)
      throw new Error(AUDIO_DECODE_BUDGET_ERROR);
    duration += entry.duration;
    channels = Math.max(channels, entry.channels);
    rate = Math.max(rate, entry.sampleRate);
  }
  // Cover resampling, source allocation and channel/rate changes across chained streams.
  const estimatedBytes = Math.ceil(duration * rate) * channels * 4;
  if (!Number.isFinite(budget) || budget <= 0 || estimatedBytes > budget) throw new Error(AUDIO_DECODE_BUDGET_ERROR);
}
