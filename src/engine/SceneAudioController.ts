import {
  AudioAssetLoader,
  type AudioAssetSource,
  type AudioBackend,
  type DecodedAudioResource,
  type TimelineAudioPlayback,
} from './AudioAssetLoader.js';
import type { DeepReadonly } from './readonlyData.js';
import { compileSceneAudio } from './sceneAudio.js';
import type { SceneDefinition } from './SceneDefinition.js';

/** Scene milliseconds; correction is limited to one restart per voice per 250 backend milliseconds. */
export const SCENE_AUDIO_DRIFT_TOLERANCE_MS = 80;
export const SCENE_AUDIO_CORRECTION_INTERVAL_MS = 250;
export type SceneAudioStatus = 'disabled' | 'locked' | 'loading' | 'ready' | 'error' | 'disposed';
export interface SceneAudioOptions {
  readonly resolve: (id: string) => AudioAssetSource | undefined;
  readonly backend?: AudioBackend;
}

/** One owner per scene. No timers and no React/Phaser imports. Only sync() starts voices;
 * unlock() must be called from a user gesture. The host's scene clock is authoritative.
 */
export class SceneAudioController {
  private readonly loader: AudioAssetLoader;
  private scene: DeepReadonly<SceneDefinition>;
  private compiled: ReturnType<typeof compileSceneAudio>;
  private readonly resources = new Map<string, DecodedAudioResource>();
  private readonly durations = new Map<string, number>();
  private readonly voices = new Map<
    string,
    { playback: TimelineAudioPlayback; elapsed: number; rate: number; signature: string }
  >();
  private generation = 0;
  private state: SceneAudioStatus;
  private message = '';
  private silenced = false;
  constructor(scene: DeepReadonly<SceneDefinition>, options: SceneAudioOptions) {
    this.scene = scene;
    this.compiled = compileSceneAudio(scene);
    this.loader = new AudioAssetLoader(options.resolve, options.backend);
    this.state = scene.audioClips?.length ? 'locked' : 'disabled';
  }
  get status(): SceneAudioStatus {
    return this.state === 'ready' && !this.loader.running ? 'locked' : this.state;
  }
  get error(): string {
    return this.message;
  }
  get muted(): boolean {
    return this.silenced;
  }
  set muted(value: boolean) {
    this.silenced = value;
    if (value) this.stop();
  }
  /** Audio-only edits retain the visual runner's Actors and clock. Invalidate decoded IDs
   * when their registrations change; content reuse stays owned by AudioAssetLoader.
   */
  setScene(scene: DeepReadonly<SceneDefinition>): void {
    if (this.state === 'disposed') return;
    const changed = JSON.stringify(this.scene.audioClips) !== JSON.stringify(scene.audioClips);
    if (changed) {
      this.generation++;
      if (this.state === 'loading') this.state = 'locked';
    }
    if (JSON.stringify(this.scene.audioAssets) !== JSON.stringify(scene.audioAssets)) {
      this.generation++;
      this.stop();
      this.resources.clear();
      this.durations.clear();
      this.loader.clear();
      this.state = 'locked';
    }
    this.scene = scene;
    this.compiled = compileSceneAudio(scene);
    if (!scene.audioClips?.length) {
      this.stop();
      this.state = 'disabled';
      this.message = '';
    } else if ([...new Set(scene.audioClips.map((clip) => clip.assetId))].some((id) => !this.resources.has(id)))
      this.state = 'locked';
    else if (this.state === 'disabled') this.state = this.loader.running ? 'ready' : 'locked';
    if (changed && this.state === 'ready') {
      try {
        for (const [id, resource] of this.resources) this.validateResource(id, resource);
      } catch (error) {
        this.fail(error);
      }
    }
  }
  private validateResource(id: string, resource: DecodedAudioResource): void {
    for (const clip of this.scene.audioClips ?? []) {
      if (clip.assetId !== id) continue;
      const end = resource.durationSeconds * 1000;
      if (clip.sourceOffset >= end || (!clip.loop && clip.sourceOffset + clip.duration > end + 1))
        throw new Error(
          `Audio clip "${clip.id}" exceeds decoded media duration. Adjust its source offset or duration.`,
        );
    }
  }
  /** Call directly from Play/Enable audio. Decoding alone never unlocks playback. */
  async unlock(): Promise<void> {
    if (this.state === 'disposed') throw new Error('Scene audio is disposed.');
    if (!this.scene.audioClips?.length) return;
    const generation = ++this.generation;
    this.state = 'loading';
    this.message = '';
    try {
      const resumed = this.loader.unlock();
      await Promise.all([
        resumed,
        (async () => {
          for (const id of new Set(this.scene.audioClips?.map((clip) => clip.assetId))) {
            const resource = await this.loader.load(id);
            if (generation !== this.generation) return;
            if (!resource.playTimeline)
              throw new Error('This audio backend supports audition only. Use a timeline-capable audio backend.');
            this.validateResource(id, resource);
            this.resources.set(id, resource);
            this.durations.set(id, resource.durationSeconds * 1000);
          }
        })(),
      ]);
      if (generation === this.generation) this.state = 'ready';
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error);
      throw error;
    }
  }
  /** Reconcile once per host scene update/transport command. Passive seeking passes playing:false.
   * Missed intervals are never replayed. Position drift is measured unwrapped through loops.
   * A supplied hold elapsed value exclusively selects dedicated hold-only voices, even with playing:false.
   */
  sync(time: number, playing: boolean, speed: number, holdElapsedTime?: number): void {
    if ((!playing && holdElapsedTime === undefined) || this.silenced || this.state !== 'ready') {
      this.stop();
      return;
    }
    if (!this.loader.running) {
      this.fail(new Error('Audio is blocked or suspended. Click Enable audio to resume.'));
      return;
    }
    try {
      if (!Number.isFinite(speed) || speed <= 0) throw new Error('Audio playback speed must be positive and finite.');
      const active =
        holdElapsedTime === undefined
          ? this.compiled.sample(time, this.durations)
          : this.compiled.sampleHold(time, holdElapsedTime, this.durations);
      const ids = new Set(active.map(({ clip }) => clip.id));
      for (const [id, voice] of this.voices)
        if (!ids.has(id)) {
          voice.playback.stop();
          this.voices.delete(id);
        }
      for (const sample of active) {
        const { clip } = sample;
        const signature = this.compiled.signature(clip.id);
        let voice = this.voices.get(clip.id);
        if (voice) {
          const consumed = voice.playback.elapsed * 1000;
          const drift = Math.abs(voice.elapsed + consumed - sample.elapsed);
          if (
            voice.rate !== speed ||
            voice.signature !== signature ||
            ((voice.playback.ended || drift > SCENE_AUDIO_DRIFT_TOLERANCE_MS) &&
              consumed / voice.rate >= SCENE_AUDIO_CORRECTION_INTERVAL_MS)
          ) {
            voice.playback.stop();
            this.voices.delete(clip.id);
            voice = undefined;
          }
        }
        if (voice) continue;
        const resource = this.resources.get(clip.assetId);
        if (!resource?.playTimeline) throw new Error('Audio assets changed. Click Enable audio to load them.');
        const playback = resource.playTimeline({
          offset: sample.sourcePosition / 1000,
          remaining: sample.remaining / 1000,
          rate: speed,
          volume: clip.volume,
          loop: clip.loop,
          loopStart: clip.sourceOffset / 1000,
          loopEnd: resource.durationSeconds,
          elapsed: sample.elapsed / 1000,
          duration: holdElapsedTime === undefined ? clip.duration / 1000 : Infinity,
          fadeIn: holdElapsedTime === undefined ? (clip.fadeIn ?? 0) / 1000 : 0,
          fadeOut: holdElapsedTime === undefined ? (clip.fadeOut ?? 0) / 1000 : 0,
        });
        this.voices.set(clip.id, { playback, elapsed: sample.elapsed, rate: speed, signature });
      }
    } catch (error) {
      this.fail(error);
    }
  }
  private fail(error: unknown): void {
    this.state = 'error';
    this.message = error instanceof Error ? error.message : String(error);
    this.stop();
  }
  stop(): void {
    const voices = [...this.voices.values()];
    this.voices.clear();
    const errors: unknown[] = [];
    for (const voice of voices) {
      try {
        voice.playback.stop();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Scene audio cleanup failed.');
  }
  dispose(): void {
    if (this.state === 'disposed') return;
    this.generation++;
    this.state = 'disposed';
    try {
      this.stop();
    } finally {
      this.resources.clear();
      this.durations.clear();
      this.loader.dispose();
    }
  }
}
