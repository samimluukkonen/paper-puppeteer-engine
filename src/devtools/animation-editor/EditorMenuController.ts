/** Dismiss and position disclosures without changing editor selection or document state. */
export class EditorMenuController {
  private readonly abort = new AbortController();
  private readonly menuResize: ResizeObserver;
  private contextSource: HTMLElement | undefined;

  constructor(private readonly app: HTMLElement) {
    this.menuResize = new ResizeObserver((entries) => {
      if (this.contextSource) return;
      for (const entry of entries) {
        const menu = entry.target.closest<HTMLDetailsElement>('[data-workspace-menu]');
        if (menu?.open) this.position(menu);
      }
    });
    const options = { signal: this.abort.signal };
    app.addEventListener(
      'toggle',
      (event) => {
        const menu = event.target;
        if (!(menu instanceof HTMLDetailsElement) || !menu.matches('[data-workspace-menu]') || !menu.open) return;
        this.closeOthers(menu);
        if (!this.contextSource) this.position(menu);
        this.menuResize.observe(menu.querySelector('.animation-menu-content')!);
      },
      { ...options, capture: true },
    );
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!(event.target instanceof Node)) return;
        if (event.target instanceof Element && event.target.closest('dialog')) return;
        for (const menu of this.openMenus()) if (!menu.contains(event.target)) this.close(menu);
      },
      options,
    );
    app.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || event.isComposing || app.querySelector('dialog[open]')) return;
        // Let Escape dismiss a select picker before closing its containing menu.
        if (CSS.supports('selector(select:open)') && app.querySelector('select:open')) return;
        const menu = this.openMenus()[0];
        if (!menu) return;
        event.preventDefault();
        event.stopPropagation();
        this.close(menu, true);
      },
      { ...options, capture: true },
    );
    app.addEventListener(
      'focusout',
      (event) => {
        // During blur, activeElement can briefly be body before the next control receives focus.
        const next = event.relatedTarget;
        if (!(next instanceof Node) || app.querySelector('dialog[open]')) return;
        for (const menu of this.openMenus()) if (!menu.contains(next)) this.close(menu);
      },
      options,
    );
    app.addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest<HTMLButtonElement>('button');
        if (!button) return;
        const menu = button.closest<HTMLDetailsElement>('[data-workspace-menu]');
        const panelId = button.dataset.openPanel;
        if (panelId) {
          const panel = app.querySelector<HTMLDetailsElement>(`#${panelId}`)!;
          for (const other of app.querySelectorAll<HTMLDetailsElement>('[data-tool-panel]'))
            if (other !== panel) other.open = false;
          panel.open = true;
          if (menu) this.close(menu);
          panel.querySelector<HTMLButtonElement>('[data-close-panel]')!.focus({ preventScroll: true });
        } else if (button.hasAttribute('data-close-panel')) {
          button.closest<HTMLDetailsElement>('[data-tool-panel]')!.open = false;
          app.querySelector<HTMLElement>('#animation-authoring-tools > summary')!.focus({ preventScroll: true });
        } else if (menu && !app.querySelector('dialog[open]')) {
          // Return focus to the disclosure or the marker that opened the context commands.
          this.close(menu, true);
        }
      },
      options,
    );
    app.addEventListener(
      'contextmenu',
      (event) => {
        if (event.defaultPrevented || event.ctrlKey) return;
        if (!(event.target instanceof Element)) return;
        const marker = event.target.closest<HTMLElement>('.timeline-keyframe, .timeline-event');
        if (!marker) return;
        event.preventDefault();
        const menu = app.querySelector<HTMLDetailsElement>('#timeline-edit-menu')!;
        this.closeOthers(menu);
        this.contextSource = marker;
        menu.open = true;
        const bounds = marker.getBoundingClientRect();
        this.position(menu, event.clientX || bounds.left, event.clientY || bounds.bottom);
        menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
      },
      options,
    );
    const dismiss = (): void => {
      for (const menu of this.openMenus()) this.close(menu);
    };
    window.addEventListener('resize', dismiss, options);
    // Dismiss on deliberate scrolling, not scrolling caused by focusing a fixed menu item.
    app.addEventListener(
      'wheel',
      (event) => {
        if (event.target instanceof Element && event.target.closest('.animation-menu-content')) return;
        dismiss();
      },
      { ...options, capture: true },
    );
  }

  private openMenus(): HTMLDetailsElement[] {
    return Array.from(this.app.querySelectorAll<HTMLDetailsElement>('[data-workspace-menu][open]'));
  }

  private closeOthers(held: HTMLDetailsElement): void {
    for (const menu of this.openMenus()) if (menu !== held) this.close(menu);
  }

  private close(menu: HTMLDetailsElement, restoreFocus = false): void {
    const content = menu.querySelector('.animation-menu-content');
    if (content) this.menuResize.unobserve(content);
    menu.open = false;
    const target = this.contextSource?.isConnected ? this.contextSource : menu.querySelector<HTMLElement>('summary');
    this.contextSource = undefined;
    if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true });
  }

  private position(menu: HTMLDetailsElement, x?: number, y?: number): void {
    const content = menu.querySelector<HTMLElement>('.animation-menu-content')!;
    const anchor = menu.querySelector('summary')!.getBoundingClientRect();
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    const preferredTop = y ?? anchor.bottom + 4;
    const top = preferredTop + height <= window.innerHeight - 8 ? preferredTop : (y ?? anchor.top) - height - 4;
    content.style.left = `${Math.max(8, Math.min(x ?? anchor.left, window.innerWidth - width - 8))}px`;
    content.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
  }

  dispose(): void {
    this.abort.abort();
    this.menuResize.disconnect();
    for (const menu of this.openMenus()) this.close(menu);
  }
}
