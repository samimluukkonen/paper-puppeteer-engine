import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { projectEditorContext } from '../project/projectBridge.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';

/** Collapsed inspector uses the same binary registry as project imports and recovery. */
export function SceneArtworkPanel({ document }: { document: SceneEditorDocument }) {
  useSyncExternalStore(document.images.subscribe, document.images.getSnapshot, document.images.getSnapshot);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [replacement, setReplacement] = useState(false);
  const [projectImages, setProjectImages] = useState<
    readonly { id: string; name: string; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }[]
  >([]);
  const [message, setMessage] = useState('');
  const scene = document.workingScene;
  const selected = scene?.images?.find((image) => image.id === document.selectedImageId);
  const assets = document.images.entries;
  useEffect(() => () => request.current?.abort(), []);
  const run = (operation: (signal: AbortSignal) => Promise<void>): void => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage('');
    void operation(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) document.reportError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
        if (request.current === controller) request.current = null;
      });
  };
  return (
    <details className="scene-artwork">
      <summary>Scene Artwork ({scene?.images?.length ?? 0})</summary>
      <div className="scene-artwork-commands">
        <button
          type="button"
          className="workspace-primary"
          disabled={busy}
          onClick={() => {
            setReplacement(false);
            input.current?.click();
          }}
        >
          + Add Background
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setReplacement(false);
            setChoosing(true);
            run(async (signal) => {
              const choices = await projectEditorContext()?.loadProjectImages?.();
              signal.throwIfAborted();
              setProjectImages(choices ?? []);
            });
          }}
        >
          + Add Image From Project
        </button>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept=".png,.webp,image/png,image/webp"
        aria-label="Import scene artwork"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file || !scene) return;
          const sceneId = scene.id;
          const imageId = replacement ? selected?.id : undefined;
          run(async (signal) => {
            const reference = await document.images.import(file, signal);
            signal.throwIfAborted();
            if (document.selectedSceneId !== sceneId) return;
            if (imageId) document.updateImage(imageId, { image: reference });
            else document.addImage(reference);
            setMessage(`${file.name} imported. Download a project or scene package to save the image with the scene.`);
          });
        }}
      />
      {choosing && (
        <label>
          Project image
          <select
            aria-label="Project image"
            defaultValue=""
            disabled={busy}
            onChange={(event) => {
              if (!event.target.value) return;
              const choice = projectImages.find((image) => `project:${image.id}` === event.target.value);
              const value = event.target.value;
              run(async (signal) => {
                const reference = choice ? await document.images.add(choice.bytes, choice.name, signal) : value;
                signal.throwIfAborted();
                if (replacement && selected) document.updateImage(selected.id, { image: reference });
                else document.addImage(reference);
                setChoosing(false);
                setProjectImages([]);
              });
            }}
          >
            <option value="">
              {assets.length || projectImages.length
                ? 'Choose an image'
                : 'Import a background to start the image library'}
            </option>
            {assets.map((asset) => (
              <option key={asset.reference} value={asset.reference}>
                {asset.name} ({asset.width} × {asset.height})
              </option>
            ))}
            {projectImages.map((image) => (
              <option key={image.id} value={`project:${image.id}`}>
                {image.name} ({image.width} × {image.height})
              </option>
            ))}
          </select>
        </label>
      )}
      <ul className="scene-artwork-list" aria-label="Scene backgrounds">
        {(scene?.images ?? []).map((image) => (
          <li key={image.id}>
            <button
              type="button"
              aria-pressed={selected?.id === image.id}
              onClick={() => document.selectImage(image.id)}
            >
              {assets.find((asset) => asset.reference === image.image)?.name ?? image.image} · {image.id}
              {!image.visible && ' (hidden)'}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <form
          key={selected.id}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            document.endImageDrag();
            document.updateImage(selected.id, {
              position: { x: Number(values.get('x')), y: Number(values.get('y')) },
              scale: { x: Number(values.get('scaleX')), y: Number(values.get('scaleY')) },
            });
          }}
        >
          <p className="workspace-caption">
            Selected image: {selected.id}. Position is the image center in scene pixels.
          </p>
          {(
            [
              ['Position X', 'x', selected.position.x],
              ['Position Y', 'y', selected.position.y],
              ['Scale X', 'scaleX', selected.scale.x],
              ['Scale Y', 'scaleY', selected.scale.y],
            ] as const
          ).map(([label, name, value]) => (
            <label key={`${selected.id}-${name}-${value}`}>
              {label}
              <input
                type="number"
                name={name}
                step="any"
                required
                defaultValue={value}
                {...(name.startsWith('scale') ? { min: Number.MIN_VALUE } : {})}
              />
            </label>
          ))}
          <button type="submit">Apply image transform</button>
          <label className="scene-artwork-visibility">
            <input
              type="checkbox"
              checked={selected.visible}
              onChange={(event) => document.updateImage(selected.id, { visible: event.target.checked })}
            />{' '}
            Visible
          </label>
          {!document.images.has(selected.image) && <p role="alert">Missing image. Replace it before exporting.</p>}
          <div className="scene-artwork-commands">
            <button
              type="button"
              onClick={() => document.updateImage(selected.id, { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } })}
            >
              Reset transforms
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setReplacement(true);
                input.current?.click();
              }}
            >
              Replace Image
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setReplacement(true);
                setChoosing(true);
              }}
            >
              Replace from project
            </button>
            <button type="button" className="workspace-danger" onClick={() => document.removeImage(selected.id)}>
              Remove Element
            </button>
          </div>
        </form>
      )}
      <button
        type="button"
        className="workspace-danger"
        disabled={busy}
        onClick={() =>
          setMessage(`${document.cleanupImages()} unused image assets removed. Undo/Redo dependencies are retained.`)
        }
      >
        Clean unused images
      </button>
      {busy && <p role="status">Loading artwork…</p>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
