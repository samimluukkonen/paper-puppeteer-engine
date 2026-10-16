/** Base-channel playback options. Each queued request always starts a fresh instance. */
export interface QueueAnimationOptions {
  /** Crossfade duration in milliseconds; queued fades begin at completion. */
  fadeDuration?: number;
  /** Existing clip speed multiplier; zero explicitly holds playback. */
  speed?: number;
}

/** A registered clip name and owned options, never a copy of animation data. */
export interface AnimationQueueRequest {
  readonly name: string;
  readonly options?: Readonly<QueueAnimationOptions>;
}
