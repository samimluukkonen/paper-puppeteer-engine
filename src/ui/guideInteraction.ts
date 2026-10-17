/** Restrict practice to a live real target and guide card. No editor commands or synthetic input. */
export function containGuideInteraction(
  overlay: HTMLElement,
  getTarget: () => Element | null,
  onExit: () => void,
): () => void {
  const doc = overlay.ownerDocument;
  const ownedInert = new Set<Element>();
  const releaseInert = (): void => {
    for (const element of ownedInert) element.removeAttribute('inert');
    ownedInert.clear();
  };
  const update = (): void => {
    releaseInert();
    const target = getTarget();
    const visit = (parent: Element): void => {
      for (const child of parent.children) {
        if (child === overlay || child === target || child.hasAttribute('inert')) continue;
        if (child.contains(overlay) || (target && child.contains(target))) visit(child);
        else {
          child.setAttribute('inert', '');
          ownedInert.add(child);
        }
      }
    };
    visit(doc.body);
  };
  const visibleTarget = (): Element | null => {
    const target = getTarget();
    if (!target?.isConnected || target.closest('[hidden], [inert]') || !target.getClientRects().length) return null;
    const visibility = doc.defaultView?.getComputedStyle(target).visibility;
    return visibility === 'hidden' || visibility === 'collapse' ? null : target;
  };
  const allowed = (node: EventTarget | null): boolean =>
    node instanceof Node && (overlay.contains(node) || !!visibleTarget()?.contains(node));
  const block = (event: Event): void => {
    if (allowed(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const focusable = (): HTMLElement[] =>
    [visibleTarget(), overlay].flatMap((root) => {
      if (!root) return [];
      const selector = 'button, input, select, textarea, a[href], summary, [tabindex]';
      const elements = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
      return elements.filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          element.tabIndex >= 0 &&
          !element.matches(':disabled') &&
          !element.closest('[inert], [hidden]') &&
          !!element.getClientRects().length,
      );
    });
  const keys = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      onExit();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const elements = focusable();
      const index = elements.indexOf(doc.activeElement as HTMLElement);
      const next = event.shiftKey ? (index <= 0 ? elements.length - 1 : index - 1) : (index + 1) % elements.length;
      elements[next]?.focus({ preventScroll: true });
    } else if (!allowed(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
      // Editor-wide shortcuts must not undo or mutate unrelated project data during practice.
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const focus = (event: FocusEvent): void => {
    if (!allowed(event.target)) overlay.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  };
  const stopGlobalKeys = (event: KeyboardEvent): void => event.stopPropagation();
  const observer = new MutationObserver(update);
  update();
  observer.observe(doc.body, { childList: true, subtree: true });
  for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel'])
    doc.addEventListener(type, block, { capture: true, passive: false });
  doc.addEventListener('keydown', keys, true);
  doc.addEventListener('keydown', stopGlobalKeys);
  doc.addEventListener('keyup', stopGlobalKeys);
  doc.addEventListener('keyup', block, true);
  doc.addEventListener('focusin', focus, true);
  return () => {
    observer.disconnect();
    releaseInert();
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel'])
      doc.removeEventListener(type, block, true);
    doc.removeEventListener('keydown', keys, true);
    doc.removeEventListener('keydown', stopGlobalKeys);
    doc.removeEventListener('keyup', stopGlobalKeys);
    doc.removeEventListener('keyup', block, true);
    doc.removeEventListener('focusin', focus, true);
  };
}
