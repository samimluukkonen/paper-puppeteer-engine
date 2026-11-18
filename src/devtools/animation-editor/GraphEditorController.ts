import type { PropertyKeyframe, PropertyCurve } from '../../engine/data.js';
import { setText } from '../../shared/domUpdates.js';
import { blocksEditorShortcut, isTypingTarget } from '../../shared/keyboardShortcuts.js';
import { requireElement } from '../shared/editorElements.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { ANIMATION_IDS } from './elementIds.js';
import {
  constrainGraphHandle,
  DEFAULT_GRAPH_CURVE,
  fitGraph,
  graphChannels,
  graphDisplayKeys,
  graphDisplayValue,
  graphKeys,
  graphLocalValue,
  graphPropertyLabels,
  graphToPoint,
  panGraph,
  pointToGraph,
  sampleGraph,
  selectedGraphChannel,
  zoomGraph,
  type GraphChannel,
  type GraphKeyEdit,
  type GraphKeyRef,
  type GraphViewport,
} from './graphEditor.js';
import { snapKeyframeTime } from './timeline.js';
import { toSeconds } from './timeUnits.js';

const ns = 'http://www.w3.org/2000/svg';
const svgElement = (name: string, attributes: Record<string, string | number> = {}, text?: string): SVGElement => {
  const element = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
};
const labelNumber = (value: number) => Number(value.toPrecision(5)).toString();
type Drag = { readonly pointer: number; readonly x: number; readonly y: number; readonly view: GraphViewport } & (
  | { readonly kind: 'pan' }
  | { readonly kind: 'scrub' }
  | {
      readonly kind: 'key' | 'control1' | 'control2';
      readonly ref: GraphKeyRef;
      readonly index: number;
      readonly keys: readonly PropertyKeyframe[];
      readonly raw: number;
    }
);

export class GraphEditorController {
  private readonly abort = new AbortController();
  private readonly resize: ResizeObserver;
  private readonly panel: HTMLElement;
  private readonly canvas: SVGSVGElement;
  private readonly drawing: SVGGElement;
  private readonly playhead: SVGLineElement;
  private readonly property: HTMLSelectElement;
  private readonly toggle: HTMLButtonElement;
  private readonly timelinePanel: HTMLElement;
  private active = false;
  private view: GraphViewport | undefined;
  private context = '';
  private session = -1;
  private owner: AnimationEditorState | undefined;
  private rendered: readonly unknown[] = [];
  private drag: Drag | undefined;
  private width = 640;
  private height = 220;
  private message = '';

