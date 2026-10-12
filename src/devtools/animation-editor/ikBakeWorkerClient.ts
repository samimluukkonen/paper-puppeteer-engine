import type { IKBakePlanningRequest, IKBakePlanningResult } from './ikBakePlanning.js';

export interface IKBakePlanningTask {
  readonly result: Promise<IKBakePlanningResult>;
  cancel(): void;
}
export type StartIKBakePlanning = (request: IKBakePlanningRequest) => IKBakePlanningTask;

/** Each request owns a worker, so cancellation stops computation as well as ignoring stale replies. */
export const startIKBakePlanning: StartIKBakePlanning = (request) => {
  const worker = new Worker(new URL('./ikBake.worker.ts', import.meta.url), { type: 'module' });
  let cancel = (): void => {};
  const result = new Promise<IKBakePlanningResult>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      complete();
    };
    cancel = () => finish(() => reject(new DOMException('Bake planning cancelled.', 'AbortError')));
    worker.onmessage = (event: MessageEvent<IKBakePlanningResult>) => finish(() => resolve(event.data));
    worker.onerror = (event) => {
      event.preventDefault();
      finish(() => reject(new Error(event.message || 'Could not prepare the bake.')));
    };
    worker.onmessageerror = () => finish(() => reject(new Error('Could not read the bake result.')));
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(() => reject(error));
    }
  });
  return { result, cancel: () => cancel() };
};
