import { abortable } from './abortable.js';
import { inspectAudioData, validateAudioAssetData, type AudioAssetDefinition } from './AudioAsset.js';

export interface AudioPlayback {
  stop(): void;
  setVolume(volume: number): void;
}
export interface DecodedAudioResource {
  readonly durationSeconds: number;
  readonly byteLength: number;
  play(volume: number, ended: () => void): AudioPlayback;
  dispose(): void;
}
/** Injectable browser/backend boundary; no React or Phaser scene ownership. */
export interface AudioBackend {
  decode(bytes: Uint8Array<ArrayBuffer>): Promise<DecodedAudioResource>;
  resume(): Promise<void>;
  dispose(): void;
}
export interface AudioAssetSource {
  readonly definition: AudioAssetDefinition;
  readonly bytes: Uint8Array<ArrayBuffer>;
}
export const AUDIO_MAX_DECODED_BYTES = 128 * 1024 * 1024;
export const AUDIO_LOAD_TIMEOUT_MS = 60_000;

/** Minimal Web Audio adapter. Context creation and resume are lazy; importing never starts sound. */
export class WebAudioBackend implements AudioBackend {
  private context: AudioContext | undefined;
  private closed = false;
  private getContext(): AudioContext {
    if (this.closed) throw new Error('Audio backend is disposed.');
    if (typeof AudioContext === 'undefined')
      throw new Error('Web Audio is unavailable. Use a browser with Web Audio support.');
    return (this.context ??= new AudioContext());
  }
  async decode(bytes: Uint8Array<ArrayBuffer>): Promise<DecodedAudioResource> {
    const context = this.getContext();
    let buffer: AudioBuffer | undefined = await context.decodeAudioData(new Uint8Array(bytes).buffer);
    return {
      durationSeconds: buffer.duration,
      byteLength: buffer.length * buffer.numberOfChannels * 4,
      play: (volume, ended) => {
        if (!buffer || this.closed) throw new Error('Audio resource is disposed.');
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(context.destination);
        let stopped = false;
        const release = () => {
          if (stopped) return;
          stopped = true;
          source.onended = null;
          source.disconnect();
          gain.disconnect();
          source.buffer = null;
          ended();
        };
        source.onended = release;
        try {
          source.start();
        } catch (error) {
          release();
          throw error;
        }
        return {
          stop: () => {
            if (!stopped) {
              source.stop();
              release();
            }
          },
          setVolume: (value) => {
            gain.gain.value = value;
          },
        };
      },
      dispose: () => {
        buffer = undefined;
      },
    };
  }
  async resume(): Promise<void> {
    const context = this.getContext();
    await context.resume();
    if (context.state !== 'running')
      throw new Error('Audio is blocked. Allow sound in this browser, then click Play again.');
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = undefined;
  }
}

/** Registered-ID resolution, content cache and a single audition voice. Own one per host/session.
 * Equal encoded content shares one decode. Failed loads are retryable; disposal invalidates late work. */
