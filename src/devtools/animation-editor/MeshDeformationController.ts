import { getMeshDeformationTrack, sampleMeshDeformation } from '../../engine/core.js';
import type { MeshDeformationKey, VertexOffset, MeshAttachmentDefinition } from '../../engine/data.js';
import { requireElement } from '../shared/editorElements.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { ANIMATION_IDS } from './elementIds.js';
import { timeToTimelineX } from './timeline.js';

const svgNS = 'http://www.w3.org/2000/svg';
/** Controls that edit the selected deformation key, disabled until one is selected. */
const KEY_CONTROLS = new Set<string>([
  ANIMATION_IDS.deformationKeyTime,
  ANIMATION_IDS.deformationCurve,
  ANIMATION_IDS.deformationApplyKey,
  ANIMATION_IDS.deformationDeleteKey,
  ANIMATION_IDS.deformationDuplicateKey,
]);
/** Bind-space manipulation deliberately avoids inverting a weighted, potentially singular posed mesh. */
export class MeshDeformationController {
  readonly labels: HTMLElement[] = [];
  readonly lanes: HTMLElement[] = [];
  revision = 0;
  private readonly abort = new AbortController();
  private state: AnimationEditorState | undefined;
  private animation: unknown;
  private rig: unknown;
  private session = -1;
  private width = 1;
  private vertices = new Set<string>();
  private mesh: MeshAttachmentDefinition | undefined;
  private readonly markers = new Map<HTMLButtonElement, { mesh: string; time: number }>();
  private drawnMesh: MeshAttachmentDefinition | undefined;
  private drawSignature = '';
  private drag:
    | {
        pointer: number;
        element: Element;
        state: AnimationEditorState;
        startX: number;
        startY: number;
        key?: MeshDeformationKey;
        offsets?: Map<string, VertexOffset>;
        point?: DOMPoint;
        moved: boolean;
        time: number;
      }
    | undefined;

