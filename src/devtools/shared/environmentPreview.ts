import type { SceneImageDefinition } from '../../engine/SceneDefinition.js';

/** Session-only presentation. Never part of a rig, animation, Puppet or scene document. */
export interface EnvironmentPreviewSettings {
  readonly enabled: boolean;
  readonly image: string | null;
  readonly visible: boolean;
  /** Image center in animation preview-world pixels: +X right, +Y down. */
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export const DEFAULT_ENVIRONMENT_PREVIEW: EnvironmentPreviewSettings = Object.freeze({
  enabled: false,
  image: null,
  visible: true,
  x: 0,
  y: 0,
  scale: 1,
});

export function updateEnvironmentPreview(
  current: EnvironmentPreviewSettings,
  patch: Partial<EnvironmentPreviewSettings>,
): EnvironmentPreviewSettings {
  return Object.freeze({
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    image: patch.image === null || typeof patch.image === 'string' ? patch.image : current.image,
    visible: typeof patch.visible === 'boolean' ? patch.visible : current.visible,
    x: Number.isFinite(patch.x) ? patch.x! : current.x,
    y: Number.isFinite(patch.y) ? patch.y! : current.y,
    scale: Number.isFinite(patch.scale) && patch.scale! > 0 ? patch.scale! : current.scale,
  });
}

/** Adapter to the existing image renderer; no scene document or choreography is created. */
export function environmentPreviewImages(settings: EnvironmentPreviewSettings): readonly SceneImageDefinition[] {
  if (!settings.enabled || !settings.image || !settings.visible) return [];
  return [
    {
      id: 'environment-background',
      image: settings.image,
      position: { x: settings.x, y: settings.y },
      scale: { x: settings.scale, y: settings.scale },
      visible: true,
      order: 0,
    },
  ];
}
