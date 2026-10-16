/** Monotonically increasing identity, local to one AnimationPlayer; never an animation name. */
export type PlaybackInstanceId = number;

export type PlaybackOutcome = 'completed' | 'interrupted' | 'stopped' | 'disposed';
export type PlaybackState = 'playing' | 'paused' | PlaybackOutcome;

/** Detached snapshot of a selected layer's playback. All times are milliseconds. */
export interface PlaybackStatus {
  readonly playbackId: PlaybackInstanceId;
  readonly clip: string;
  readonly layer: string;
  readonly status: PlaybackState;
  readonly elapsedTime: number;
  readonly duration: number;
  readonly loop: boolean;
}

export type PlaybackLifecycleEvent = PlaybackStatus & {
  readonly type: 'started' | 'paused' | 'resumed' | PlaybackOutcome;
};
