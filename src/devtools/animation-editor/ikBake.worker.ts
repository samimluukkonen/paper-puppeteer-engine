import { planIKBake, type IKBakePlanningRequest, type IKBakePlanningResult } from './ikBakePlanning.js';

// A dedicated module worker receives only the editor's owned JSON snapshot.
const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<IKBakePlanningRequest>) => void) | null;
  postMessage(result: IKBakePlanningResult): void;
};
worker.onmessage = (event) => {
  try {
    worker.postMessage(planIKBake(event.data));
  } catch (error) {
    worker.postMessage({
      success: false,
      issues: [{ severity: 'error', message: error instanceof Error ? error.message : String(error) }],
    });
  }
};
