import { GUIDE_TARGETS as targets } from '../shared/guides/anchors.js';
import { GuideTargets } from '../shared/guides/GuideTargets.js';

/** Reveal the correct view, then reuse ordinary DOM clipping, disclosures and scrolling. */
export function registerGraphGuideTargets(
  app: HTMLElement,
  guides: GuideTargets,
  revealView: (graph: boolean) => void,
): () => void {
  const dom = new GuideTargets(app);
  const graph: readonly string[] = [
    targets.animationGraphProperty,
    targets.animationGraphCanvas,
    targets.animationGraphInterpolation,
    targets.animationGraphTangents,
    targets.animationGraphKeys,
    targets.animationGraphNavigation,
  ];
  const timeline = [
    targets.animationRuler,
    targets.animationTracks,
    targets.animationZoom,
    targets.animationTrackNavigation,
    targets.animationKeyEditing,
  ];
  const releases = [...graph, ...timeline].map((id) =>
    guides.registerGeometry(id, {
      getRectangle: () => dom.resolve(id),
      getElement: () => dom.resolveElement(id),
      reveal: () => {
        // A tour cannot unhide an inactive editor or fabricate a missing target.
        if (app.closest('[hidden], [inert]') || !dom.resolveElement(id)) return false;
        revealView(graph.includes(id));
        return dom.reveal(id);
      },
    }),
  );
  return () => {
    for (const release of releases) release();
  };
}
