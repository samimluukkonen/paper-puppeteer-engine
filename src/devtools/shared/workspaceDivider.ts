/** Shared desktop workspace splitter input, with pointer capture and keyboard controls. */
export function bindWorkspaceDivider(
  element: HTMLElement,
  axis: 'x' | 'y',
  move: (coordinate: number) => void,
  key: (key: string) => boolean,
  signal: AbortSignal,
): void {
  const options = { signal };
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
  signal.addEventListener('abort', release, { once: true });
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
