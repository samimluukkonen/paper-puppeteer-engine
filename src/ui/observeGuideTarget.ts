import type { GuideRectangle, GuideTargetResolver } from '../devtools/shared/guides/types.js';
import { spotlightRectangle, type GuideViewport } from './guidePositioning.js';

export interface GuideTargetLayout {
  readonly rectangle: GuideRectangle | null;
  readonly viewport: GuideViewport;
}

/** One active-step lifetime. Polling also follows canvas providers, transforms, and moving panel dividers. */
export function observeGuideTarget(
  targets: GuideTargetResolver,
  targetId: string,
  onLayout: (layout: GuideTargetLayout) => void,
  view: Window = window,
): () => void {
  let frame = 0;
  let disposed = false;
  let attemptedReveal = true;
  let previous: string | undefined;
  // UI-only reveal is safe even for steps without an explicit preparation hint.
  targets.reveal(targetId);
  const measure = (): void => {
    if (disposed) return;
    const viewport = { width: view.innerWidth, height: view.innerHeight };
    const rectangle = spotlightRectangle(targets.resolve(targetId), viewport);
    if (!rectangle && !attemptedReveal) {
      attemptedReveal = true;
      targets.reveal(targetId);
    } else if (rectangle) attemptedReveal = false;
    const layout = { rectangle, viewport };
    const key = JSON.stringify(layout);
    if (key !== previous) {
      previous = key;
      onLayout(layout);
    }
  };
  const tick = (): void => {
    measure();
    if (!disposed) frame = view.requestAnimationFrame(tick);
  };
  view.addEventListener('resize', measure);
  view.addEventListener('scroll', measure, true);
  view.visualViewport?.addEventListener('resize', measure);
  view.visualViewport?.addEventListener('scroll', measure);
  tick();
  return () => {
    disposed = true;
    view.cancelAnimationFrame(frame);
    view.removeEventListener('resize', measure);
    view.removeEventListener('scroll', measure, true);
    view.visualViewport?.removeEventListener('resize', measure);
    view.visualViewport?.removeEventListener('scroll', measure);
  };
}
