import { useRef, useSyncExternalStore } from 'react';
import type { GroundGuideWorkspace } from '../shared/GroundGuideWorkspace.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { EnvironmentPreviewController, EnvironmentProjectImage } from './EnvironmentPreviewController.js';

export function EnvironmentPreviewToggle({
  controller,
  guideTargetId,
}: {
  controller: EnvironmentPreviewController;
  guideTargetId?: string;
}) {
  const { settings } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <label data-guide-id={guideTargetId}>
      <input
        type="checkbox"
        checked={settings.enabled}
        onChange={(event) => controller.update({ enabled: event.target.checked })}
      />{' '}
      Environment Preview
    </label>
  );
}

export function EnvironmentPreviewPanel({
  controller,
  ground,
  loadProjectImages,
  project,
}: {
  controller: EnvironmentPreviewController;
  ground: GroundGuideWorkspace;
  loadProjectImages?: (() => Promise<readonly EnvironmentProjectImage[]>) | undefined;
  project: boolean;
}) {
  const { settings, camera, busy, message, error, projectImages } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const { guide, workspaceId } = useSyncExternalStore(ground.subscribe, ground.getSnapshot);
  const input = useRef<HTMLInputElement>(null);
  const missing = !!settings.image && !controller.images.has(settings.image);
  return (
    <details className="environment-preview-panel">
      <summary>Environment Preview</summary>
      <EnvironmentPreviewToggle controller={controller} />
      <label>
        Background
        <select
          data-guide-id={GUIDE_TARGETS.animationEnvironmentBackground}
          aria-label="Background"
          value={settings.image ?? ''}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith('project:')) void controller.selectProjectImage(value.slice(8));
            else controller.update({ image: value || null });
          }}
        >
          <option value="">No background</option>
          {missing && <option value={settings.image ?? ''}>Missing image</option>}
          {projectImages.map((image) => (
            <option key={`project:${image.id}`} value={`project:${image.id}`}>
              {image.name} ({image.width} × {image.height})
            </option>
          ))}
          {controller.images.entries.map((asset) => (
            <option key={asset.reference} value={asset.reference}>
              {asset.name} ({asset.width} × {asset.height})
            </option>
          ))}
        </select>
      </label>
      <div className="animation-history" data-guide-id={GUIDE_TARGETS.animationEnvironmentImport}>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>
          Import Image
        </button>
        <button type="button" disabled={!settings.image && !busy} onClick={() => controller.clear()}>
          Clear background
        </button>
        {loadProjectImages && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void controller.loadProjectImages(loadProjectImages);
            }}
          >
            Load project character images
          </button>
        )}
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept=".png,.webp,image/png,image/webp"
        aria-label="Import environment image"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void controller.import(file);
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={settings.visible}
          onChange={(event) => controller.update({ visible: event.target.checked })}
        />{' '}
        Show background
      </label>
      <form
        data-guide-id={GUIDE_TARGETS.animationEnvironmentTransform}
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          controller.update({
            x: Number(values.get('x')),
            y: Number(values.get('y')),
            scale: Number(values.get('scale')),
          });
        }}
      >
        {(
          [
            ['Background X', 'x'],
            ['Background Y', 'y'],
            ['Scale', 'scale'],
          ] as const
        ).map(([label, key]) => (
          <label key={`${key}:${settings[key]}`}>
            {label}
            <input
              type="number"
              name={key}
              step="any"
              required
              defaultValue={settings[key]}
              {...(key === 'scale' ? { min: Number.MIN_VALUE } : {})}
            />
          </label>
        ))}
        <div className="animation-history">
          <button type="submit">Apply background transform</button>
          <button type="button" onClick={() => controller.resetTransform()}>
            Reset background transform
          </button>
        </div>
      </form>
      <label>
        <input
          type="checkbox"
          disabled={workspaceId === null}
          checked={guide.enabled}
          onChange={(event) => ground.update({ enabled: event.target.checked })}
        />{' '}
        Show Ground Reference
      </label>
      <button
        type="button"
        data-guide-id={GUIDE_TARGETS.animationEnvironmentGround}
        disabled={!settings.image || missing || !guide.enabled}
        onClick={() => controller.alignBottom(guide.y)}
      >
        Align image bottom to ground
      </button>
      <p className="workspace-caption">
        Position is the image center in preview-world pixels; X increases right, Y down. Align an interior floor with
        Background Y. Edit the shared guide in Ground Reference.
      </p>
      <details className="environment-camera-panel">
        <summary>Preview Camera</summary>
        <label>
          Mode
          <select
            data-guide-id={GUIDE_TARGETS.animationEnvironmentCameraMode}
            aria-label="Preview camera mode"
            value={camera.mode}
            onChange={(event) =>
              controller.updateCamera({ mode: event.target.value === 'follow' ? 'follow' : 'fixed' })
            }
          >
            <option value="fixed">Fixed</option>
            <option value="follow">Follow Character</option>
          </select>
        </label>
        <form
          data-guide-id={GUIDE_TARGETS.animationEnvironmentCameraTransform}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            controller.updateCamera({
              x: Number(values.get('cameraX')),
              y: Number(values.get('cameraY')),
              zoom: Number(values.get('zoom')),
            });
          }}
        >
          {(
            [
              ['Camera X', 'x', 'cameraX'],
              ['Camera Y', 'y', 'cameraY'],
              ['Zoom', 'zoom', 'zoom'],
            ] as const
          ).map(([label, key, name]) => (
            <label key={`${key}:${camera[key]}`}>
              {label}
              <input
                type="number"
                name={name}
                step="any"
                required
                defaultValue={camera[key]}
                {...(key === 'zoom' ? { min: 0.1, max: 4 } : {})}
              />
            </label>
          ))}
          <div className="animation-history">
            <button type="submit">Apply preview camera</button>
            <button type="button" onClick={() => controller.resetCamera()}>
              Reset Camera
            </button>
          </div>
        </form>
        <p className="workspace-caption">
          Camera X/Y set the world center. Follow adds the selected world displacement to that center. Pan and wheel
          zoom adjust the preview camera. Zoom out to 0.1 to inspect travel beyond the background; movement is never
          clamped.
        </p>
      </details>
      <p className="workspace-caption">
        Use the timeline's Play/Pause, Restart, speed, loop and scrub controls. Preview-only loops reset to their
        configured beginning. Authored root loops can reset or travel continuously, using Root Motion's loop behavior
        setting.
      </p>
      <button type="button" data-guide-id={GUIDE_TARGETS.animationEnvironmentReset} onClick={() => controller.reset()}>
        Reset Environment
      </button>
      <p className="workspace-caption">
        Background, camera, ground and clip displacement preferences are included in local recovery drafts.{' '}
        {project
          ? 'Download a project ZIP to keep preferences and shared images.'
          : 'Recover a local draft as a project, then export a project ZIP for a portable copy. Character ZIPs and animation JSON contain production data only.'}
      </p>
      {busy && <p role="status">Loading environment images…</p>}
      {message && <p role="status">{message}</p>}
      {(missing || error) && (
        <p role="alert">{missing ? 'Missing background image. Select or import another image.' : error}</p>
      )}
    </details>
  );
}
