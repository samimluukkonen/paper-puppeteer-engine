import { z } from 'zod';
import { PACKAGE_MAX_FILE_BYTES, packagePath } from './packageZip.js';

export const AUDIO_CATEGORIES = ['music', 'ambience', 'sfx', 'voice'] as const;
export type AudioCategory = (typeof AUDIO_CATEGORIES)[number];
export const audioAssetDefinitionSchema = z.strictObject({
  id: z.string().min(1).max(200).regex(/\S/),
  name: z.string().min(1).max(200).regex(/\S/),
  path: z.string().transform((value) => packagePath(value)),
  category: z.enum(AUDIO_CATEGORIES),
  durationSeconds: z.number().finite().positive().exactOptional(),
});
export type AudioAssetDefinition = z.infer<typeof audioAssetDefinitionSchema>;
export type AudioFormat = 'wav' | 'mp3' | 'ogg';
export const AUDIO_MAX_FILE_BYTES = PACKAGE_MAX_FILE_BYTES;

/** Container signatures are a preflight only. The browser decoder decides codec support. */
export function inspectAudioData(bytes: Uint8Array): AudioFormat {
  if (!bytes.length || bytes.length > AUDIO_MAX_FILE_BYTES)
    throw new Error('Audio must contain 1 byte–10 MiB. Export a smaller WAV, MP3 or OGG file and retry.');
  const ascii = (at: number, value: string) =>
    Array.from(value).every((char, i) => bytes[at + i] === char.charCodeAt(0));
  if (bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'wav';
  if (bytes.length >= 4 && ascii(0, 'OggS')) return 'ogg';
  if (
    (bytes.length >= 10 && ascii(0, 'ID3')) ||
    (bytes.length >= 4 &&
      bytes[0] === 0xff &&
      (bytes[1]! & 0xe0) === 0xe0 &&
      (bytes[1]! & 0x18) !== 0x08 &&
      (bytes[1]! & 0x06) !== 0 &&
      (bytes[2]! & 0xf0) !== 0 &&
      (bytes[2]! & 0xf0) !== 0xf0 &&
      (bytes[2]! & 0x0c) !== 0x0c)
  )
    return 'mp3';
  throw new Error(
    'Unrecognized audio data. Export a valid WAV, MP3 or OGG file and retry; renaming an extension does not convert audio.',
  );
}

export function validateAudioAssetData(asset: AudioAssetDefinition, bytes: Uint8Array): void {
  audioAssetDefinitionSchema.parse(asset);
  const format = inspectAudioData(bytes);
  if (!asset.path.toLowerCase().endsWith(`.${format}`))
    throw new Error(`Audio format does not match path "${asset.path}". Reimport the original audio file.`);
}
