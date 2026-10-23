import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { AnimationVariationController } from './AnimationVariationController.js';

export function AnimationVariationDialog({ controller }: { controller: AnimationVariationController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [scale, setScale] = useState('1');
  const [progress, setProgress] = useState('0');
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.close();
    controller.cancel();
  }, [controller, snapshot.source, snapshot.revision, snapshot.reason, snapshot.rig]);
  useEffect(() => () => controller.cancel(), [controller]);

  return (
    <>
      <button
        id="animation-variation"
        data-guide-id={GUIDE_TARGETS.animationVariation}
        type="button"
        disabled={!!snapshot.reason}
        title={snapshot.reason || 'Create an independent copy of the current authored animation'}
        onClick={() => {
          const suggested = controller.begin();
          if (!suggested) return;
          setName(suggested);
          setScale('1');
          setProgress('0');
          setError('');
          dialog.current?.showModal();
        }}
      >
        Create Variation
      </button>
      <dialog
        ref={dialog}
        id="animation-variation-dialog"
        className="animation-dialog animation-variation-dialog"
        aria-labelledby="animation-variation-title"
        onCancel={() => controller.cancel()}
        onClose={() => controller.cancel()}
      >
        <h2 id="animation-variation-title">Create animation variation</h2>
        <p>Source: {snapshot.source?.name}</p>
        <form
          className="animation-session"
          onSubmit={(event) => {
            event.preventDefault();
            const message = controller.create({ name, timeScale: Number(scale) });
            setError(message);
            if (!message) dialog.current?.close();
          }}
        >
          <label>
            New name / ID
            <input
              required
              value={name}
              aria-describedby="animation-variation-help"
              onChange={(event) => {
                controller.cancelPreview();
                setName(event.target.value);
              }}
            />
          </label>
          <p id="animation-variation-help">The name is the stable animation ID. Use letters, numbers, - or _.</p>
          <label>
            Time scale
            <input
              type="number"
              required
              min="0"
              step="any"
              value={scale}
              onChange={(event) => {
                setScale(event.target.value);
                setError(controller.preview({ name, timeScale: Number(event.target.value) }, Number(progress)));
              }}
            />
          </label>
          <p>
            1 keeps timing; 2 doubles duration; 0.5 plays twice as fast. Bone keys, IK keys and events scale together.
          </p>
          <label>
            Preview position
            <input
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={progress}
              onChange={(event) => {
                setProgress(event.target.value);
                setError(controller.preview({ name, timeScale: Number(scale) }, Number(event.target.value)));
              }}
            />
          </label>
          <p>Scrub to preview on the canvas. Cancel discards the temporary preview.</p>
          <p role="alert">{error || snapshot.reason}</p>
          <div className="animation-history">
            <button type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="workspace-primary" disabled={!!snapshot.reason}>
              Create Variation
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
