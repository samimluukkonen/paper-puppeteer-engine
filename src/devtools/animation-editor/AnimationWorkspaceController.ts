import { EditorMenuController } from './EditorMenuController.js';

/** Workspace preferences are transient and never author animation data. */
export class AnimationWorkspaceController {
  private readonly abort = new AbortController();
  private readonly previewResize: ResizeObserver;
  private resizeFrame = 0;
  private readonly menus: EditorMenuController;

  constructor(
    private readonly app: HTMLElement,
    refreshPreview: () => void,
  ) {
    const options = { signal: this.abort.signal };
    // Native modal dialogs provide focus containment, Escape, and focus restoration.
    for (const name of ['tools', 'help']) {
      const dialog = app.querySelector<HTMLDialogElement>(`#animation-${name}-dialog`)!;
      app.querySelector(`#animation-${name}-open`)!.addEventListener('click', () => dialog.showModal(), options);
    }
    this.menus = new EditorMenuController(app);

    const layout = app.querySelector<HTMLElement>('.animation-layout')!;
    const vertical = app.querySelector<HTMLElement>('#animation-workspace-divider')!;
    const horizontal = app.querySelector<HTMLElement>('#timeline-label-divider')!;
    const inspectorDivider = app.querySelector<HTMLElement>('#animation-inspector-divider')!;
    const inspector = app.querySelector<HTMLElement>('#animation-inspector')!;
    const inset = app.querySelector<HTMLElement>('.timeline-inset')!;
    const inspectorMaximum = (): number => Math.max(280, Math.min(640, layout.clientWidth - 332));
    const updateInspector = (value: number): void => {
      const width = Math.max(280, Math.min(inspectorMaximum(), value));
      layout.style.setProperty('--inspector-width', `${width}px`);
      inspectorDivider.setAttribute('aria-valuenow', String(Math.round(width)));
    };
    const limits = (): { min: number; max: number } => {
      const height = layout.clientHeight;
      const timelineMinimum = 320;
      return {
        min: Math.max(25, (240 / height) * 100),
        max: Math.min(70, ((height - timelineMinimum - 12) / height) * 100),
      };
    };
    const updateHeight = (value: number): void => {
      const { min, max } = limits();
      const share = Math.max(min, Math.min(max, value));
      layout.style.setProperty('--preview-share', `${share}%`);
      vertical.setAttribute('aria-valuenow', String(Math.round(share)));
    };
    const updateLabels = (value: number): void => {
      const width = Math.max(120, Math.min(400, inset.clientWidth * 0.5, value));
      app.style.setProperty('--timeline-label-width', `${width}px`);
      horizontal.setAttribute('aria-valuenow', String(Math.round(width)));
    };
    this.bindDivider(
      vertical,
      'y',
      (coordinate) => {
        const bounds = layout.getBoundingClientRect();
        updateHeight(((coordinate - bounds.top) / bounds.height) * 100);
      },
      (key) => {
        const held = Number(vertical.getAttribute('aria-valuenow'));
        if (key === 'ArrowUp') updateHeight(held - 3);
        else if (key === 'ArrowDown') updateHeight(held + 3);
        else if (key === 'Home') updateHeight(limits().min);
        else if (key === 'End') updateHeight(limits().max);
        else return false;
        return true;
      },
    );
    this.bindDivider(
      horizontal,
      'x',
      (coordinate) => updateLabels(coordinate - inset.getBoundingClientRect().left),
      (key) => {
        const held = Number(horizontal.getAttribute('aria-valuenow'));
        if (key === 'ArrowLeft') updateLabels(held - 10);
        else if (key === 'ArrowRight') updateLabels(held + 10);
        else if (key === 'Home') updateLabels(120);
        else if (key === 'End') updateLabels(400);
        else return false;
        return true;
      },
    );
    this.bindDivider(
      inspectorDivider,
      'x',
      (coordinate) => updateInspector(layout.getBoundingClientRect().right - coordinate - 6),
      (key) => {
        const held = Number(inspectorDivider.getAttribute('aria-valuenow'));
        if (key === 'ArrowLeft') updateInspector(held + 10);
        else if (key === 'ArrowRight') updateInspector(held - 10);
        else if (key === 'Home') updateInspector(280);
        else if (key === 'End') updateInspector(inspectorMaximum());
        else return false;
        return true;
      },
    );
    app.querySelector('#animation-reset-layout')!.addEventListener(
      'click',
      () => {
        layout.style.removeProperty('--preview-share');
        vertical.setAttribute(
          'aria-valuenow',
          String(Math.round(parseFloat(getComputedStyle(layout).getPropertyValue('--preview-share')))),
        );
        app.style.removeProperty('--timeline-label-width');
        horizontal.setAttribute('aria-valuenow', String(Math.round(inset.clientWidth <= 600 ? 150 : 240)));
        layout.style.removeProperty('--inspector-width');
        inspectorDivider.setAttribute('aria-valuenow', '360');
        app.querySelector<HTMLButtonElement>('#timeline-clear-filters')!.click();
        const zoom = app.querySelector<HTMLSelectElement>('#timeline-zoom')!;
        zoom.value = '1';
        zoom.dispatchEvent(new Event('change'));
        inset.scrollLeft = 0;
        app.dispatchEvent(new Event('workspace:reset-inspector'));
      },
      options,
    );
    // Panel resizing doesn't necessarily resize the window; notify Phaser when its host changes.
    this.previewResize = new ResizeObserver(() => {
      if (this.resizeFrame) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = 0;
        const held = layout.style.getPropertyValue('--preview-share');
        if (held) updateHeight(parseFloat(held));
        const { min, max } = limits();
        vertical.setAttribute('aria-valuemin', String(Math.ceil(min)));
        vertical.setAttribute('aria-valuemax', String(Math.floor(max)));
        vertical.setAttribute(
          'aria-valuenow',
          String(
            Math.round(
              (app.querySelector<HTMLElement>('.animation-preview')!.clientHeight / layout.clientHeight) * 100,
            ),
          ),
        );
        if (inspectorDivider.getClientRects().length) {
          inspectorDivider.setAttribute('aria-valuemax', String(inspectorMaximum()));
          inspectorDivider.setAttribute('aria-valuenow', String(Math.round(inspector.getBoundingClientRect().width)));
        }
        refreshPreview();
      });
    });
    this.previewResize.observe(app.querySelector('#animation-stage')!);
  }

  private bindDivider(
    element: HTMLElement,
    axis: 'x' | 'y',
    move: (coordinate: number) => void,
    key: (key: string) => boolean,
  ): void {
    const options = { signal: this.abort.signal };
    let pointer: number | undefined;
    const release = (): void => {
      const previous = pointer;
      pointer = undefined;
      if (previous !== undefined && element.hasPointerCapture(previous)) element.releasePointerCapture(previous);
    };
    element.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || pointer !== undefined) return;
        event.preventDefault();
        pointer = event.pointerId;
        element.focus({ preventScroll: true });
        element.setPointerCapture(pointer);
      },
      options,
    );
    element.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerId === pointer) move(axis === 'x' ? event.clientX : event.clientY);
      },
      options,
    );
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
      element.addEventListener(
        name,
        (event) => {
          if (event.pointerId === pointer) release();
        },
        options,
      );
    window.addEventListener('blur', release, options);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) release();
      },
      options,
    );
    this.abort.signal.addEventListener('abort', release, { once: true });
    element.addEventListener(
      'keydown',
      (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
        if (key(event.key)) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      options,
    );
  }

  revealInspector(): void {
    this.app.dispatchEvent(new Event('workspace:reveal-inspector'));
  }

  dispose(): void {
    this.menus.dispose();
    this.abort.abort();
    this.previewResize.disconnect();
    cancelAnimationFrame(this.resizeFrame);
    for (const dialog of this.app.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
  }
}
