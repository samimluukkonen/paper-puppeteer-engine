import { useRef, useState, useSyncExternalStore } from 'react';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import { AUTHORED_FPS_MAX, AUTHORED_FPS_MIN } from './AnimationEditorPlaybackCommands.js';
import type { NewAnimationController } from './NewAnimationController.js';

export function NewAnimationDialog({ controller }: { controller: NewAnimationController }) {
  const reason = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('1');
  const [fps, setFps] = useState('12');
  const [loop, setLoop] = useState(true);
  const [error, setError] = useState('');
  return (
    <>
      <button
        id="animation-new"
        data-guide-id={GUIDE_TARGETS.animationNew}
        type="button"
        className="workspace-primary"
        disabled={!!reason}
        title={reason || 'Create an empty animation for this rig'}
        aria-describedby="animation-new-reason"
        onClick={() => {
          setName('');
          setDuration('1');
          setFps('12');
          setLoop(true);
          setError('');
          dialog.current?.showModal();
        }}
      >
        + New Animation
      </button>
      <span id="animation-new-reason" className="editor-sr-only">
        {reason}
      </span>
      <dialog ref={dialog} id="animation-new-dialog" className="animation-dialog" aria-labelledby="animation-new-title">
        <h2 id="animation-new-title">Create new animation</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const message = controller.create({ name, durationSeconds: Number(duration), fps: Number(fps), loop });
            setError(message);
            if (!message) dialog.current?.close();
          }}
        >
          <label>
            Animation name / ID
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-describedby="animation-new-help"
            />
          </label>
          <p id="animation-new-help">
            The name is the stable animation ID. Use letters, numbers, - or _, for example sword-attack.
          </p>
          <label>
            Duration (seconds)
            <input
              type="number"
              required
              min="0"
              step="any"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          <label>
            Animation FPS
            <input
              type="number"
              required
              min={AUTHORED_FPS_MIN}
              max={AUTHORED_FPS_MAX}
              step="any"
              value={fps}
              onChange={(event) => setFps(event.target.value)}
            />
          </label>
          <p>FPS sets stepped playback. You can switch to smooth playback in Clip settings.</p>
          <label>
            <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /> Loop enabled
          </label>
          <p role="alert">{error || reason}</p>
          <div className="animation-history">
            <button type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" disabled={!!reason}>
              Create Animation
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
