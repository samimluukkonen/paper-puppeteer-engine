import { GuideController } from './GuideController.js';
import { type GuideRegistry, guideRegistry } from './registry.js';
import type { GuideAvailability, GuideCommandResult, GuideContext, GuideEditor } from './types.js';

export interface GuideLaunchHost {
  getContext(): GuideContext;
  getNavigationAvailability(editor: GuideEditor): GuideAvailability;
  navigate(editor: GuideEditor): boolean | 'cancel';
}

/** Connects the existing session controller to guarded workspace navigation. */
export class GuideLauncher {
  readonly controller: GuideController;

  constructor(
    private readonly host: GuideLaunchHost,
    readonly registry: GuideRegistry = guideRegistry,
  ) {
    this.controller = new GuideController(host.getContext(), registry);
  }

  readonly refresh = (): void => {
    this.controller.setContext(this.host.getContext());
  };

  getAvailability(id: string): GuideAvailability {
    const guide = this.registry.getGuideById(id);
    if (!guide) return { available: false, reason: `Guide not found: ${id}` };
    const availability = this.controller.getAvailability(id);
    if (!availability.available) return availability;
    if (this.controller.getSnapshot().status === 'active')
      return { available: false, reason: 'Exit the current guide before starting another.' };
    return this.host.getNavigationAvailability(guide.editor);
  }

  getPrerequisiteGuide(id: string) {
    const guide = this.registry.getGuideById(id);
    const context = this.controller.getSnapshot().context;
    const missing = [...(guide?.prerequisites ?? []), ...(guide?.steps[0]?.prerequisites ?? [])].find(
      (item) => !context.capabilities.includes(item.capability),
    );
    return missing?.guideId ? this.registry.getGuideById(missing.guideId) : undefined;
  }

  launch(id: string): GuideCommandResult {
    // Always read current facts again: catalog rendering is not permission to launch later.
    this.refresh();
    const availability = this.getAvailability(id);
    if (!availability.available) return { ok: false, reason: availability.reason };
    const guide = this.registry.getGuideById(id)!;
    const navigated = this.host.navigate(guide.editor);
    if (navigated !== true)
      return { ok: false, reason: navigated === 'cancel' ? 'Editor navigation was canceled.' : 'Editor is not ready.' };
    this.refresh();
    return this.controller.start(id);
  }
}
