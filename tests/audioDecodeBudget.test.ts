import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import {
  AUDIO_MAX_DECODED_BYTES,
  AudioAssetLoader,
  WebAudioBackend,
  type AudioBackend,
  type DecodedAudioResource,
} from '../src/engine/AudioAssetLoader.js';
import { preflightAudioDecode } from '../src/engine/audioDecodeBudget.js';

const fixture = (format = 'wav') =>
  new Uint8Array(readFileSync(new URL(`./fixtures/audio/tone.${format}`, import.meta.url)));
const loaders: AudioAssetLoader[] = [];
const browsers: WebAudioBackend[] = [];
afterEach(() => {
  loaders.splice(0).forEach((loader) => loader.dispose());
  browsers.splice(0).forEach((backend) => backend.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function resource(byteLength = 64000) {
  return {
    durationSeconds: 2,
    byteLength,
    play: vi.fn<DecodedAudioResource['play']>(),
    dispose: vi.fn(),
  } satisfies DecodedAudioResource;
}
function loaderWith(decode: AudioBackend['decode']) {
  const loader = new AudioAssetLoader(() => undefined, { decode, resume: async () => {}, dispose: vi.fn() });
  loaders.push(loader);
  return loader;
}
function oggPage(packet: Uint8Array, samples: bigint, serial = 1, flags = 0) {
  const bytes = new Uint8Array(28 + packet.length);
  bytes.set(new TextEncoder().encode('OggS'));
  bytes[5] = flags;
  const view = new DataView(bytes.buffer);
  view.setBigUint64(6, samples, true);
  view.setUint32(14, serial, true);
  bytes[26] = 1;
  bytes[27] = packet.length;
  bytes.set(packet, 28);
  return bytes;
}
function ogg(codec: 'vorbis' | 'opus', samples: bigint, channels = 2, serial = 1) {
  const packet = new Uint8Array(30);
  const view = new DataView(packet.buffer);
  if (codec === 'vorbis') {
    packet[0] = 1;
    packet.set(new TextEncoder().encode('vorbis'), 1);
    packet[11] = channels;
    view.setUint32(12, 48000, true);
  } else {
    packet.set(new TextEncoder().encode('OpusHead'));
    packet[8] = 1;
    packet[9] = channels;
    view.setUint32(12, 8000, true); // Informational input rate must not size Opus output.
  }
  return concat(oggPage(packet, 0n, serial, 2), oggPage(new Uint8Array(1), samples, serial, 4));
}
function concat(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}
function compressedWav(samples: number) {
  const bytes = new Uint8Array(58);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'));
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 2, true); // ADPCM: duration comes from fact, not compressed block size.
  view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true);
  bytes.set(new TextEncoder().encode('fact'), 36);
  view.setUint32(40, 4, true);
  view.setUint32(44, samples, true);
  bytes.set(new TextEncoder().encode('data'), 48);
  view.setUint32(52, 2, true);
  return bytes;
}

test.each(['wav', 'mp3', 'ogg'])('%s metadata preflights actual fixture duration and channels', (format) => {
  const bytes = fixture(format);
  expect(() => preflightAudioDecode(bytes, AUDIO_MAX_DECODED_BYTES, 48000)).not.toThrow();
  expect(() => preflightAudioDecode(bytes, 1000, 48000)).toThrow(/128 MiB/);
  // A nonzero byte offset must not change header reads.
  const padded = concat(new Uint8Array(7), bytes);
  expect(() => preflightAudioDecode(padded.subarray(7), 1000)).toThrow(/128 MiB/);
});

test.each(['vorbis', 'opus'] as const)(
  '%s compressed duration is rejected before backend allocation',
  async (codec) => {
    const decode = vi.fn(async () => resource());
    const loader = loaderWith(decode);
    await expect(loader.prepare(ogg(codec, 20_000_000n))).rejects.toThrow(/128 MiB/);
    expect(decode).not.toHaveBeenCalled();
    await loader.prepare(ogg(codec, 48000n));
    expect(decode).toHaveBeenCalledOnce();
  },
);

test('compressed WAV fact samples and low bitrate MPEG-2.5 frames reject before allocation', async () => {
  const decode = vi.fn(async () => resource());
  const loader = loaderWith(decode);
  await expect(loader.prepare(compressedWav(20_000_000))).rejects.toThrow(/128 MiB/);
  const mp3 = new Uint8Array(30_000 * 72);
  for (let at = 0; at < mp3.length; at += 72) mp3.set([0xff, 0xe3, 0x18, 0], at);
  await expect(loader.prepare(mp3)).rejects.toThrow(/128 MiB/);
  expect(decode).not.toHaveBeenCalled();
});

test('Ogg preflight accounts for chained streams, channel changes and unset granules', () => {
  const chained = concat(ogg('vorbis', 10_000_000n, 1), ogg('opus', 10_000_000n, 2, 2));
  expect(() => preflightAudioDecode(chained, AUDIO_MAX_DECODED_BYTES)).toThrow(/128 MiB/);
  const unset = concat(ogg('vorbis', 48000n), oggPage(new Uint8Array(1), 0xffffffffffffffffn));
  expect(() => preflightAudioDecode(unset, AUDIO_MAX_DECODED_BYTES)).not.toThrow();
});

test('malformed trailing data cannot discard already parsed WAV or Ogg budget metadata', () => {
  const junk = new TextEncoder().encode('JUNKffffffffffffffffffffffffffff');
  for (const bytes of [compressedWav(20_000_000), ogg('vorbis', 20_000_000n)])
    expect(() => preflightAudioDecode(concat(bytes, junk), AUDIO_MAX_DECODED_BYTES)).toThrow(/128 MiB/);
});

test('MP3 skips ID3 payloads and includes varying bitrates and padding in duration', () => {
  const bytes = fixture('mp3');
  const tagged = concat(new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 4]), bytes.subarray(0, 4), bytes);
  expect(() => preflightAudioDecode(tagged, 1_000_000)).not.toThrow();
  const variable = concat(bytes.subarray(0, 417), new Uint8Array(523));
  variable.set([0xff, 0xfb, 0xa2, 0xc0], 417); // 160 kbit/s, padding, mono.
  expect(() => preflightAudioDecode(variable, 20000)).not.toThrow();
  expect(() => preflightAudioDecode(variable, 10000)).toThrow(/128 MiB/);
});

