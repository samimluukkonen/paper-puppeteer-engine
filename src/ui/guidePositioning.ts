import type { GuideRectangle } from '../devtools/shared/guides/types.js';

export interface GuideViewport {
  readonly width: number;
  readonly height: number;
}

/** Clip to the visible viewport; an offscreen target needs reveal/fallback, not an invisible hole. */
export function spotlightRectangle(rect: GuideRectangle | null, viewport: GuideViewport): GuideRectangle | null {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(viewport.width, rect.x + rect.width);
  const bottom = Math.min(viewport.height, rect.y + rect.height);
  if (right <= x || bottom <= y) return null;
  const padding = 4;
  return {
    x: Math.max(0, x - padding),
    y: Math.max(0, y - padding),
    width: Math.min(viewport.width, right + padding) - Math.max(0, x - padding),
    height: Math.min(viewport.height, bottom + padding) - Math.max(0, y - padding),
  };
}

/** Prefer a side with room, then minimize overlap when a large panel fills the viewport. */
export function placeGuideCard(
  target: GuideRectangle | null,
  card: GuideViewport,
  viewport: GuideViewport,
): { left: number; top: number } {
  const margin = 16;
  const gap = 16;
  const clamp = (value: number, size: number, limit: number): number =>
    Math.max(margin, Math.min(value, limit - size - margin));
  const centered = { left: (viewport.width - card.width) / 2, top: (viewport.height - card.height) / 2 };
  if (!target)
    return {
      left: clamp(centered.left, card.width, viewport.width),
      top: clamp(centered.top, card.height, viewport.height),
    };
  const candidates = [
    { left: target.x + target.width + gap, top: target.y },
    { left: target.x - card.width - gap, top: target.y },
    { left: target.x, top: target.y + target.height + gap },
    { left: target.x, top: target.y - card.height - gap },
  ].map((point) => ({
    left: clamp(point.left, card.width, viewport.width),
    top: clamp(point.top, card.height, viewport.height),
  }));
  const overlap = (point: { left: number; top: number }): number =>
    Math.max(0, Math.min(point.left + card.width, target.x + target.width) - Math.max(point.left, target.x)) *
    Math.max(0, Math.min(point.top + card.height, target.y + target.height) - Math.max(point.top, target.y));
  return candidates.reduce((best, candidate) => (overlap(candidate) < overlap(best) ? candidate : best));
}
