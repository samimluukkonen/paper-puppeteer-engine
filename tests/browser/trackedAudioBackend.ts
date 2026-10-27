import { WebAudioBackend, type AudioBackend, type TimelineAudioPlayback } from '../../src/engine/AudioAssetLoader.js';

/** Test/profile instrumentation around real browser decoding and Web Audio nodes. */
export function trackedAudioBackend() {
  const backend = new WebAudioBackend();
  const voices = new Set<TimelineAudioPlayback>();
  const stats = { starts: 0, stops: 0, decodedBytes: 0, disposedBytes: 0, contextsClosed: 0, peakVoices: 0 };
  const tracked: AudioBackend = {
    get running() {
      return backend.running;
    },
    resume: () => backend.resume(),
    decode: async (bytes) => {
      const resource = await backend.decode(bytes);
      stats.decodedBytes += resource.byteLength;
      return {
        ...resource,
        playTimeline: (options) => {
          const voice = resource.playTimeline!(options);
          voices.add(voice);
          stats.starts++;
          stats.peakVoices = Math.max(stats.peakVoices, voices.size);
          return {
            get elapsed() {
              return voice.elapsed;
            },
            get ended() {
              return voice.ended;
            },
            setVolume: (volume) => voice.setVolume(volume),
            stop: () => {
              if (voices.delete(voice)) {
                stats.stops++;
                voice.stop();
              }
            },
          };
        },
        dispose: () => {
          stats.disposedBytes += resource.byteLength;
          resource.dispose();
        },
      };
    },
    dispose: () => {
      stats.contextsClosed++;
      backend.dispose();
    },
  };
  return {
    backend: tracked,
    stats,
    get remainingVoices() {
      return voices.size;
    },
  };
}

/** Silent PCM; valid media with real decoding/retention costs and no audible profile noise. */
export function silentWav(seconds: number) {
  const rate = 22050;
  const bytes = new Uint8Array(44 + rate * seconds * 2);
  const view = new DataView(bytes.buffer);
  const label = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  label(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, bytes.length - 44, true);
  return bytes;
}
