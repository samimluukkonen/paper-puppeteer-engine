/** Renderer-independent lifecycle shared by scene runners and story session adapters. */
export type SceneRunnerStatus =
  | 'stopped'
  | 'playing'
  | 'waiting-for-dialogue-advance'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'disposed'
  | 'failed';

export type AdvanceResult = { readonly advanced: false } | { readonly advanced: true; readonly lineId: string };

export interface ScenePlayback {
  readonly status: SceneRunnerStatus;
  readonly error: unknown;
  play(): void;
  update(deltaMilliseconds: number): void;
  /** Optional for older host adapters; SceneRunner implements this command. */
  advanceDialogue?(): AdvanceResult;
}
