import { flushSync } from 'react-dom';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { toSeconds } from './timeUnits.js';

/** Local text drafts commit once on blur/Enter; authored snapshots remain authoritative. */
export class EventInspectorController {
  private readonly abort = new AbortController();
  private event: AnimationEditorState['selectedEventData'];
  private ref: AnimationEditorState['selectedEvent'] | undefined;
  private readonly time: HTMLInputElement;
  private readonly name: HTMLInputElement;
  private readonly data: HTMLTextAreaElement;
  private readonly add: HTMLButtonElement;
  private readonly remove: HTMLButtonElement;
  private readonly error: HTMLElement;

  constructor(
    private readonly app: HTMLElement,
    private readonly getState: () => AnimationEditorState,
  ) {
    this.time = app.querySelector<HTMLInputElement>('#animation-event-time')!;
    this.name = app.querySelector<HTMLInputElement>('#animation-event-name')!;
    this.data = app.querySelector<HTMLTextAreaElement>('#animation-event-data')!;
    this.add = app.querySelector<HTMLButtonElement>('#timeline-add-event')!;
    this.remove = app.querySelector<HTMLButtonElement>('#animation-delete-event')!;
    this.error = app.querySelector<HTMLElement>('#animation-event-error')!;
    const options = { signal: this.abort.signal };
    this.add.addEventListener(
      'click',
      () => {
        // Commit tab visibility before focusing the newly created event field.
        const created = flushSync(() => this.getState().createAnimationEvent());
        if (created) {
          this.name.focus();
          this.name.select();
        }
      },
      options,
    );
    // Hold field focus until deletion clears its drafts; blur validation can move the button before mouseup.
    this.remove.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button === 0) event.preventDefault();
      },
      options,
    );
    this.remove.addEventListener(
      'click',
      () => {
        if (this.getState().deleteSelectedEvent()) this.add.focus({ preventScroll: true });
      },
      options,
    );
    for (const field of [this.time, this.name, this.data]) {
      field.addEventListener('focus', () => this.getState().pause(), options);
      field.addEventListener('blur', () => this.commit(field), options);
      field.addEventListener(
        'keydown',
        (inputEvent) => {
          const event = inputEvent as KeyboardEvent;
          if (event.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            this.reset(this.getState());
          } else if (event.key === 'Enter' && (field !== this.data || event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            this.commit(field);
          }
        },
        options,
      );
    }
  }

  private commit(field: HTMLInputElement | HTMLTextAreaElement): void {
    const state = this.getState();
    const ref = state.selectedEvent;
    const event = state.selectedEventData;
    // A field belonging to a replaced selection/session cannot author a different event.
    if (!event || !ref || ref !== this.ref) return;
    const ok =
      field === this.time
        ? state.moveSelectedEvent(field.value.trim() ? Number(field.value) : NaN)
        : field === this.name
          ? state.updateAnimationEvent(ref, { ...event, name: field.value })
          : state.setSelectedEventDataJson(field.value);
    this.error.textContent = ok ? '' : state.validationIssues.map(({ message }) => message).join('\n');
    if (ok) this.reset(state);
  }

  private reset(state: AnimationEditorState): void {
    const event = state.selectedEventData;
    this.time.value = event ? String(toSeconds(event.time)) : '';
    this.name.value = event?.name ?? '';
    this.data.value = event && Object.hasOwn(event, 'data') ? JSON.stringify(event.data, null, 2) : '';
    this.error.textContent = '';
  }

  render(state: AnimationEditorState): void {
    const event = state.selectedEventData;
    const eventPanel = this.app.querySelector<HTMLElement>('#animation-event-inspector')!;
    if (eventPanel.hidden !== !event) eventPanel.hidden = !event;
    this.add.disabled = !state.workingAnimation;
    this.remove.disabled = !event;
    this.time.max = String(state.duration);
    if (event === this.event && state.selectedEvent === this.ref) return;
    this.event = event;
    this.ref = state.selectedEvent;
    this.reset(state);
  }

  dispose(): void {
    this.abort.abort();
  }
}
