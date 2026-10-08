import type { AnimationEditorState } from './AnimationEditorState.js';
import { toSeconds } from './timeUnits.js';

/** Read-only authored values. Use text nodes for event names and arbitrary JSON payloads. */
export class EventInspectorController {
  private event: AnimationEditorState['selectedEventData'];
  constructor(private readonly app: HTMLElement) {}

  render(state: AnimationEditorState): void {
    const event = state.selectedEventData;
    const panel = this.app.querySelector<HTMLElement>('#animation-event-inspector')!;
    panel.hidden = !event;
    if (event === this.event) return;
    this.event = event;
    this.app.querySelector<HTMLElement>('#animation-event-time')!.textContent = event
      ? `${toSeconds(event.time).toFixed(3)} s`
      : '';
    this.app.querySelector<HTMLElement>('#animation-event-name')!.textContent = event?.name ?? '';
    const data = this.app.querySelector<HTMLElement>('#animation-event-data')!;
    const payload = this.app.querySelector<HTMLElement>('#animation-event-payload')!;
    payload.hidden = !event || !Object.hasOwn(event, 'data');
    data.textContent = event && Object.hasOwn(event, 'data') ? JSON.stringify(event.data, null, 2) : '';
  }
}
