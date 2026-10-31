import { preflightIKBakeSelection } from '../../engine/ik/IKBakeBudget.js';
import { startWorkerTask } from '../shared/workerTask.js';
import type { IKBakePlanningRequest, IKBakePlanningResult } from './ikBakePlanning.js';

export interface IKBakePlanningTask {
  readonly result: Promise<IKBakePlanningResult>;
  cancel(): void;
}
export type StartIKBakePlanning = (request: IKBakePlanningRequest) => IKBakePlanningTask;

export const IK_BAKE_PLANNING_TIMEOUT_MS = 30_000;

/** Each request owns a worker, so cancellation stops computation as well as ignoring stale replies. */
export const startIKBakePlanning: StartIKBakePlanning = (request) => {
  try {
    preflightIKBakeSelection(request.animation.duration, request.fps, request.rig, request.constraintIds);
  } catch (error) {
    return {
      result: Promise.resolve({
        success: false,
        issues: [{ severity: 'error', message: error instanceof Error ? error.message : String(error) }],
      }),
      cancel() {},
    };
  }
  const worker = new Worker(new URL('./ikBake.worker.ts', import.meta.url), { type: 'module' });
  return startWorkerTask<IKBakePlanningResult>(worker, request, {
    errorMessage: 'Could not prepare the bake.',
    messageErrorMessage: 'Could not read the bake result.',
    cancelReason: new DOMException('Bake planning cancelled.', 'AbortError'),
    timeoutMs: IK_BAKE_PLANNING_TIMEOUT_MS,
    timeoutMessage: 'Bake planning timed out after 30 seconds. Lower the sampling FPS or select fewer constraints.',
  });
};
