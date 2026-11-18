import { setAttribute } from '../../shared/domUpdates.js';
import { requireElement } from '../shared/editorElements.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { ANIMATION_IDS } from './elementIds.js';
import type { GraphKeyRef } from './graphEditor.js';
import { rootKeys } from './rootMotionEdits.js';
import { timeToTimelineX } from './timeline.js';

/** Controls that edit the selected root key, disabled until one is selected. */
const KEY_CONTROLS = new Set<string>([
  ANIMATION_IDS.rootKeyTime,
  ANIMATION_IDS.rootKeyValue,
  ANIMATION_IDS.rootApplyKey,
  ANIMATION_IDS.rootDeleteKey,
  ANIMATION_IDS.rootDuplicateKey,
]);

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
      button.addEventListener('click', () => this.state?.rootMotion.selectRootMotion(property ?? 'x'), {
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
    for (const [id, action] of [
      [ANIMATION_IDS.rootAddKey, () => this.state?.rootMotion.addRootPositionKey()],
      [ANIMATION_IDS.rootDeleteKey, () => this.state?.rootMotion.deleteRootKey()],
      [ANIMATION_IDS.rootDuplicateKey, () => this.state?.rootMotion.duplicateRootKey()],
    ] as const)
      requireElement(this.app, id, HTMLButtonElement).addEventListener('click', () => this.run(action), options);
    for (const [id, setting] of [
      [ANIMATION_IDS.rootEditMode, 'editing'],
      [ANIMATION_IDS.rootShowTrajectory, 'trajectory'],
    ] as const)
      requireElement(this.app, id, HTMLInputElement).addEventListener(
        'change',
        (event) => this.state?.rootMotion.setRootMotionView({ [setting]: (event.target as HTMLInputElement).checked }),
        options,
      );
    for (const id of [ANIMATION_IDS.rootDisplacementMode, ANIMATION_IDS.rootLoopMode])
      requireElement(this.app, id, HTMLSelectElement).addEventListener(
        'change',
        () => {
          const mode = requireElement(this.app, ANIMATION_IDS.rootDisplacementMode, HTMLSelectElement).value;
          const loop = requireElement(this.app, ANIMATION_IDS.rootLoopMode, HTMLSelectElement).value;
          if (
            (mode === 'authored' || mode === 'preview' || mode === 'none') &&
            (loop === 'reset' || loop === 'continuous')
          )
            this.state?.rootMotion.setWorldDisplacementView(mode, loop);
        },
        options,
      );
    requireElement(this.app, ANIMATION_IDS.rootPositionForm, HTMLFormElement).addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        this.run(() =>
          this.state?.rootMotion.setRootPosition({
            x: this.number(ANIMATION_IDS.rootX),
            y: this.number(ANIMATION_IDS.rootY),
          }),
        );
      },
      options,
    );
    requireElement(this.app, ANIMATION_IDS.rootKeyForm, HTMLFormElement).addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        const key = this.state?.rootMotion.selectedRootKey;
        if (key)
          this.run(() =>
            this.state?.graph.editGraphKey(
              { channel: { kind: 'root', id: 'Root Motion', property: key.property }, time: key.time },
              { time: this.number(ANIMATION_IDS.rootKeyTime), value: this.number(ANIMATION_IDS.rootKeyValue) },
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
    return requireElement(this.app, id, HTMLInputElement).valueAsNumber;
  }
  private run(action: () => unknown): unknown {
    const status = requireElement(this.app, ANIMATION_IDS.rootMotionStatus, HTMLElement);
    try {
      const result = action();
      status.textContent =
        result === false ? 'No change applied. Check the selected key and choose a time inside the clip.' : '';
      return result;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  private begin(event: PointerEvent, property: 'x' | 'y', time: number, marker: HTMLButtonElement): void {
    event.stopPropagation();
    if (event.button !== 0 || !this.state?.animationAuthoringEnabled) return;
    event.preventDefault();
    this.cancel();
    this.state.rootMotion.selectRootMotion(property, time);
    const ref = { channel: { kind: 'root', id: 'Root Motion', property }, time } as const;
    if (!this.state.graph.beginGraphEdit(ref)) return;
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
      time = Math.round(time * state.keyframes.keyframeFPS) / state.keyframes.keyframeFPS;
    time = Math.max(0, Math.min(state.duration, time));
    if (this.run(() => state.graph.previewGraphEdit({ time })))
      drag.marker.style.left = `${timeToTimelineX(time, state.duration, this.width)}px`;
  };
  private up = (event: PointerEvent): void => {
    if (event.pointerId !== this.drag?.pointer) return;
    this.move(event);
    this.release();
    this.run(() => this.state?.graph.commitGraphEdit());
  };
  private release(): void {
    const drag = this.drag;
    this.drag = undefined;
    if (drag?.marker.hasPointerCapture(drag.pointer)) drag.marker.releasePointerCapture(drag.pointer);
  }
  private cancel = (): void => {
    if (!this.drag) return;
    this.release();
    this.state?.graph.cancelGraphEdit();
  };
  render(state: AnimationEditorState, width: number): void {
    if (state !== this.state || this.session !== state.sessionRevision) {
      this.cancel();
      this.state = state;
      this.session = state.sessionRevision;
    }
    if (this.drag && (!state.graph.graphEditActive || width !== this.width)) this.cancel();
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
            if (!event.detail) this.state?.rootMotion.selectRootMotion(property, time);
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
      const selected =
        state.rootMotion.rootMotionSelected && (!property || state.rootMotion.rootMotionProperty === property);
      setAttribute(this.labels[index]!, 'data-selected', String(selected));
      setAttribute(this.labels[index]!.querySelector('button')!, 'aria-pressed', String(selected));
      if (property)
        for (const key of state.workingAnimation ? rootKeys(state.workingAnimation, property) : []) {
          const time = key.time / 1000;
          const marker = this.markers.get(`${property}:${time}`)!;
          const active =
            state.rootMotion.selectedRootKey?.property === property && state.rootMotion.selectedRootKey.time === time;
          marker.setAttribute('aria-pressed', String(active));
          marker.dataset.primary = String(active);
          if (this.drag?.marker !== marker) marker.style.left = `${timeToTimelineX(time, state.duration, width)}px`;
        }
    }
    if (restoreFocus) {
      const key = state.rootMotion.selectedRootKey;
      const marker = key ? this.markers.get(`${key.property}:${key.time}`) : undefined;
      (marker ?? requireElement(this.app, ANIMATION_IDS.timeline, HTMLElement)).focus({ preventScroll: true });
    }
    for (const [id, checked] of [
      [ANIMATION_IDS.rootEditMode, state.rootMotion.rootMotionEditing],
      [ANIMATION_IDS.rootShowTrajectory, state.rootMotion.rootTrajectoryVisible],
    ] as const)
      requireElement(this.app, id, HTMLInputElement).checked = checked;
    for (const [id, value] of [
      [ANIMATION_IDS.rootDisplacementMode, state.rootMotion.worldDisplacementMode],
      [ANIMATION_IDS.rootLoopMode, state.rootMotion.rootLoopMode],
    ] as const)
      requireElement(this.app, id, HTMLSelectElement).value = value;
    const values: Record<string, number | undefined> = {
      [ANIMATION_IDS.rootX]: state.rootMotion.rootPosition.x,
      [ANIMATION_IDS.rootY]: state.rootMotion.rootPosition.y,
      [ANIMATION_IDS.rootKeyTime]: state.rootMotion.selectedRootKey?.time,
      [ANIMATION_IDS.rootKeyValue]:
        state.rootMotion.selectedRootKey && state.workingAnimation
          ? rootKeys(state.workingAnimation, state.rootMotion.selectedRootKey.property).find(
              (key) => key.time / 1000 === state.rootMotion.selectedRootKey!.time,
            )?.value
          : undefined,
    };
    for (const [id, value] of Object.entries(values)) {
      const input = requireElement(this.app, id, HTMLInputElement);
      if (document.activeElement !== input) input.value = value === undefined ? '' : String(value);
    }
    requireElement(this.app, ANIMATION_IDS.rootMotionPanel, HTMLElement)
      .querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')
      .forEach((input) => {
        input.disabled =
          !state.workingAnimation ||
          !state.animationAuthoringEnabled ||
          (KEY_CONTROLS.has(input.id) && !state.rootMotion.selectedRootKey);
      });
  }
  dispose(): void {
    this.cancel();
    this.abort.abort();
    this.state = undefined;
    this.markers.clear();
  }
}
