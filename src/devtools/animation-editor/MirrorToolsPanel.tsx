import { useEffect, useRef, useSyncExternalStore } from 'react';
import { isTypingTarget } from '../../shared/keyboardShortcuts.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { MirrorDirection } from '../shared/poseMirroring.js';
import type { MirrorToolsController } from './MirrorToolsController.js';

export const MIRROR_DIRECTIONS: readonly { value: MirrorDirection; label: string; help: string }[] = [
  {
    value: 'left-to-right',
    label: 'Left → Right',
    help: 'Source: Left. Destination: Right. Right-side authored keys may be replaced.',
  },
  {
    value: 'right-to-left',
    label: 'Right → Left',
    help: 'Source: Right. Destination: Left. Left-side authored keys may be replaced.',
  },
  {
    value: 'swap',
    label: 'Swap',
    help: 'Source and destination: both sides. Each side receives the other side’s original values.',
  },
];

/** React owns every child of this panel; editor selection and clock come from the controller subscription. */
export function MirrorToolsPanel({ controller }: { controller: MirrorToolsController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isTypingTarget(event.target) ||
        event.key.toLowerCase() !== 'm'
      )
        return;
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('.animation-workspace') ||
        event.target.closest('dialog')
      )
        return;
      if (controller.getSnapshot().poseReason && !controller.getSnapshot().preview) return;
      event.preventDefault();
      if (panel.current) panel.current.open = true;
      controller.togglePreview();
    };
    window.addEventListener('keydown', shortcut);
    return () => {
      window.removeEventListener('keydown', shortcut);
      controller.hidePreview();
    };
  }, [controller]);
  const direction = MIRROR_DIRECTIONS.find((entry) => entry.value === state.direction)!;
  const options = state.boneIds.map((id) => (
    <option key={id} value={id}>
      {id}
    </option>
  ));
  return (
    <details
      id="animation-mirror-panel"
      data-tool-panel
      ref={panel}
      className="animation-popover animation-mirror-tools"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && controller.getSnapshot().preview) {
          event.preventDefault();
          event.stopPropagation();
          controller.togglePreview();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.open = false;
          document.querySelector<HTMLElement>('#animation-authoring-tools > summary')?.focus();
        }
      }}
      onToggle={(event) => {
        if (!event.currentTarget.open && controller.getSnapshot().preview) controller.togglePreview();
      }}
    >
      <summary>Mirror tools</summary>
      <section
        data-guide-id={GUIDE_TARGETS.animationMirror}
        className="animation-popover-content animation-mirror-panel"
        aria-label="Mirror tools"
      >
        <div className="animation-tool-heading">
          <h2>Mirror tools</h2>
          <button type="button" data-close-panel aria-label="Close Mirror tools">
            Close
          </button>
        </div>
        <details data-guide-id={GUIDE_TARGETS.animationMirrorPairs}>
          <summary>Configure Bone Pairs</summary>
          <p>Left and right use rig bone IDs, independently of preview facing. Changes are editor preferences.</p>
          <div className="animation-mirror-pairs">
            {state.pairs.map((pair, index) => (
              <div key={index} className="animation-mirror-pair">
                <label>
                  Left {index + 1}
                  <select
                    aria-label={`Left bone ${index + 1}`}
                    value={pair.leftBoneId}
                    onChange={(event) =>
                      controller.setPairs(
                        state.pairs.map((entry, row) =>
                          row === index ? { ...entry, leftBoneId: event.target.value } : entry,
                        ),
                      )
                    }
                  >
                    <option value="">Choose left bone</option>
                    {options}
                  </select>
                </label>
                <span aria-hidden="true">↔</span>
                <label>
                  Right {index + 1}
                  <select
                    aria-label={`Right bone ${index + 1}`}
                    value={pair.rightBoneId}
                    onChange={(event) =>
                      controller.setPairs(
                        state.pairs.map((entry, row) =>
                          row === index ? { ...entry, rightBoneId: event.target.value } : entry,
                        ),
                      )
                    }
                  >
                    <option value="">Choose right bone</option>
                    {options}
                  </select>
                </label>
                <button
                  type="button"
                  aria-label={`Remove pair ${index + 1}`}
                  onClick={() => controller.setPairs(state.pairs.filter((_entry, row) => row !== index))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="animation-history">
            <button
              type="button"
              disabled={!state.ready}
              onClick={() => controller.setPairs([...state.pairs, { leftBoneId: '', rightBoneId: '' }])}
            >
              Add pair
            </button>
            <button type="button" disabled={!state.ready} onClick={() => controller.inferPairs()}>
              Use inferred pairs
            </button>
          </div>
          <p>Unpaired bones: {state.unpaired.join(', ') || 'None'}</p>
          <p>{state.persistence || 'Valid pair changes are saved in this browser for the same rig.'}</p>
        </details>
        {state.mappingErrors.length > 0 && <p role="alert">{state.mappingErrors.join(' ')}</p>}
        <fieldset data-guide-id={GUIDE_TARGETS.animationMirrorDirection} className="animation-mirror-directions">
          <legend>Direction</legend>
          {MIRROR_DIRECTIONS.map((entry) => (
            <label key={entry.value}>
              <input
                type="radio"
                name="animation-mirror-direction"
                value={entry.value}
                checked={state.direction === entry.value}
                onChange={() => controller.setDirection(entry.value)}
              />{' '}
              {entry.label}
            </label>
          ))}
        </fieldset>
        <p className="animation-mirror-destination">{direction.help}</p>
        <p>{state.scope} Only authored source properties are copied; temporary edits and IK are excluded.</p>
        <div data-guide-id={GUIDE_TARGETS.animationMirrorActions} className="animation-mirror-actions">
          <button
            type="button"
            disabled={!!state.poseReason && !state.preview}
            aria-pressed={state.preview}
            aria-keyshortcuts="M"
            title="Toggle mirrored preview (M)"
            aria-describedby="animation-mirror-pose-reason"
            onClick={() => controller.togglePreview()}
          >
            {state.preview ? 'Hide Mirrored Preview' : 'Preview Mirrored Pose'}
          </button>
          <button
            type="button"
            disabled={!!state.poseReason}
            aria-describedby="animation-mirror-pose-reason"
            onClick={() => controller.commitPose()}
          >
            Mirror Current Pose
          </button>
          <button
            type="button"
            disabled={!!state.keysReason}
            aria-describedby="animation-mirror-keys-reason"
            onClick={() => controller.commitKeys()}
          >
            Mirror Selected Keys
          </button>
        </div>
        <p id="animation-mirror-pose-reason">{state.poseReason}</p>
        <p id="animation-mirror-keys-reason">{state.keysReason}</p>
        <p>
          Violet overlay: proposed authored pose before IK. Preview follows the playhead and never writes keys. Close
          this panel to hide it.
        </p>
        <p role="status">{state.feedback}</p>
      </section>
    </details>
  );
}