  constructor(
    private readonly app: HTMLElement,
    private readonly getState: () => AnimationEditorState,
  ) {
    this.panel = requireElement(this.app, ANIMATION_IDS.graphEditor, HTMLElement);
    this.canvas = requireElement(this.app, ANIMATION_IDS.graphCanvas, SVGSVGElement);
    this.drawing = requireElement(this.app, ANIMATION_IDS.graphDrawing, SVGGElement);
    this.playhead = requireElement(this.app, ANIMATION_IDS.graphPlayhead, SVGLineElement);
    this.property = requireElement(this.app, ANIMATION_IDS.graphProperty, HTMLSelectElement);
    this.toggle = requireElement(this.app, ANIMATION_IDS.graphToggle, HTMLButtonElement);
    this.timelinePanel = this.element('.timeline-panel');
    const options = { signal: this.abort.signal };
    this.toggle.addEventListener('click', () => this.setActive(!this.active), options);
    this.property.addEventListener(
      'change',
      () => {
        this.cancelGesture();
        const state = this.getState();
        const channel = graphChannels(state).find((entry) => entry.property === this.property.value);
        if (channel?.kind === 'root') state.selectRootMotion(channel.property);
        else if (channel?.kind === 'bone') state.selectTimelineProperty(channel.id, channel.property);
        else if (channel) state.ik.selectIKConstraint(channel.id, channel.property);
      },
      options,
    );
    requireElement(this.app, ANIMATION_IDS.graphFit, HTMLElement).addEventListener('click', () => this.fit(), options);
    requireElement(this.app, ANIMATION_IDS.graphZoomIn, HTMLElement).addEventListener(
      'click',
      () => this.zoom(0.5),
      options,
    );
    requireElement(this.app, ANIMATION_IDS.graphZoomOut, HTMLElement).addEventListener(
      'click',
      () => this.zoom(2),
      options,
    );
    requireElement(this.app, ANIMATION_IDS.graphKeyForm, HTMLElement).addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        this.edit({
          time: this.number(ANIMATION_IDS.graphKeyTime),
          value: graphLocalValue(this.channel()!, this.number(ANIMATION_IDS.graphKeyValue)),
        });
      },
      options,
    );
    requireElement(this.app, ANIMATION_IDS.graphInterpolation, HTMLSelectElement).addEventListener(
      'change',
      (event) => {
        const mode = (event.target as HTMLSelectElement).value;
        const curve: PropertyCurve | null =
          mode === 'auto'
            ? null
            : mode === 'bezier'
              ? DEFAULT_GRAPH_CURVE
              : { mode: mode === 'stepped' ? 'stepped' : 'linear' };
        this.edit({ curve });
      },
      options,
    );
    requireElement(this.app, ANIMATION_IDS.graphResetHandles, HTMLElement).addEventListener(
      'click',
      () => this.edit({ curve: DEFAULT_GRAPH_CURVE }),
      options,
    );
    requireElement(this.app, ANIMATION_IDS.graphHandleForm, HTMLElement).addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        this.edit({
          curve: {
            mode: 'bezier',
            control1: { x: this.number(ANIMATION_IDS.graphControl1X), y: this.number(ANIMATION_IDS.graphControl1Y) },
            control2: { x: this.number(ANIMATION_IDS.graphControl2X), y: this.number(ANIMATION_IDS.graphControl2Y) },
          },
        });
      },
      options,
    );
    this.canvas.addEventListener('pointerdown', (event) => this.begin(event), options);
    this.canvas.addEventListener('pointermove', (event) => this.move(event), options);
    this.canvas.addEventListener(
      'pointerup',
      (event) => {
        if (event.pointerId === this.drag?.pointer) this.end();
      },
      options,
    );
    for (const name of ['pointercancel', 'lostpointercapture'] as const)
      this.canvas.addEventListener(name, () => this.cancelGesture(), options);
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        if (this.drag) return;
        const point = this.pointer(event.clientX, event.clientY);
        this.zoom(event.deltaY > 0 ? 1.2 : 1 / 1.2, point.x, point.y);
      },
      { ...options, passive: false },
    );
    this.canvas.addEventListener('keydown', (event) => this.keydown(event), options);
    // Capture Escape during a pointer gesture even if focus moved into a field.
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && this.drag && !document.querySelector('dialog[open], .guide-spotlight')) {
          event.preventDefault();
          event.stopPropagation();
          this.cancelGesture();
        }
      },
      { ...options, capture: true },
    );
    window.addEventListener('blur', () => this.cancelGesture(), options);
    this.resize = new ResizeObserver(() => {
      if (this.active) {
        const width = this.width;
        const height = this.height;
        this.measure();
        if (width !== this.width || height !== this.height) this.cancelGesture();
        this.rendered = [];
        this.render();
      }
    });
    this.resize.observe(this.canvas);
  }
  private element<T extends Element = HTMLElement>(selector: string): T {
    const element = this.app.querySelector<T>(selector);
    if (!element) throw new Error(`Missing graph editor element ${selector}.`);
    return element;
  }
  private number(id: string): number {
    return requireElement(this.app, id, HTMLInputElement).valueAsNumber;
  }
  private channel(): GraphChannel | undefined {
    return selectedGraphChannel(this.getState());
  }
  private selectedTime(channel: GraphChannel): number | undefined {
    const state = this.getState();
    if (channel.kind === 'root')
      return state.selectedRootKey?.property === channel.property ? state.selectedRootKey.time : undefined;
    if (channel.kind === 'ik') {
      const key = state.ik.selectedIKKeyframe;
      return key?.constraintId === channel.id && key.property === channel.property ? key.time : undefined;
    }
    const key = state.selectedKeyframe;
    return key?.boneId === channel.id && key.property === channel.property ? key.time : undefined;
  }
  private ref(): GraphKeyRef | undefined {
    const channel = this.channel();
    const time = channel ? this.selectedTime(channel) : undefined;
    return channel && time !== undefined ? { channel, time } : undefined;
  }
  private setActive(active: boolean): void {
    this.cancelGesture();
    this.revealView(active);
  }
  /** Guide preparation changes only the visible view, preserving authored and provisional state. */
  revealView(active: boolean): void {
    this.active = active;
    this.panel.hidden = !active;
    this.timelinePanel.classList.toggle('graph-active', active);
    this.toggle.setAttribute('aria-pressed', String(active));
    const toggleLabel = active ? 'Show Timeline' : 'Show Graph';
    this.toggle.setAttribute('aria-label', toggleLabel);
    this.toggle.title = toggleLabel;
    this.measure();
    this.rendered = [];
    this.render();
  }
  private measure(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width - 80);
    this.height = Math.max(1, rect.height - 44);
  }
  private pointer(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left - 64, y: clientY - rect.top - 16 };
  }
  private fit(): void {
    this.cancelGesture();
    const animation = this.getState().workingAnimation;
    const channel = this.channel();
    if (animation && channel) this.view = fitGraph(animation, channel);
    this.rendered = [];
    this.render();
  }
  private zoom(factor: number, x = this.width / 2, y = this.height / 2): void {
    if (!this.view) return;
    const anchor = pointToGraph(x, y, this.view, this.width, this.height);
    const next = zoomGraph(this.view, factor, anchor.time, anchor.value);
    // Bound repeated zoom to useful finite ranges.
    if (
      !(next.end > next.start) ||
      next.end - next.start > 1e9 ||
      !(next.max > next.min) ||
      !Object.values(next).every(Number.isFinite)
    )
      return;
    this.view = next;
    this.rendered = [];
    this.render();
  }
  private edit(edit: GraphKeyEdit): void {
    const ref = this.ref();
    if (!ref) return;
    this.run(() => this.getState().editGraphKey(ref, edit));
    this.rendered = [];
    this.render();
  }
  private run(action: () => unknown): void {
    this.message = '';
    try {
      action();
    } catch (error) {
      this.message = error instanceof Error ? error.message : String(error);
    }
    setText(requireElement(this.app, ANIMATION_IDS.graphStatus, HTMLElement), this.message);
  }
  private select(ref: GraphKeyRef): void {
    const state = this.getState();
    if (ref.channel.kind === 'root') state.selectRootMotion(ref.channel.property, ref.time);
    else if (ref.channel.kind === 'bone')
      state.selectKeyframe({ boneId: ref.channel.id, property: ref.channel.property, time: ref.time });
    else
      state.ik.selectIKKeyframe({
        kind: 'ik',
        constraintId: ref.channel.id,
        property: ref.channel.property,
        time: ref.time,
      });
  }
  private begin(event: PointerEvent): void {
    if (
      this.drag ||
      !this.view ||
      !this.getState().animationAuthoringEnabled ||
      (event.button !== 0 && event.button !== 1)
    )
      return;
    const channel = this.channel();
    const animation = this.getState().workingAnimation;
    if (!channel || !animation) return;
    const point = this.pointer(event.clientX, event.clientY);
    const hit = (event.target as Element).closest<SVGElement>('[data-graph-key]');
    const base = { pointer: event.pointerId, x: point.x, y: point.y, view: this.view };
    if (event.button === 1) this.drag = { ...base, kind: 'pan' };
    else if (hit) {
      const index = Number(hit.dataset.graphKey);
      const keys = graphDisplayKeys(animation, channel);
      const key = keys[index];
      if (!key) return;
      const ref = { channel, time: toSeconds(key.time) };
      // Selecting a tangent must keep the held playhead for a useful live curve preview.
      if (!hit.dataset.handle) this.select(ref);
      if (!this.getState().beginGraphEdit(ref)) return;
      this.drag = {
        ...base,
        kind: hit.dataset.handle === 'control1' ? 'control1' : hit.dataset.handle === 'control2' ? 'control2' : 'key',
        ref,
        index,
        keys,
        raw: graphKeys(animation, channel)[index]!.value,
      };
    } else {
      this.getState().pause();
      this.drag = { ...base, kind: 'scrub' };
      this.getState().setCurrentTime(pointToGraph(point.x, point.y, this.view, this.width, this.height).time);
    }
    event.preventDefault();
    this.canvas.focus();
    this.canvas.setPointerCapture(event.pointerId);
  }
  private move(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    const point = this.pointer(event.clientX, event.clientY);
    const current = pointToGraph(point.x, point.y, drag.view, this.width, this.height);
    const start = pointToGraph(drag.x, drag.y, drag.view, this.width, this.height);
    if (drag.kind === 'pan') {
      this.view = panGraph(drag.view, start.time - current.time, start.value - current.value);
      this.rendered = [];
      this.render();
      return;
    }
    if (drag.kind === 'scrub') {
      this.getState().setCurrentTime(current.time);
      return;
    }
    const key = drag.keys[drag.index]!;
    let edit: GraphKeyEdit;
    if (drag.kind === 'key') {
      let time = drag.ref.time + current.time - start.time;
      const state = this.getState();
      time = snapKeyframeTime(
        time,
        state.duration,
        !event.shiftKey && state.timelineSnapSettings.enabled && state.timelineSnapSettings.frames ? 'frame' : 'none',
        state.keyframeFPS,
      );
      edit = { time, value: drag.raw + graphLocalValue(drag.ref.channel, current.value - start.value) };
    } else {
      const end = drag.keys[drag.index + 1];
      if (!end || key.curve?.mode !== 'bezier') return;
      const span = end.value - key.value;
      edit = {
        curve: constrainGraphHandle(key.curve, drag.kind, {
          x: (current.time - toSeconds(key.time)) / toSeconds(end.time - key.time),
          y: span === 0 ? key.curve[drag.kind].y : (current.value - key.value) / span,
        }),
      };
    }
    // Every published preview has passed the same authored validation boundary.
    this.run(() => this.getState().previewGraphEdit(edit));
  }
  private end(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;
    if (drag.kind !== 'pan' && drag.kind !== 'scrub') this.run(() => this.getState().commitGraphEdit());
    if (this.canvas.hasPointerCapture(drag.pointer)) this.canvas.releasePointerCapture(drag.pointer);
    this.rendered = [];
    this.render();
  }
  cancelGesture(): void {
    const drag = this.drag;
    this.drag = undefined;
    this.owner?.cancelGraphEdit();
    if (drag && this.canvas.hasPointerCapture(drag.pointer)) this.canvas.releasePointerCapture(drag.pointer);
  }
  private keydown(event: KeyboardEvent): void {
    if (blocksEditorShortcut(event) || isTypingTarget(event.target)) return;
    const hit = (event.target as Element).closest<SVGElement>('[data-graph-key]');
    if ((event.key === 'Enter' || event.key === ' ') && hit && !hit.dataset.handle) {
      const channel = this.channel();
      const animation = this.getState().workingAnimation;
      const key = channel && animation ? graphKeys(animation, channel)[Number(hit.dataset.graphKey)] : undefined;
      if (key && channel) {
        event.preventDefault();
        event.stopPropagation();
        this.canvas.focus();
        this.select({ channel, time: toSeconds(key.time) });
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (!['delete', 'backspace', 'escape', 'f', '+', '=', '-', 'arrowleft', 'arrowright'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === 'escape') {
      this.cancelGesture();
      this.getState().clearKeyframeSelection();
    } else if (key === 'delete' || key === 'backspace') {
      if (!event.repeat) this.getState().deleteTimelineSelection();
    } else if (key === 'f') this.fit();
    else if (key === '+' || key === '=') this.zoom(0.5);
    else if (key === '-') this.zoom(2);
    else {
      const ref = this.ref();
      if (ref)
        this.edit({
          time: ref.time + ((key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 10 : 1)) / this.getState().keyframeFPS,
        });
    }
  }
  render(): void {
    const state = this.getState();
    if (this.owner !== state || this.session !== state.sessionRevision) {
      this.cancelGesture();
      this.owner = state;
      this.session = state.sessionRevision;
      this.context = '';
      this.view = undefined;
    }
    if (this.drag && this.drag.kind !== 'pan' && this.drag.kind !== 'scrub' && !state.graphEditActive)
      this.cancelGesture();
    if (!this.active) return;
    const animation = state.previewAnimation;
    const channel = this.channel();
    const context = JSON.stringify([state.selectedAnimationId, channel]);
    if (context !== this.context) {
      this.context = context;
      this.view = animation && channel ? fitGraph(animation, channel) : undefined;
      this.message = '';
    }
    const view = this.view;
    const inputs = [
      animation,
      context,
      view,
      state.selectedKeys,
      state.ik.selectedIKKeyframe,
      state.selectedRootKey,
      state.editorMode,
      this.width,
      this.height,
    ];
    if (inputs.some((value, index) => value !== this.rendered[index]) || this.rendered.length === 0) {
      this.rendered = inputs;
      this.draw();
    }
    if (view) {
      const x = 64 + graphToPoint(state.currentTime, 0, view, this.width, this.height).x;
      for (const [name, value] of Object.entries({ x1: x, x2: x, y1: 16, y2: this.height + 16 }))
        this.playhead.setAttribute(name, String(value));
      this.playhead.setAttribute('visibility', x >= 64 && x <= 64 + this.width ? 'visible' : 'hidden');
    } else this.playhead.setAttribute('visibility', 'hidden');
  }
  private draw(): void {
    const state = this.getState();
    const animation = state.previewAnimation;
    const channel = this.channel();
    const channels = graphChannels(state);
    const optionsKey = JSON.stringify(channels);
    if (this.property.dataset.channels !== optionsKey) {
      this.property.dataset.channels = optionsKey;
      this.property.replaceChildren(
        ...channels.map(
          (entry) =>
            new Option(
              entry.kind === 'root'
                ? `Root Position ${entry.property.toUpperCase()}`
                : entry.kind === 'ik' && entry.property !== 'mix'
                  ? `IK target ${entry.property.toUpperCase()}`
                  : graphPropertyLabels[entry.property],
              entry.property,
            ),
        ),
      );
    }
    if (channel) this.property.value = channel.property;
    this.property.disabled = !animation || !channel || !state.animationAuthoringEnabled;
    setText(
      requireElement(this.app, ANIMATION_IDS.graphTarget, HTMLElement),
      channel
        ? channel.kind === 'root'
          ? 'Root Motion'
          : `${channel.kind === 'ik' ? 'IK constraint' : 'Bone'}: ${channel.id}`
        : 'No track selected',
    );
    const keys = animation && channel ? graphDisplayKeys(animation, channel) : [];
    const selectedTime = channel ? this.selectedTime(channel) : undefined;
    const selected = keys.findIndex((key) => toSeconds(key.time) === selectedTime);
    const selectedKey = keys[selected];
    const raw = animation && channel ? graphKeys(animation, channel)[selected] : undefined;
    const outgoing = selected >= 0 && selected + 1 < keys.length;
    for (const control of [
      requireElement(this.app, ANIMATION_IDS.graphKeyTime, HTMLInputElement),
      requireElement(this.app, ANIMATION_IDS.graphKeyValue, HTMLInputElement),
      requireElement(this.app, ANIMATION_IDS.graphApply, HTMLButtonElement),
    ])
      control.disabled = !selectedKey || !state.animationAuthoringEnabled;
    requireElement(this.app, ANIMATION_IDS.graphInterpolation, HTMLSelectElement).disabled =
      !outgoing || !state.animationAuthoringEnabled;
    requireElement(this.app, ANIMATION_IDS.graphResetHandles, HTMLButtonElement).disabled =
      !outgoing || !state.animationAuthoringEnabled;
    this.input(ANIMATION_IDS.graphKeyTime, raw ? String(toSeconds(raw.time)) : '');
    this.input(ANIMATION_IDS.graphKeyValue, raw && channel ? String(graphDisplayValue(channel, raw.value)) : '');
    requireElement(this.app, ANIMATION_IDS.graphKeyValue, HTMLInputElement).step = 'any';
    const mode = requireElement(this.app, ANIMATION_IDS.graphInterpolation, HTMLSelectElement);
    mode.value = selectedKey?.curve?.mode ?? 'auto';
    const curve = selectedKey?.curve;
    for (const [id, handle, axis] of [
      [ANIMATION_IDS.graphControl1X, 'control1', 'x'],
      [ANIMATION_IDS.graphControl1Y, 'control1', 'y'],
      [ANIMATION_IDS.graphControl2X, 'control2', 'x'],
      [ANIMATION_IDS.graphControl2Y, 'control2', 'y'],
    ] as const) {
      requireElement(this.app, id, HTMLInputElement).disabled =
        !outgoing || curve?.mode !== 'bezier' || !state.animationAuthoringEnabled;
      this.input(id, curve?.mode === 'bezier' ? String(curve[handle][axis]) : '');
    }
    requireElement(this.app, ANIMATION_IDS.graphApplyHandles, HTMLButtonElement).disabled =
      !outgoing || curve?.mode !== 'bezier' || !state.animationAuthoringEnabled;
    const empty = !animation
      ? 'Select an animation.'
      : !channel
        ? 'Select a bone, root motion channel or IK constraint in the timeline or preview.'
        : !keys.length
          ? 'No keys on this property. Use the property inspector to set keys at the playhead.'
          : !selectedKey
            ? 'Select a point to edit its key and outgoing segment.'
            : !outgoing
              ? 'Last key: no outgoing segment.'
              : '';
    setText(requireElement(this.app, ANIMATION_IDS.graphStatus, HTMLElement), this.message || empty);
    const view = this.view;
    if (!view || !animation || !channel) {
      this.drawing.replaceChildren();
      return;
    }
    const children: SVGElement[] = [];
    const point = (time: number, value: number) => {
      const p = graphToPoint(time, value, view, this.width, this.height);
      return { x: p.x + 64, y: p.y + 16 };
    };
    for (let i = 0; i <= 4; i++) {
      const time = view.start + ((view.end - view.start) * i) / 4;
      const value = view.min + ((view.max - view.min) * i) / 4;
      const x = 64 + (this.width * i) / 4;
      const y = 16 + this.height * (1 - i / 4);
      children.push(
        svgElement('line', { x1: x, x2: x, y1: 16, y2: this.height + 16, class: 'graph-grid' }),
        svgElement('text', { x, y: this.height + 34, 'text-anchor': 'middle' }, `${labelNumber(time)} s`),
      );
      children.push(
        svgElement('line', { x1: 64, x2: this.width + 64, y1: y, y2: y, class: 'graph-grid' }),
        svgElement('text', { x: 58, y: y + 4, 'text-anchor': 'end' }, labelNumber(value)),
      );
    }
    const plot = svgElement('svg', { x: 64, y: 16, width: this.width, height: this.height, overflow: 'hidden' });
    const plotPoint = (time: number, value: number) => graphToPoint(time, value, view, this.width, this.height);
    if (keys.length) {
      const start = Math.max(0, view.start);
      const end = Math.min(toSeconds(animation.duration), view.end);
      const count = Math.min(1200, Math.max(64, Math.ceil(this.width)));
      const times = new Set<number>();
      if (end >= start) for (let i = 0; i <= count; i++) times.add(start + ((end - start) * i) / count);
      // Include both sides of authored discontinuities and frame holds.
      const boundaries = keys.map((key) => toSeconds(key.time));
      if (animation.playback?.mode === 'stepped') {
        const fps = animation.playback.fps;
        const first = Math.max(0, Math.ceil(start * fps));
        const last = Math.min(Math.floor(end * fps), first + 2000);
        for (let frame = first; frame <= last; frame++) boundaries.push(frame / fps);
      }
      for (const time of boundaries)
        if (time >= start && time <= end) {
          times.add(time);
          if (time > start) times.add(Math.max(start, time - 1e-8));
        }
      const path = [...times]
        .sort((a, b) => a - b)
        .map((time, index) => {
          const p = plotPoint(time, sampleGraph(animation, keys, time));
          return `${index ? 'L' : 'M'}${p.x},${p.y}`;
        })
        .join(' ');
      plot.append(svgElement('path', { d: path, class: 'graph-curve', 'data-channel': channel.property }));
      keys.forEach((key, index) => {
        const p = plotPoint(toSeconds(key.time), key.value);
        const selectedPoint =
          channel.kind === 'bone'
            ? state.selectedKeys.some(
                (ref) =>
                  ref.boneId === channel.id && ref.property === channel.property && ref.time === toSeconds(key.time),
              )
            : selected === index;
        plot.append(
          svgElement('circle', {
            cx: p.x,
            cy: p.y,
            r: selectedPoint ? 6 : 5,
            class: 'graph-key',
            'data-graph-key': index,
            role: 'button',
            tabindex: 0,
            'aria-pressed': String(selectedPoint),
            'aria-label': `Select ${channel.id} ${channel.property} graph key at ${labelNumber(toSeconds(key.time))} s`,
          }),
        );
      });
      if (selectedKey?.curve?.mode === 'bezier' && outgoing) {
        const next = keys[selected + 1]!;
        const curve = selectedKey.curve;
        for (const handle of ['control1', 'control2'] as const) {
          const control = curve[handle];
          const p = plotPoint(
            toSeconds(selectedKey.time + (next.time - selectedKey.time) * control.x),
            selectedKey.value + (next.value - selectedKey.value) * control.y,
          );
          const endpoint = handle === 'control1' ? selectedKey : next;
          const origin = plotPoint(toSeconds(endpoint.time), endpoint.value);
          plot.append(svgElement('line', { x1: origin.x, y1: origin.y, x2: p.x, y2: p.y, class: 'graph-tangent' }));
          const circle = svgElement('circle', {
            cx: p.x,
            cy: p.y,
            r: 5,
            class: 'graph-handle',
            'data-graph-key': selected,
            'data-handle': handle,
            role: 'img',
            'aria-label': `${handle} tangent. Drag to change segment time and progress, or use Tangent precision.`,
          });
          circle.append(
            svgElement(
              'title',
              {},
              'Drag tangent: time stays between segment endpoints and handles cannot cross. Progress stays between 0 and 1.',
            ),
          );
          plot.append(circle);
        }
      }
    }
    children.push(plot);
    // Axis labels use the same degree convention as the bone inspector.
    const origin = point(view.start, view.max);
    children.push(
      svgElement('text', { x: origin.x + 4, y: 12 }, channel.property === 'rotation' ? 'Value (°)' : 'Value'),
    );
    this.drawing.replaceChildren(...children);
  }
  private input(id: string, value: string): void {
    const input = requireElement(this.app, id, HTMLInputElement);
    if (document.activeElement !== input && input.value !== value) input.value = value;
  }
  dispose(): void {
    this.cancelGesture();
    this.abort.abort();
    this.resize.disconnect();
  }
}
