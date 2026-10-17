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
    const previewDivider = app.querySelector<HTMLElement>('#animation-preview-divider')!;
    const inspector = app.querySelector<HTMLElement>('#animation-inspector')!;
    const preview = app.querySelector<HTMLElement>('.animation-preview')!;
    const previewOptions = app.querySelector<HTMLElement>('.animation-preview-options')!;
    const commands = app.querySelector<HTMLElement>('.animation-command-bar')!;
    const controlsHeight = (): number =>
      commands.getBoundingClientRect().bottom + 8 - layout.getBoundingClientRect().top;
    const authoringHeight = (): number => layout.clientHeight - controlsHeight();
    const inset = app.querySelector<HTMLElement>('.timeline-inset')!;
    const previewMaximum = (): number => Math.max(280, layout.clientWidth - 332);
    const updatePreviewWidth = (value: number): void => {
      const width = Math.max(280, Math.min(previewMaximum(), value));
      layout.style.setProperty('--preview-width', `${width}px`);
      previewDivider.setAttribute('aria-valuenow', String(Math.round(width)));
    };
    const limits = (): { min: number; max: number } => {
      const height = authoringHeight();
      const timelineMinimum = parseFloat(getComputedStyle(layout).getPropertyValue('--timeline-min-height'));
      const upperMinimum = parseFloat(getComputedStyle(layout).getPropertyValue('--upper-min-height'));
      return {
        min: Math.max(20, (upperMinimum / height) * 100),
        max: Math.min(70, ((height - timelineMinimum - 12) / height) * 100),
      };
    };
    const updateHeight = (value: number): void => {
      const { min, max } = limits();
      const share = Math.max(min, Math.min(max, value));
      layout.style.setProperty('--upper-share', String(share));
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
        updateHeight(((coordinate - bounds.top - controlsHeight()) / authoringHeight()) * 100);
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
      previewDivider,
      'x',
      (coordinate) => updatePreviewWidth(layout.getBoundingClientRect().right - coordinate - 6),
      (key) => {
        const held = Number(previewDivider.getAttribute('aria-valuenow'));
        if (key === 'ArrowLeft') updatePreviewWidth(held + 10);
        else if (key === 'ArrowRight') updatePreviewWidth(held - 10);
        else if (key === 'Home') updatePreviewWidth(280);
        else if (key === 'End') updatePreviewWidth(previewMaximum());
        else return false;
        return true;
      },
    );
    app.querySelector('#animation-reset-layout')!.addEventListener(
      'click',
      () => {
        layout.style.removeProperty('--upper-share');
        vertical.setAttribute(
          'aria-valuenow',
          String(Math.round(parseFloat(getComputedStyle(layout).getPropertyValue('--upper-share')))),
        );
        app.style.removeProperty('--timeline-label-width');
        horizontal.setAttribute(
          'aria-valuenow',
          String(Math.round(parseFloat(getComputedStyle(app).getPropertyValue('--timeline-label-width')))),
        );
        layout.style.removeProperty('--preview-width');
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
        // Hidden editor views share this controller and do not have usable geometry.
        if (!layout.clientHeight) return;
        layout.style.setProperty('--workspace-controls-height', `${controlsHeight()}px`);
        const held = layout.style.getPropertyValue('--upper-share');
        if (held) updateHeight(parseFloat(held));
        const { min, max } = limits();
        vertical.setAttribute('aria-valuemin', String(Math.ceil(min)));
        vertical.setAttribute('aria-valuemax', String(Math.floor(max)));
        vertical.setAttribute(
          'aria-valuenow',
          String(
            Math.round(
              ((previewDivider.getClientRects().length ? inspector : preview).getBoundingClientRect().height /
                authoringHeight()) *
                100,
            ),
          ),
        );
        if (previewDivider.getClientRects().length) {
          // Match the stage to A4 portrait at the full available height, including toolbar and panel borders.
          const portraitWidth = ((layout.clientHeight - previewOptions.offsetHeight - 2) * 210) / 297 + 2;
          layout.style.setProperty('--portrait-width', `${portraitWidth}px`);
          previewDivider.setAttribute('aria-valuemax', String(previewMaximum()));
          previewDivider.setAttribute('aria-valuenow', String(Math.round(preview.getBoundingClientRect().width)));
        }
        refreshPreview();
      });
    });
    this.previewResize.observe(app.querySelector('#animation-stage')!);
    this.previewResize.observe(layout);
    this.previewResize.observe(previewOptions);
    this.previewResize.observe(inspector);
    this.previewResize.observe(commands);
    const packageTools = layout.querySelector('.package-tools');
    if (packageTools) this.previewResize.observe(packageTools);
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
