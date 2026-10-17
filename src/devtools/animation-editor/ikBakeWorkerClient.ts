import { startWorkerTask } from '../shared/workerTask.js';
import type { IKBakePlanningRequest, IKBakePlanningResult } from './ikBakePlanning.js';

export interface IKBakePlanningTask {
  readonly result: Promise<IKBakePlanningResult>;
  cancel(): void;
}
export type StartIKBakePlanning = (request: IKBakePlanningRequest) => IKBakePlanningTask;

/** Each request owns a worker, so cancellation stops computation as well as ignoring stale replies. */
export const startIKBakePlanning: StartIKBakePlanning = (request) => {
  const worker = new Worker(new URL('./ikBake.worker.ts', import.meta.url), { type: 'module' });
  return startWorkerTask<IKBakePlanningResult>(worker, request, {
    errorMessage: 'Could not prepare the bake.',
    messageErrorMessage: 'Could not read the bake result.',
    cancelReason: new DOMException('Bake planning cancelled.', 'AbortError'),
  });
};
