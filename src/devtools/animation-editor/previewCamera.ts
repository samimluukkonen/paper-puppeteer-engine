import { CHARACTER_PREVIEW_ORIGIN } from '../shared/previewPlacement.js';

export interface PreviewCameraSettings {
  readonly mode: 'fixed' | 'follow';
  /** World center at the character's undisplaced preview origin. */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export const DEFAULT_PREVIEW_CAMERA: PreviewCameraSettings = Object.freeze({
  mode: 'fixed',
  ...CHARACTER_PREVIEW_ORIGIN,
  zoom: 1,
});

export function updatePreviewCamera(current: PreviewCameraSettings, patch: Partial<PreviewCameraSettings>) {
  return Object.freeze({
    mode: patch.mode === 'fixed' || patch.mode === 'follow' ? patch.mode : current.mode,
    x: Number.isFinite(patch.x) ? patch.x! : current.x,
    y: Number.isFinite(patch.y) ? patch.y! : current.y,
    zoom: Number.isFinite(patch.zoom) ? Math.max(0.1, Math.min(4, patch.zoom!)) : current.zoom,
  });
}

export function previewCameraCenter(settings: PreviewCameraSettings, displacement: { x: number; y: number }) {
  return {
    x: settings.x + (settings.mode === 'follow' ? displacement.x : 0),
    y: settings.y + (settings.mode === 'follow' ? displacement.y : 0),
  };
}
