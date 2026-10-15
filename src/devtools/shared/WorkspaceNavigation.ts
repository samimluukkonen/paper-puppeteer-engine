export type WorkspaceView = 'rig' | 'animation';

export function workspaceView(url: URL): WorkspaceView | null {
  if (/\/rig-editor\/?$/.test(url.pathname)) return 'rig';
  if (/\/animation-editor\/?$/.test(url.pathname)) return 'animation';
  return null;
}

/** Editor routes share a live owner. All other navigation uses the browser's unsaved guard. */
export function bindWorkspaceNavigation(
  host: HTMLElement,
  navigate: (view: WorkspaceView) => boolean | 'cancel',
): () => void {
  const lifetime = new AbortController();
  let heldUrl = window.location.href;
  const options = { signal: lifetime.signal };
  host.addEventListener(
    'click',
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.view-navigation a') : null;
      if (!link || link.target || link.hasAttribute('download')) return;
      const url = new URL(link.href);
      const current = new URL(window.location.href);
      const view = workspaceView(url);
      if (!view || url.origin !== current.origin || url.search !== current.search) return;
      const result = navigate(view);
      if (!result) return;
      event.preventDefault();
      if (result === 'cancel') return;
      if (url.href !== current.href) window.history.pushState(null, '', url.href);
      heldUrl = url.href;
    },
    options,
  );
  window.addEventListener(
    'popstate',
    () => {
      const view = workspaceView(new URL(window.location.href));
      if (view) {
        if (navigate(view) === 'cancel') window.history.pushState(null, '', heldUrl);
        else heldUrl = window.location.href;
      }
    },
    options,
  );
  return () => lifetime.abort();
}