  constructor(private readonly app: HTMLElement) {
    const options = { signal: this.abort.signal };
    requireElement(this.app, ANIMATION_IDS.deformationDiagnostics, HTMLInputElement).addEventListener(
      'change',
      (event) => {
        this.state?.setMeshDiagnostics((event.target as HTMLInputElement).checked);
      },
      options,
    );
    requireElement(this.app, ANIMATION_IDS.deformationEditMode, HTMLInputElement).addEventListener(
      'change',
      (event) => {
        this.state?.setDeformationEditing((event.target as HTMLInputElement).checked);
      },
      options,
    );
    requireElement(this.app, ANIMATION_IDS.deformationMesh, HTMLSelectElement).addEventListener(
      'change',
      (event) => {
        this.vertices.clear();
        this.state?.selectDeformation((event.target as HTMLSelectElement).value);
      },
      options,
    );
    requireElement(this.app, ANIMATION_IDS.deformationVertex, HTMLSelectElement).addEventListener(
      'change',
      (event) => {
        this.vertices = new Set([(event.target as HTMLSelectElement).value]);
        this.refresh();
      },
      options,
    );
    requireElement(this.app, ANIMATION_IDS.deformationOffsetForm, HTMLFormElement).addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        this.run(() =>
          this.state?.setMeshOffsets(
            Object.fromEntries(
              [...this.vertices].map((id) => [
                id,
                { x: this.number(ANIMATION_IDS.deformationX), y: this.number(ANIMATION_IDS.deformationY) },
              ]),
            ),
          ),
        );
      },
      options,
    );
    for (const [id, action] of [
      [ANIMATION_IDS.deformationRemoveIncompatible, () => this.state?.removeIncompatibleDeformationTracks()],
      [ANIMATION_IDS.deformationAddKey, () => this.state?.setMeshOffsets({})],
      [ANIMATION_IDS.deformationNeutral, () => this.state?.setMeshOffsets(null)],
      [ANIMATION_IDS.deformationDeleteKey, () => this.state?.changeDeformationKey(null)],
      [ANIMATION_IDS.deformationDuplicateKey, () => this.state?.duplicateDeformationKey()],
    ] as const)
      requireElement(this.app, id, HTMLButtonElement).addEventListener('click', () => this.run(action), options);
    requireElement(this.app, ANIMATION_IDS.deformationKeyForm, HTMLFormElement).addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        const key = this.state?.selectedDeformationKey;
        const mode = requireElement(this.app, ANIMATION_IDS.deformationCurve, HTMLSelectElement).value;
        if (key)
          this.run(() =>
            this.state?.changeDeformationKey({
              ...key,
              time: this.number(ANIMATION_IDS.deformationKeyTime) * 1000,
              ...(mode === 'bezier' ? {} : { curve: { mode: mode === 'stepped' ? 'stepped' : 'linear' } }),
            }),
          );
      },
      options,
    );
    const svg = requireElement(this.app, ANIMATION_IDS.deformationBindView, SVGSVGElement);
    svg.addEventListener('pointerdown', (event) => this.beginVertex(event), options);
    svg.addEventListener(
      'keydown',
      (event) => {
        const id = (event.target as Element).getAttribute('data-vertex');
        if (id && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          this.chooseVertex(id, event.shiftKey);
          this.refresh();
        }
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
  private run(action: () => unknown): boolean {
    try {
      const result = action();
      requireElement(this.app, ANIMATION_IDS.deformationStatus, HTMLElement).textContent =
        result === false
          ? this.state?.validationIssues.map((issue) => issue.message).join(' ') ||
            'No change applied. Select a mesh/key and use a time inside the clip.'
          : '';
      return result !== false;
    } catch (error) {
      requireElement(this.app, ANIMATION_IDS.deformationStatus, HTMLElement).textContent =
        error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  private reveal(): void {
    requireElement(this.app, ANIMATION_IDS.meshDeformationPanel, HTMLElement).dispatchEvent(
      new CustomEvent('workspace:reveal-tab', { bubbles: true, detail: 'animation-inspector-deformation' }),
    );
  }
  private chooseVertex(id: string, additive: boolean): void {
    if (additive) {
      if (this.vertices.has(id)) this.vertices.delete(id);
      else this.vertices.add(id);
    } else if (!this.vertices.has(id)) this.vertices = new Set([id]);
  }
  private point(event: PointerEvent): DOMPoint | null {
    const matrix = requireElement(this.app, ANIMATION_IDS.deformationBindView, SVGSVGElement).getScreenCTM();
    if (!matrix || !Number.isFinite(matrix.a) || matrix.a * matrix.d - matrix.b * matrix.c === 0) return null;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }
  private beginVertex(event: PointerEvent): void {
    const state = this.state;
    const target = (event.target as Element).closest('[data-vertex]');
    const id = target?.getAttribute('data-vertex');
    if (!state?.deformationEditing || !state.animationAuthoringEnabled || !id || !target || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
    this.chooseVertex(id, event.shiftKey);
    const point = this.point(event);
    if (!point || !this.vertices.size || !state.beginDeformationEdit()) {
      this.refresh();
      return;
    }
    const offsets = new Map(
      sampleMeshDeformation(
        getMeshDeformationTrack(state.workingAnimation!, this.mesh!.id),
        state.currentTimeMilliseconds,
      ),
    );
    // Capture on the SVG: handles are reconciled while a provisional shape changes.
    const element = requireElement(this.app, ANIMATION_IDS.deformationBindView, SVGSVGElement);
    this.drag = {
      pointer: event.pointerId,
      element,
      state,
      startX: event.clientX,
      startY: event.clientY,
      offsets,
      point,
      moved: false,
      time: state.currentTime,
    };
    element.setPointerCapture(event.pointerId);
    this.refresh();
  }
  private beginKey(event: PointerEvent, mesh: string, key: MeshDeformationKey, marker: HTMLButtonElement): void {
    event.stopPropagation();
    if (event.button !== 0 || !this.state?.animationAuthoringEnabled) return;
    event.preventDefault();
    this.cancel();
    const state = this.state;
    state.selectDeformation(mesh, key.time / 1000);
    this.reveal();
    if (!state.beginDeformationEdit()) return;
    this.drag = {
      pointer: event.pointerId,
      element: marker,
      state,
      startX: event.clientX,
      startY: event.clientY,
      key,
      moved: false,
      time: key.time / 1000,
    };
    marker.focus();
    marker.setPointerCapture(event.pointerId);
  }
  private move = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    if (!drag.state.deformationEditActive || drag.state !== this.state) {
      this.cancel();
      return;
    }
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return;
    if (drag.key) {
      let time = drag.key.time / 1000 + ((event.clientX - drag.startX) / this.width) * drag.state.duration;
      if (!event.shiftKey && drag.state.timelineSnapSettings.enabled && drag.state.timelineSnapSettings.frames)
        time = Math.round(time * drag.state.keyframeFPS) / drag.state.keyframeFPS;
      time = Math.max(0, Math.min(drag.state.duration, time));
      if (this.run(() => drag.state.previewDeformationMove(drag.key!, time * 1000))) {
        drag.time = time;
        drag.moved = true;
        (drag.element as HTMLElement).style.left = `${timeToTimelineX(time, drag.state.duration, this.width)}px`;
      }
    } else {
      const point = this.point(event);
      if (!point || !drag.point) return;
      drag.moved = this.run(() =>
        drag.state.previewMeshOffsets(
          Object.fromEntries(
            [...this.vertices].map((id) => [
              id,
              {
                x: (drag.offsets?.get(id)?.x ?? 0) + point.x - drag.point!.x,
                y: (drag.offsets?.get(id)?.y ?? 0) + point.y - drag.point!.y,
              },
            ]),
          ),
        ),
      );
    }
  };
  private up = (event: PointerEvent): void => {
    if (event.pointerId !== this.drag?.pointer) return;
    this.move(event);
    const drag = this.release();
    if (drag?.moved) this.run(() => drag.state.commitDeformationEdit(drag.time));
    else drag?.state.cancelDeformationEdit();
  };
  private release() {
    const drag = this.drag;
    this.drag = undefined;
    if (drag?.element.hasPointerCapture(drag.pointer)) drag.element.releasePointerCapture(drag.pointer);
    return drag;
  }
  private cancel = (): void => {
    const drag = this.release();
    drag?.state.cancelDeformationEdit();
    this.refresh();
  };
  render(state: AnimationEditorState, width: number): void {
    if (this.state !== state || this.session !== state.sessionRevision || width !== this.width) this.cancel();
    this.state = state;
    this.session = state.sessionRevision;
    this.width = width;
    if (this.animation !== state.workingAnimation || this.rig !== state.rig) {
      this.cancel();
      this.animation = state.workingAnimation;
      this.rig = state.rig;
      const restoreFocus = [...this.markers.keys()].some((marker) => marker === document.activeElement);
      this.rebuildRows();
      if (restoreFocus)
        queueMicrotask(() => {
          if (this.state !== state) return;
          const selected = [...this.markers].find(
            ([, ref]) => ref.mesh === state.selectedMeshId && ref.time === state.selectedDeformationTime,
          )?.[0];
          (selected ?? requireElement(this.app, ANIMATION_IDS.timeline, HTMLElement)).focus({ preventScroll: true });
        });
    }
    for (const [marker, ref] of this.markers) {
      const selected =
        state.deformationSelected && state.selectedMeshId === ref.mesh && state.selectedDeformationTime === ref.time;
      marker.setAttribute('aria-pressed', String(selected));
      marker.dataset.primary = String(selected);
      if (this.drag?.element !== marker) marker.style.left = `${timeToTimelineX(ref.time, state.duration, width)}px`;
    }
    for (let index = 1; index < this.labels.length; index++) {
      const active = state.deformationSelected && this.lanes[index]!.dataset.meshId === state.selectedMeshId;
      this.labels[index]!.dataset.selected = String(active);
      this.lanes[index]!.dataset.selected = String(active);
      this.labels[index]!.querySelector('button')?.setAttribute('aria-pressed', String(active));
    }
    this.refresh();
  }
  private rebuildRows(): void {
    this.labels.length = 0;
    this.lanes.length = 0;
    this.markers.clear();
    ++this.revision;
    const meshes = this.state?.rig?.attachments.filter((entry) => entry.type === 'mesh') ?? [];
    if (!meshes.length || !this.state?.workingAnimation) return;
    for (const mesh of [null, ...meshes]) {
      const label = document.createElement('div'),
        lane = document.createElement('div');
      label.className = 'timeline-track-label timeline-deformation-track';
      lane.className = 'timeline-track-lane timeline-deformation-track';
      if (mesh) {
        label.style.paddingLeft = '16px';
        lane.dataset.meshId = mesh.id;
        const select = document.createElement('button');
        select.type = 'button';
        select.className = 'timeline-track-select';
        select.textContent = mesh.id;
        select.setAttribute('aria-label', `Select mesh deformation ${mesh.id}`);
        select.addEventListener('click', () => {
          this.state?.selectDeformation(mesh.id);
          this.reveal();
        });
        label.append(select);
        for (const key of getMeshDeformationTrack(this.state.workingAnimation, mesh.id)) {
          const marker = document.createElement('button');
          marker.type = 'button';
          marker.className = 'timeline-keyframe';
          marker.dataset.time = String(key.time / 1000);
          marker.dataset.interpolation = key.curve?.mode ?? 'linear';
          marker.setAttribute('aria-label', `Select ${mesh.id} deformation key at ${key.time / 1000} s`);
          marker.title = `${mesh.id}: ${Object.keys(key.offsets).length} vertex corrections; ${key.curve?.mode ?? 'linear'}`;
          marker.addEventListener('pointerdown', (event) => this.beginKey(event, mesh.id, key, marker));
          marker.addEventListener('click', (event) => {
            if (!event.detail) {
              this.state?.selectDeformation(mesh.id, key.time / 1000);
              this.reveal();
            }
          });
          marker.addEventListener('lostpointercapture', () => {
            if (this.drag?.element === marker) this.cancel();
          });
          lane.append(marker);
          this.markers.set(marker, { mesh: mesh.id, time: key.time / 1000 });
        }
      } else label.textContent = 'Mesh Deformation';
      this.labels.push(label);
      this.lanes.push(lane);
    }
  }
  private refresh(): void {
    const state = this.state;
    if (!state) return;
    const meshes =
      state.rig?.attachments.filter((entry): entry is MeshAttachmentDefinition => entry.type === 'mesh') ?? [];
    const select = requireElement(this.app, ANIMATION_IDS.deformationMesh, HTMLSelectElement);
    const signature = JSON.stringify(meshes.map((entry) => entry.id));
    if (select.dataset.options !== signature) {
      select.replaceChildren(...meshes.map((mesh) => new Option(mesh.id, mesh.id)));
      select.dataset.options = signature;
    }
    const mesh = meshes.find((entry) => entry.id === state.selectedMeshId);
    // Choosing a default is a visible selection action, never an authored change.
    if (!mesh && meshes.length && state.deformationEditing) {
      state.selectDeformation(meshes[0]!.id);
      return;
    }
    if (mesh !== this.mesh) {
      this.vertices.clear();
      this.mesh = mesh;
    }
    select.value = mesh?.id ?? '';
    requireElement(this.app, ANIMATION_IDS.deformationDiagnostics, HTMLInputElement).checked =
      state.meshDiagnosticsEnabled;
    requireElement(this.app, ANIMATION_IDS.meshDiagnosticsStatus, HTMLElement).hidden = !state.meshDiagnosticsEnabled;
    requireElement(this.app, ANIMATION_IDS.deformationEditMode, HTMLInputElement).checked = state.deformationEditing;
    requireElement(this.app, ANIMATION_IDS.deformationEmpty, HTMLElement).textContent = !meshes.length
      ? 'No mesh attachments. Create a mesh in the Rig Editor first.'
      : !mesh
        ? 'Choose a mesh to edit corrections.'
        : '';
    requireElement(this.app, ANIMATION_IDS.deformationTopology, HTMLElement).textContent =
      state.deformationTopologyIssues.map((issue) => issue.message).join(' ');
    requireElement(this.app, ANIMATION_IDS.deformationRemoveIncompatible, HTMLButtonElement).hidden =
      !state.deformationTopologyIssues.length;
    const vertices = requireElement(this.app, ANIMATION_IDS.deformationVertex, HTMLSelectElement);
    const vertexSignature = JSON.stringify(mesh?.vertices.map((entry) => entry.id));
    if (vertices.dataset.options !== vertexSignature) {
      vertices.replaceChildren(...(mesh?.vertices.map((vertex) => new Option(vertex.id, vertex.id)) ?? []));
      vertices.dataset.options = vertexSignature;
    }
    this.vertices = new Set([...this.vertices].filter((id) => mesh?.vertices.some((vertex) => vertex.id === id)));
    if (!this.vertices.size && mesh?.vertices[0]) this.vertices.add(mesh.vertices[0].id);
    vertices.value = [...this.vertices][0] ?? '';
    const keys = state.previewAnimation ? getMeshDeformationTrack(state.previewAnimation, mesh?.id ?? '') : [];
    const offsets = sampleMeshDeformation(keys, state.currentTimeMilliseconds);
    const offset = offsets.get(vertices.value) ?? { x: 0, y: 0 };
    for (const [id, value] of [
      [ANIMATION_IDS.deformationX, offset.x],
      [ANIMATION_IDS.deformationY, offset.y],
      [
        ANIMATION_IDS.deformationKeyTime,
        state.selectedDeformationKey?.time === undefined ? '' : state.selectedDeformationKey.time / 1000,
      ],
    ] as const) {
      const input = requireElement(this.app, id, HTMLInputElement);
      if (document.activeElement !== input) input.value = String(value);
    }
    const curve = requireElement(this.app, ANIMATION_IDS.deformationCurve, HTMLSelectElement);
    const mode = state.selectedDeformationKey?.curve?.mode ?? 'linear';
    if (mode === 'bezier' && !curve.querySelector('[value="bezier"]'))
      curve.add(new Option('Bézier (preserve imported controls)', 'bezier'));
    if (document.activeElement !== curve) curve.value = mode;
    requireElement(this.app, ANIMATION_IDS.meshDeformationPanel, HTMLElement)
      .querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, select, button')
      .forEach((input) => {
        input.disabled =
          input.id !== ANIMATION_IDS.deformationDiagnostics &&
          (!state.workingAnimation ||
            !state.animationAuthoringEnabled ||
            (input.id !== ANIMATION_IDS.deformationEditMode &&
              input.id !== ANIMATION_IDS.deformationMesh &&
              input.id !== ANIMATION_IDS.deformationRemoveIncompatible &&
              (!mesh || !state.deformationEditing)) ||
            (KEY_CONTROLS.has(input.id) && !state.selectedDeformationKey));
      });
    this.draw(mesh, offsets);
  }
  private draw(mesh: MeshAttachmentDefinition | undefined, offsets: ReadonlyMap<string, VertexOffset>): void {
    const svg = requireElement(this.app, ANIMATION_IDS.deformationBindView, SVGSVGElement);
    svg.style.display = mesh && this.state?.deformationEditing ? '' : 'none';
    if (!mesh || !this.state?.deformationEditing) {
      this.drawSignature = '';
      svg.replaceChildren();
      return;
    }
    const points = mesh.vertices.map((vertex) => ({
      id: vertex.id,
      x: vertex.x + (offsets.get(vertex.id)?.x ?? 0),
      y: vertex.y + (offsets.get(vertex.id)?.y ?? 0),
    }));
    const signature = JSON.stringify([points, [...this.vertices], !!this.drag]);
    if (this.drawnMesh === mesh && this.drawSignature === signature) return;
    this.drawnMesh = mesh;
    this.drawSignature = signature;
    const padding = Math.max(mesh.imageSize.width, mesh.imageSize.height) * 0.15;
    // Fixed bind-space bounds during a gesture keep pointer mapping stable.
    if (!this.drag || this.drag.key) {
      const xs = [...mesh.vertices, ...points].map((p) => p.x),
        ys = [...mesh.vertices, ...points].map((p) => p.y);
      svg.setAttribute(
        'viewBox',
        `${Math.min(...xs) - padding} ${Math.min(...ys) - padding} ${Math.max(...xs) - Math.min(...xs) + 2 * padding} ${Math.max(...ys) - Math.min(...ys) + 2 * padding}`,
      );
    }
    const elements: SVGElement[] = [];
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      const polygon = document.createElementNS(svgNS, 'polygon');
      polygon.setAttribute(
        'points',
        mesh.triangles
          .slice(i, i + 3)
          .map((index) => `${points[index]!.x},${points[index]!.y}`)
          .join(' '),
      );
      elements.push(polygon);
    }
    const matrix = svg.getScreenCTM();
    const size = matrix
      ? 10 / Math.hypot(matrix.a, matrix.b)
      : Math.max(mesh.imageSize.width, mesh.imageSize.height) / 24;
    for (const point of points) {
      const handle = document.createElementNS(svgNS, 'rect');
      handle.setAttribute('x', String(point.x - size / 2));
      handle.setAttribute('y', String(point.y - size / 2));
      handle.setAttribute('width', String(size));
      handle.setAttribute('height', String(size));
      handle.setAttribute('data-vertex', point.id);
      handle.setAttribute('role', 'button');
      handle.setAttribute('tabindex', '0');
      handle.setAttribute('aria-label', `Select bind-space vertex ${point.id}`);
      handle.setAttribute('aria-pressed', String(this.vertices.has(point.id)));
      elements.push(handle);
    }
    // Keep keyboard focus on the corresponding stable ID across redraws.
    const focused = svg.contains(document.activeElement) ? document.activeElement?.getAttribute('data-vertex') : null;
    svg.replaceChildren(...elements);
    if (focused)
      [...svg.querySelectorAll<SVGElement>('[data-vertex]')]
        .find((entry) => entry.dataset.vertex === focused)
        ?.focus({ preventScroll: true });
  }
  dispose(): void {
    this.cancel();
    this.abort.abort();
    this.state = undefined;
    this.markers.clear();
  }
}
