import { bindWorkspaceDivider } from '../shared/workspaceDivider.js';

/** Layout preferences belong to this mounted workspace, independently of scene documents/history. */
export class SceneWorkspaceLayoutController {
  private readonly abort = new AbortController();
  private readonly resize: ResizeObserver;
  private frame = 0;

  constructor(layout: HTMLElement) {
    const inspector = layout.querySelector<HTMLElement>('#scene-inspector')!;
    const timeline = layout.querySelector<HTMLElement>('#scene-timeline')!;
    const inspectorDivider = layout.querySelector<HTMLElement>('#scene-inspector-divider')!;
    const timelineDivider = layout.querySelector<HTMLElement>('#scene-timeline-divider')!;
    const inspectorMaximum = (): number => Math.max(260, layout.clientWidth - 560 - 12);
    const timelineMaximum = (): number => Math.max(240, layout.clientHeight - 200 - 12);
    const update = (element: HTMLElement, property: string, value: number, min: number, max: number): void => {
      const size = Math.max(min, Math.min(max, value));
      layout.style.setProperty(property, `${size}px`);
      element.setAttribute('aria-valuemin', String(min));
      element.setAttribute('aria-valuemax', String(Math.floor(max)));
      element.setAttribute('aria-valuenow', String(Math.round(size)));
    };
    const width = (value: number): void =>
      update(inspectorDivider, '--scene-inspector-width', value, 260, inspectorMaximum());
    const height = (value: number): void =>
      update(timelineDivider, '--scene-timeline-height', value, 240, timelineMaximum());
    bindWorkspaceDivider(
      inspectorDivider,
      'x',
      (coordinate) => width(layout.getBoundingClientRect().right - coordinate - 6),
      (key) => {
        const held = Number(inspectorDivider.getAttribute('aria-valuenow'));
        if (key === 'ArrowLeft') width(held + 10);
        else if (key === 'ArrowRight') width(held - 10);
        else if (key === 'Home') width(260);
        else if (key === 'End') width(inspectorMaximum());
        else return false;
        return true;
      },
      this.abort.signal,
    );
    bindWorkspaceDivider(
      timelineDivider,
      'y',
      (coordinate) => height(layout.getBoundingClientRect().bottom - coordinate - 6),
      (key) => {
        const held = Number(timelineDivider.getAttribute('aria-valuenow'));
        if (key === 'ArrowUp') height(held + 20);
        else if (key === 'ArrowDown') height(held - 20);
        else if (key === 'Home') height(240);
        else if (key === 'End') height(timelineMaximum());
        else return false;
        return true;
      },
      this.abort.signal,
    );
    const refresh = (): void => {
      width(inspector.getBoundingClientRect().width);
      height(timeline.getBoundingClientRect().height);
    };
    refresh();
    this.resize = new ResizeObserver(() => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        refresh();
      });
    });
    this.resize.observe(layout);
  }

  dispose(): void {
    this.abort.abort();
    this.resize.disconnect();
    cancelAnimationFrame(this.frame);
  }
}
