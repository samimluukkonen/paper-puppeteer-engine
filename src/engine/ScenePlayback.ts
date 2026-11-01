/** Renderer-independent lifecycle shared by scene runners and story session adapters. */
export type SceneRunnerStatus =
  | 'stopped'
  | 'playing'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'disposed'
  | 'failed';

export interface ScenePlayback {
  readonly status: SceneRunnerStatus;
  readonly error: unknown;
  play(): void;
  update(deltaMilliseconds: number): void;
}
