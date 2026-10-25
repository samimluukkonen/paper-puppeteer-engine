import type { AnimationEditorState } from './AnimationEditorState.js';
import type { GraphKeyRef } from './graphEditor.js';
import { rootKeys } from './rootMotionEdits.js';
import { timeToTimelineX } from './timeline.js';

/** DOM adapter for root rows and the collapsed inspector; all authored changes use session commands. */
export class RootMotionController {
  readonly labels: HTMLElement[] = [];
  readonly lanes: HTMLElement[] = [];
  private readonly abort = new AbortController();
  private state: AnimationEditorState | undefined;
  private width = 1;
  private document: unknown;
  private renderedState: AnimationEditorState | undefined;
  private session = -1;
  private drag:
    | { pointer: number; startX: number; ref: GraphKeyRef; marker: HTMLButtonElement; moved: boolean }
    | undefined;
  private readonly markers = new Map<string, HTMLButtonElement>();
  constructor(private readonly app: HTMLElement) {
    for (const property of [null, 'x', 'y'] as const) {
      const label = document.createElement('div');
      label.className = 'timeline-track-label timeline-root-track';
      const lane = document.createElement('div');
      lane.className = 'timeline-track-lane timeline-root-track';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'timeline-track-select';
      button.textContent = property === null ? 'Root Motion' : `Position ${property.toUpperCase()}`;
      button.setAttribute('aria-label', `Select root motion${property ? ' position ' + property.toUpperCase() : ''}`);
      button.addEventListener('click', () => this.state?.selectRootMotion(property ?? 'x'), {
        signal: this.abort.signal,
      });
      if (property) {
        label.style.paddingLeft = '16px';
        lane.dataset.rootProperty = property;
      }
      label.append(button);
      this.labels.push(label);
      this.lanes.push(lane);
    }
    const options = { signal: this.abort.signal };
    this.app
      .querySelector('#root-add-key')
      ?.addEventListener('click', () => this.run(() => this.state?.addRootPositionKey()), options);
    this.app
      .querySelector('#root-delete-key')
      ?.addEventListener('click', () => this.run(() => this.state?.deleteRootKey()), options);
    this.app
      .querySelector('#root-duplicate-key')
      ?.addEventListener('click', () => this.run(() => this.state?.duplicateRootKey()), options);
    for (const [id, setting] of [
      ['root-edit-mode', 'editing'],
      ['root-show-trajectory', 'trajectory'],
    ] as const)
      this.app
        .querySelector<HTMLInputElement>(`#${id}`)
        ?.addEventListener(
          'change',
          (event) => this.state?.setRootMotionView({ [setting]: (event.target as HTMLInputElement).checked }),
          options,
        );
    for (const id of ['root-displacement-mode', 'root-loop-mode'])
      this.app.querySelector<HTMLSelectElement>(`#${id}`)?.addEventListener(
        'change',
        () => {
          const mode = this.app.querySelector<HTMLSelectElement>('#root-displacement-mode')!.value;
          const loop = this.app.querySelector<HTMLSelectElement>('#root-loop-mode')!.value;
          if (
            (mode === 'authored' || mode === 'preview' || mode === 'none') &&
            (loop === 'reset' || loop === 'continuous')
          )
            this.state?.setWorldDisplacementView(mode, loop);
        },
        options,
      );
    this.app.querySelector('#root-position-form')?.addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        this.run(() => this.state?.setRootPosition({ x: this.number('root-x'), y: this.number('root-y') }));
      },
      options,
    );
    this.app.querySelector('#root-key-form')?.addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        const key = this.state?.selectedRootKey;
        if (key)
          this.run(() =>
            this.state?.editGraphKey(
              { channel: { kind: 'root', id: 'Root Motion', property: key.property }, time: key.time },
              { time: this.number('root-key-time'), value: this.number('root-key-value') },
            ),
          );
      },
      options,
    );
    window.addEventListener('pointermove', this.move, options);
    window.addEventListener('pointerup', this.up, options);
    window.addEventListener('pointercancel', this.cancel, options);
    window.addEventListener('blur', this.cancel, options);
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && this.drag) {
          event.preventDefault();
          event.stopPropagation();
          this.cancel();
        }
      },
      { ...options, capture: true },
    );
  }
  private number(id: string): number {
    return this.app.querySelector<HTMLInputElement>(`#${id}`)!.valueAsNumber;
  }
  private run(action: () => unknown): unknown {
    const status = this.app.querySelector('#root-motion-status');
    try {
      const result = action();
      if (status)
        status.textContent =
          result === false ? 'No change applied. Check the selected key and choose a time inside the clip.' : '';
      return result;
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  private begin(event: PointerEvent, property: 'x' | 'y', time: number, marker: HTMLButtonElement): void {
    event.stopPropagation();
    if (event.button !== 0 || !this.state?.animationAuthoringEnabled) return;
    event.preventDefault();
    this.cancel();
    this.state.selectRootMotion(property, time);
    const ref = { channel: { kind: 'root', id: 'Root Motion', property }, time } as const;
    if (!this.state.beginGraphEdit(ref)) return;
    this.drag = { pointer: event.pointerId, startX: event.clientX, ref, marker, moved: false };
    marker.focus();
    marker.setPointerCapture(event.pointerId);
  }
  private move = (event: PointerEvent): void => {
    const drag = this.drag;
    const state = this.state;
    if (!drag || !state || event.pointerId !== drag.pointer) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 3) return;
    drag.moved = true;
    let time = drag.ref.time + ((event.clientX - drag.startX) / this.width) * state.duration;
    if (!event.shiftKey && state.timelineSnapSettings.enabled && state.timelineSnapSettings.frames)
      time = Math.round(time * state.keyframeFPS) / state.keyframeFPS;
    time = Math.max(0, Math.min(state.duration, time));
    if (this.run(() => state.previewGraphEdit({ time })))
      drag.marker.style.left = `${timeToTimelineX(time, state.duration, this.width)}px`;
  };
  private up = (event: PointerEvent): void => {
    if (event.pointerId !== this.drag?.pointer) return;
    this.move(event);
    this.release();
    this.run(() => this.state?.commitGraphEdit());
  };
  private release(): void {
    const drag = this.drag;
    this.drag = undefined;
    if (drag?.marker.hasPointerCapture(drag.pointer)) drag.marker.releasePointerCapture(drag.pointer);
  }
  private cancel = (): void => {
    if (!this.drag) return;
    this.release();
    this.state?.cancelGraphEdit();
  };
  render(state: AnimationEditorState, width: number): void {
    if (state !== this.state || this.session !== state.sessionRevision) {
      this.cancel();
      this.state = state;
      this.session = state.sessionRevision;
    }
    if (this.drag && (!state.graphEditActive || width !== this.width)) this.cancel();
    const changed = this.document !== state.workingAnimation || this.renderedState !== state;
    const restoreFocus = changed && [...this.markers.values()].some((marker) => marker === document.activeElement);
    this.document = state.workingAnimation;
    this.renderedState = state;
    this.width = width;
    for (const row of [...this.labels, ...this.lanes]) row.hidden = !state.workingAnimation;
    if (changed) {
      this.markers.clear();
      for (const [index, property] of (['x', 'y'] as const).entries()) {
        const lane = this.lanes[index + 1]!;
        lane.replaceChildren();
        for (const key of state.workingAnimation ? rootKeys(state.workingAnimation, property) : []) {
          const time = key.time / 1000;
          const marker = document.createElement('button');
          marker.type = 'button';
          marker.className = 'timeline-keyframe';
          marker.dataset.time = String(time);
          marker.dataset.interpolation = key.curve?.mode ?? 'linear';
          marker.title = `Root Motion ${property.toUpperCase()} at ${time} s: ${key.value}. Interpolation: ${key.curve?.mode ?? 'linear'}`;
          marker.setAttribute('aria-label', `Select Root Motion ${property} key at ${time} s`);
          marker.addEventListener('pointerdown', (event) => this.begin(event, property, time, marker));
          marker.addEventListener('click', (event) => {
            if (!event.detail) this.state?.selectRootMotion(property, time);
          });
          marker.addEventListener('lostpointercapture', () => {
            if (this.drag?.marker === marker) this.cancel();
          });
          lane.append(marker);
          this.markers.set(`${property}:${time}`, marker);
        }
      }
    }
    for (const [index, property] of ([null, 'x', 'y'] as const).entries()) {
      const selected = state.rootMotionSelected && (!property || state.rootMotionProperty === property);
      this.labels[index]!.dataset.selected = String(selected);
      this.labels[index]!.querySelector('button')!.setAttribute('aria-pressed', String(selected));
      if (property)
        for (const key of state.workingAnimation ? rootKeys(state.workingAnimation, property) : []) {
          const time = key.time / 1000;
          const marker = this.markers.get(`${property}:${time}`)!;
          const active = state.selectedRootKey?.property === property && state.selectedRootKey.time === time;
          marker.setAttribute('aria-pressed', String(active));
          marker.dataset.primary = String(active);
          if (this.drag?.marker !== marker) marker.style.left = `${timeToTimelineX(time, state.duration, width)}px`;
        }
    }
    if (restoreFocus) {
      const key = state.selectedRootKey;
      const marker = key ? this.markers.get(`${key.property}:${key.time}`) : undefined;
      (marker ?? this.app.querySelector<HTMLElement>('#timeline'))?.focus({ preventScroll: true });
    }
    for (const [id, checked] of [
      ['root-edit-mode', state.rootMotionEditing],
      ['root-show-trajectory', state.rootTrajectoryVisible],
    ] as const) {
      const input = this.app.querySelector<HTMLInputElement>(`#${id}`);
      if (input) input.checked = checked;
    }
    for (const [id, value] of [
      ['root-displacement-mode', state.worldDisplacementMode],
      ['root-loop-mode', state.rootLoopMode],
    ] as const) {
      const select = this.app.querySelector<HTMLSelectElement>(`#${id}`);
      if (select) select.value = value;
    }
    const values: Record<string, number | undefined> = {
      'root-x': state.rootPosition.x,
      'root-y': state.rootPosition.y,
      'root-key-time': state.selectedRootKey?.time,
      'root-key-value':
        state.selectedRootKey && state.workingAnimation
          ? rootKeys(state.workingAnimation, state.selectedRootKey.property).find(
              (key) => key.time / 1000 === state.selectedRootKey!.time,
            )?.value
          : undefined,
    };
    for (const [id, value] of Object.entries(values)) {
      const input = this.app.querySelector<HTMLInputElement>(`#${id}`);
      if (input && document.activeElement !== input) input.value = value === undefined ? '' : String(value);
    }
    this.app
      .querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
        '#root-motion-panel input, #root-motion-panel button, #root-motion-panel select',
      )
      .forEach((input) => {
        input.disabled =
          !state.workingAnimation ||
          !state.animationAuthoringEnabled ||
          (['root-key-time', 'root-key-value', 'root-apply-key', 'root-delete-key', 'root-duplicate-key'].includes(
            input.id,
          ) &&
            !state.selectedRootKey);
      });
  }
  dispose(): void {
    this.cancel();
    this.abort.abort();
    this.state = undefined;
    this.markers.clear();
  }
}