test('preflight tolerates unsupported/truncated containers without out-of-bounds reads', () => {
  for (const format of ['wav', 'mp3', 'ogg']) {
    const bytes = fixture(format);
    for (let length = 12; length < Math.min(bytes.length, 100); length++)
      expect(() => preflightAudioDecode(bytes.subarray(0, length), AUDIO_MAX_DECODED_BYTES)).not.toThrow(RangeError);
  }
});

test('distinct requests serialize and recheck the remaining cache budget before decode', async () => {
  const first = deferred<DecodedAudioResource>();
  const decoded = resource(AUDIO_MAX_DECODED_BYTES - 1024);
  const decode = vi.fn(() => first.promise);
  const loader = loaderWith(decode);
  const one = loader.prepare(fixture());
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
  const two = loader.prepare(fixture('mp3'));
  const rejected = expect(two).rejects.toThrow(/128 MiB/);
  await new Promise((done) => setTimeout(done, 20));
  expect(decode).toHaveBeenCalledOnce();
  first.resolve(decoded);
  await one;
  await rejected;
  expect(decode).toHaveBeenCalledOnce();
  expect(decode).toHaveBeenCalledWith(expect.any(Uint8Array), AUDIO_MAX_DECODED_BYTES, expect.any(AbortSignal));
  loader.clear();
  decode.mockResolvedValue(resource());
  await loader.prepare(fixture('mp3'));
  expect(decode).toHaveBeenCalledTimes(2);
});

test.each(['clear', 'dispose'] as const)('%s skips queued requests and releases late results', async (command) => {
  const first = deferred<DecodedAudioResource>();
  const decoded = resource();
  const decode = vi.fn(() => first.promise);
  const loader = loaderWith(decode);
  const one = loader.prepare(fixture());
  const rejectedOne = expect(one).rejects.toThrow();
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
  const two = loader.prepare(fixture('mp3'));
  const rejectedTwo = expect(two).rejects.toThrow();
  // Wait for hashing so the second request reaches the decode queue.
  await new Promise((done) => setTimeout(done, 20));
  loader[command]();
  await rejectedOne;
  await rejectedTwo;
  first.resolve(decoded);
  await vi.waitFor(() => expect(decoded.dispose).toHaveBeenCalledOnce());
  expect(decode).toHaveBeenCalledOnce();
  if (command === 'clear') {
    decode.mockResolvedValue(resource());
    await loader.prepare(fixture('mp3'));
    expect(decode).toHaveBeenCalledTimes(2);
  }
});

