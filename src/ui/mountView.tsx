import { useLayoutEffect, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { finishViewLoading } from './viewLoading.js';

type InitializeView = (app: HTMLElement) => () => void;

/** Initialize Phaser/controllers after React commits their hosts, and release them before removing the DOM. */
function ViewLifetime({
  app,
  initialize,
  children,
}: {
  app: HTMLElement;
  initialize: InitializeView;
  children: ReactNode;
}) {
  useLayoutEffect(() => initialize(app), [app, initialize]);
  return children;
}

export function mountView(app: HTMLElement, content: ReactNode, initialize: InitializeView): () => void {
  const root = createRoot(app);
  // Commit the initial hosts and setup before the entry module finishes, matching the page's load lifecycle.
  flushSync(() => {
    root.render(
      <ViewLifetime app={app} initialize={initialize}>
        {content}
      </ViewLifetime>,
    );
  });
  finishViewLoading();
  return () => root.unmount();
}