export class AudioAssetLoader {
  private readonly backend: AudioBackend;
  private readonly lifetime = new AbortController();
  private cacheLifetime = new AbortController();
  private readonly cache = new Map<string, Promise<DecodedAudioResource>>();
  private readonly resources = new Set<DecodedAudioResource>();
  private decodedBytes = 0;
  private playback: AudioPlayback | undefined;
  private generation = 0;
  private cacheGeneration = 0;
  private volume = 0.7;
  constructor(
    private readonly resolve: (id: string) => AudioAssetSource | undefined,
    backend?: AudioBackend,
  ) {
    this.backend = backend ?? new WebAudioBackend();
  }
  async prepare(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<DecodedAudioResource> {
    const active = AbortSignal.any([this.lifetime.signal, this.cacheLifetime.signal, ...(signal ? [signal] : [])]);
    active.throwIfAborted();
    inspectAudioData(bytes);
    const requestedCacheGeneration = this.cacheGeneration;
    // Copy before asynchronous hashing/decoding: external mutations cannot poison the content cache.
    const owned = new Uint8Array(bytes);
    const digest = Array.from(new Uint8Array(await abortable(crypto.subtle.digest('SHA-256', owned), active)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    active.throwIfAborted();
    if (requestedCacheGeneration !== this.cacheGeneration) throw new Error('Audio loading was cancelled.');
    let pending = this.cache.get(digest);
    if (!pending) {
      const cacheGeneration = this.cacheGeneration;
      const deadline = AbortSignal.any([
        this.lifetime.signal,
        this.cacheLifetime.signal,
        AbortSignal.timeout(AUDIO_LOAD_TIMEOUT_MS),
      ]);
      const decoding = this.backend.decode(owned).then((resource) => {
        if (deadline.aborted) {
          resource.dispose();
          deadline.throwIfAborted();
        }
        if (cacheGeneration !== this.cacheGeneration) {
          resource.dispose();
          throw new Error('Audio loading was cancelled.');
        }
        if (
          !Number.isFinite(resource.durationSeconds) ||
          resource.durationSeconds <= 0 ||
          !Number.isFinite(resource.byteLength) ||
          resource.byteLength <= 0 ||
          this.decodedBytes + resource.byteLength > AUDIO_MAX_DECODED_BYTES
        ) {
          resource.dispose();
          throw new Error(
            'Decoded audio exceeds the 128 MiB audition budget or has invalid duration. Use shorter audio, or close and reopen the Audio section.',
          );
        }
        this.resources.add(resource);
        this.decodedBytes += resource.byteLength;
        return resource;
      });
      pending = abortable(decoding, deadline).catch((error: unknown) => {
        if (this.cache.get(digest) === pending) this.cache.delete(digest);
        throw new Error(
          `Audio could not decode: ${error instanceof Error ? error.message : String(error)}. Try a WAV (PCM), MP3 or OGG encoding supported by this browser.`,
          { cause: error },
        );
      });
      this.cache.set(digest, pending);
    }
    return abortable(pending, active);
  }
  async load(id: string, signal?: AbortSignal): Promise<DecodedAudioResource> {
    this.lifetime.signal.throwIfAborted();
    const source = this.resolve(id);
    if (!source) throw new Error(`Audio asset "${id}" is not registered or its binary is missing. Reimport the audio.`);
    if (source.definition.id !== id) throw new Error(`Audio asset "${id}" resolves to a different registered ID.`);
    validateAudioAssetData(source.definition, source.bytes);
    return this.prepare(source.bytes, signal);
  }
  /** Call directly from a user gesture so resume executes before the first asynchronous boundary. */
  async play(id: string, ended: () => void = () => {}): Promise<boolean> {
    this.stop();
    this.lifetime.signal.throwIfAborted();
    const generation = this.generation;
    const resumed = this.backend.resume();
    const [resource] = await Promise.all([
      this.load(id),
      abortable(resumed, AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(AUDIO_LOAD_TIMEOUT_MS)])),
    ]);
    if (generation !== this.generation || this.lifetime.signal.aborted) return false;
    this.playback = resource.play(this.volume, () => {
      if (generation !== this.generation) return;
      this.playback = undefined;
      ended();
    });
    return true;
  }
  setVolume(volume: number): void {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('Audio volume must be between 0 and 1.');
    this.volume = volume;
    this.playback?.setVolume(volume);
  }
  stop(): void {
    this.generation++;
    const playback = this.playback;
    this.playback = undefined;
    playback?.stop();
  }
  /** Release decoded memory while retaining the backend for a later audition. */
  clear(): void {
    this.stop();
    this.cacheLifetime.abort(new DOMException('Audio loading was cancelled.', 'AbortError'));
    this.cacheLifetime = new AbortController();
    this.cacheGeneration++;
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.cache.clear();
    this.decodedBytes = 0;
  }
  dispose(): void {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    this.clear();
    this.backend.dispose();
  }
}
