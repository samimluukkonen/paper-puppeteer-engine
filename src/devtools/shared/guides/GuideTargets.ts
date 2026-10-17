import type { GuideRectangle, GuideTargetId, GuideTargetResolver } from './types.js';

export interface GuideGeometryProvider {
  /** Convert editor/Phaser geometry to viewport CSS pixels; return null while unavailable. */
  getRectangle(): GuideRectangle | null;
  /** Optional UI-only panel/tab reveal, never a scene command or authored action. */
  reveal?(): boolean;
}

function rectangle(value: GuideRectangle | null): GuideRectangle | null {
  if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite)) return null;
  if (value.width <= 0 || value.height <= 0) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

/** One editor-scoped resolver for DOM controls, whole panels, and opt-in canvas geometry. No Phaser imports. */
export class GuideTargets implements GuideTargetResolver {
  private readonly geometry = new Map<GuideTargetId, { provider: GuideGeometryProvider }>();

  constructor(private readonly root: ParentNode) {}

  registerGeometry(id: GuideTargetId, provider: GuideGeometryProvider): () => void {
    if (!id.trim() || this.geometry.has(id)) throw new Error(`Invalid or duplicate geometry target: ${id}`);
    const registration = { provider };
    this.geometry.set(id, registration);
    return () => {
      if (this.geometry.get(id) === registration) this.geometry.delete(id);
    };
  }

  resolve(id: GuideTargetId): GuideRectangle | null {
    try {
      // An explicit provider owns its ID, including its temporarily missing state.
      const provider = this.geometry.get(id)?.provider;
      if (provider) return rectangle(provider.getRectangle());
      const element = this.findElement(id);
      if (!element || element.closest('[hidden], [inert]') || !element.getClientRects().length) return null;
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      if (style?.visibility === 'hidden' || style?.visibility === 'collapse') return null;
      let bounds = rectangle(element.getBoundingClientRect());
      // A scroll container can hide part (or all) of an otherwise laid-out DOM target.
      for (let parent = element.parentElement; bounds && parent; parent = parent.parentElement) {
        const overflow = parent.ownerDocument.defaultView?.getComputedStyle(parent);
        const clipX = /^(auto|scroll|hidden|clip)$/.test(overflow?.overflowX ?? '');
        const clipY = /^(auto|scroll|hidden|clip)$/.test(overflow?.overflowY ?? '');
        if (!clipX && !clipY) continue;
        const clip = parent.getBoundingClientRect();
        const x = clipX ? Math.max(bounds.x, clip.x) : bounds.x;
        const y = clipY ? Math.max(bounds.y, clip.y) : bounds.y;
        bounds = rectangle({
          x,
          y,
          width: (clipX ? Math.min(bounds.x + bounds.width, clip.right) : bounds.x + bounds.width) - x,
          height: (clipY ? Math.min(bounds.y + bounds.height, clip.bottom) : bounds.y + bounds.height) - y,
        });
      }
      return bounds;
    } catch {
      // Disposed providers and transient editor layout are missing targets, not tour crashes.
      return null;
    }
  }

  reveal(id: GuideTargetId): boolean {
    try {
      const provider = this.geometry.get(id)?.provider;
      if (provider) return provider.reveal?.() ?? false;
      const element = this.findElement(id);
      if (!element || element.closest('[hidden]')) return false;
      // Reuse the workspace's UI-only drawer event. React may commit it on the next render.
      const inspector = element.closest('[data-guide-inspector]');
      inspector?.closest('.workspace-shell')?.dispatchEvent(new CustomEvent('workspace:reveal-inspector'));
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === 'DETAILS') ancestor.setAttribute('open', '');
      }
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      return true;
    } catch {
      return false;
    }
  }

  private findElement(id: GuideTargetId): Element | null {
    // Match attribute values directly: IDs need no CSS escaping and cannot inject a selector.
    const matches = Array.from(this.root.querySelectorAll('[data-guide-id]')).filter(
      (element) => element.getAttribute('data-guide-id') === id,
    );
    // Duplicate anchors are a broken contract; never highlight an arbitrary editor control.
    return matches.length === 1 ? matches[0]! : null;
  }
}