test('a rejected decode releases the slot and post-decode limits still dispose oversized results', async () => {
  const decode = vi.fn(async () => resource());
  decode.mockRejectedValueOnce(new Error('bad codec'));
  const loader = loaderWith(decode);
  await expect(loader.prepare(fixture())).rejects.toThrow(/bad codec/);
  const oversized = resource(AUDIO_MAX_DECODED_BYTES + 1);
  decode.mockResolvedValueOnce(oversized);
  await expect(loader.prepare(fixture())).rejects.toThrow(/128 MiB/);
  expect(oversized.dispose).toHaveBeenCalledOnce();
  await loader.prepare(fixture());
});

test('post-decode accounting rejects aggregate overflow even when container metadata underestimates it', async () => {
  const decoded = resource(AUDIO_MAX_DECODED_BYTES / 2 + 1);
  const rejected = resource(AUDIO_MAX_DECODED_BYTES / 2);
  const decode = vi
    .fn(async () => decoded)
    .mockResolvedValueOnce(decoded)
    .mockResolvedValueOnce(rejected);
  const loader = loaderWith(decode);
  await loader.prepare(fixture());
  await expect(loader.prepare(fixture('ogg'))).rejects.toThrow(/128 MiB/);
  expect(rejected.dispose).toHaveBeenCalledOnce();
  expect(decoded.dispose).not.toHaveBeenCalled();
});

function browserBackend(sampleRate = 48000) {
  const context = {
    sampleRate,
    state: 'suspended',
    close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: 2, length: sampleRate * 2, numberOfChannels: 1 })),
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context;
      }
    },
  );
  const backend = new WebAudioBackend();
  browsers.push(backend);
  return { backend, context };
}

test('Web Audio includes context resampling in the remaining budget before calling the decoder', async () => {
  const { backend, context } = browserBackend();
  // Source: 2 s * 8 kHz * 1 channel * 4 bytes = 64 kB; output: 384 kB.
  await expect(backend.decode(fixture(), 100000)).rejects.toThrow(/128 MiB/);
  expect(context.decodeAudioData).not.toHaveBeenCalled();
  const decoded = await backend.decode(fixture(), 400000);
  expect(decoded.byteLength).toBe(384000);
  decoded.dispose();
});

test('native decoding is serialized across backend instances', async () => {
  const first = browserBackend();
  const waiting = deferred<{ duration: number; length: number; numberOfChannels: number }>();
  first.context.decodeAudioData.mockReturnValueOnce(waiting.promise);
  const one = first.backend.decode(fixture());
  await vi.waitFor(() => expect(first.context.decodeAudioData).toHaveBeenCalledOnce());
  const second = browserBackend();
  const two = second.backend.decode(fixture('mp3'));
  await new Promise((done) => setTimeout(done, 20));
  expect(second.context.decodeAudioData).not.toHaveBeenCalled();
  waiting.resolve({ duration: 2, length: 96000, numberOfChannels: 1 });
  (await one).dispose();
  (await two).dispose();
  expect(second.context.decodeAudioData).toHaveBeenCalledOnce();
});

test('a cancelled native queue entry never calls decodeAudioData', async () => {
  const first = browserBackend();
  const waiting = deferred<{ duration: number; length: number; numberOfChannels: number }>();
  first.context.decodeAudioData.mockReturnValueOnce(waiting.promise);
  const one = first.backend.decode(fixture());
  await vi.waitFor(() => expect(first.context.decodeAudioData).toHaveBeenCalledOnce());
  const second = browserBackend();
  const cancelled = new AbortController();
  const two = second.backend.decode(fixture(), AUDIO_MAX_DECODED_BYTES, cancelled.signal);
  const rejected = expect(two).rejects.toThrow();
  cancelled.abort();
  waiting.resolve({ duration: 2, length: 96000, numberOfChannels: 1 });
  (await one).dispose();
  await rejected;
  expect(second.context.decodeAudioData).not.toHaveBeenCalled();
  (await second.backend.decode(fixture())).dispose();
  expect(second.context.decodeAudioData).toHaveBeenCalledOnce();
});

test('direct Web Audio decoding keeps a post-allocation limit for unsupported metadata', async () => {
  const { backend, context } = browserBackend();
  context.decodeAudioData.mockResolvedValueOnce({
    duration: 1000,
    length: AUDIO_MAX_DECODED_BYTES / 4 + 1,
    numberOfChannels: 1,
  });
  await expect(backend.decode(new TextEncoder().encode('RIFF1234WAVE'))).rejects.toThrow(/128 MiB/);
  expect(context.decodeAudioData).toHaveBeenCalledOnce();
  (await backend.decode(fixture())).dispose();
});
