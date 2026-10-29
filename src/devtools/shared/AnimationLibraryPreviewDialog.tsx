import { lazy, Suspense, type ComponentProps } from 'react';
import type { AnimationLibraryPreview as RuntimePreview } from './AnimationLibraryPreview.js';

export type { AnimationPreviewLease } from './AnimationLibraryPreview.js';

// Browsing and server-rendered inspector controls do not need Phaser or browser globals.
const Preview = lazy(() =>
  import('./AnimationLibraryPreview.js').then((module) => ({ default: module.AnimationLibraryPreview })),
);

export function AnimationLibraryPreview(props: ComponentProps<typeof RuntimePreview>) {
  return (
    <Suspense fallback={<p role="status">Loading animation preview…</p>}>
      <Preview {...props} />
    </Suspense>
  );
}
