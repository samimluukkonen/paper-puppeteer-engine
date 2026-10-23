/** View-only portrait sizing and divider gestures; rig data and history stay untouched. */
export class RigWorkspaceLayoutController {
  private readonly abort = new AbortController();
  private readonly resize: ResizeObserver;
  private frame = 0;
  private releasePointer: () => void;

  constructor(app: HTMLElement) {
    const layout = app.querySelector<HTMLElement>('.workspace-layout')!;
    const preview = app.querySelector<HTMLElement>('.workspace-preview')!;
    const options = app.querySelector<HTMLElement>('.workspace-preview-options')!;
    const caption = app.querySelector<HTMLElement>('#rig-mode-hint')!;
    const divider = app.querySelector<HTMLElement>('#rig-preview-divider')!;
    const maximum = (): number => Math.max(280, layout.clientWidth - 332);
    const update = (value: number): void => {
      const width = Math.max(280, Math.min(maximum(), value));
      layout.style.setProperty('--rig-preview-width', `${width}px`);
      divider.setAttribute('aria-valuenow', String(Math.round(width)));
    };
    let pointer: number | undefined;
    this.releasePointer = (): void => {
      const held = pointer;
      pointer = undefined;
      if (held !== undefined && divider.hasPointerCapture(held)) divider.releasePointerCapture(held);
    };
    const listeners = { signal: this.abort.signal };
    divider.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || pointer !== undefined) return;
        event.preventDefault();
        pointer = event.pointerId;
        divider.focus({ preventScroll: true });
        divider.setPointerCapture(pointer);
      },
      listeners,
    );
    divider.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerId === pointer) update(layout.getBoundingClientRect().right - event.clientX - 6);
      },
      listeners,
    );
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
      divider.addEventListener(
        name,
        (event) => {
          if (event.pointerId === pointer) this.releasePointer();
        },
        listeners,
      );
    divider.addEventListener(
      'keydown',
      (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
        const held = Number(divider.getAttribute('aria-valuenow'));
        if (event.key === 'ArrowLeft') update(held + 10);
        else if (event.key === 'ArrowRight') update(held - 10);
        else if (event.key === 'Home') update(280);
        else if (event.key === 'End') update(maximum());
        else return;
        event.preventDefault();
        event.stopPropagation();
      },
      listeners,
    );
    window.addEventListener('blur', this.releasePointer, listeners);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.releasePointer();
      },
      listeners,
    );
    app.querySelector('#rig-reset-layout')!.addEventListener(
      'click',
      () => {
        layout.style.removeProperty('--rig-preview-width');
        // Refit from the default layout; the cached fit may reflect wrapped controls after a narrow drag.
        layout.style.removeProperty('--rig-portrait-width');
      },
      listeners,
    );
    this.resize = new ResizeObserver(() => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (!layout.clientHeight || !divider.getClientRects().length) return;
        const height = layout.clientHeight - options.offsetHeight - caption.offsetHeight - 2;
        layout.style.setProperty('--rig-portrait-width', `${(height * 210) / 297 + 2}px`);
        divider.setAttribute('aria-valuemax', String(maximum()));
        divider.setAttribute('aria-valuenow', String(Math.round(preview.getBoundingClientRect().width)));
      });
    });
    for (const element of [layout, preview, options, caption]) this.resize.observe(element);
  }

  dispose(): void {
    this.releasePointer();
    this.abort.abort();
    this.resize.disconnect();
    cancelAnimationFrame(this.frame);
  }
}
