import { useSyncExternalStore } from 'react';
import type { ArtworkAlignmentPolicy, ArtworkReference } from '../../../engine/artworkReplacement.js';
import type { ArtworkController } from './ArtworkController.js';
import './artwork.css';

export function ArtworkPanel({ controller }: { controller: ArtworkController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const target = state.targets.find((entry) => entry.key === state.selectedKey);
  const replacement = state.proposed ?? state.applied;
  const reason = state.selectedReference
    ? target?.individuals.find((entry) => entry.reference === state.selectedReference)?.reason
    : target?.reason;
  return (
    <details className="artwork-panel" id="artwork-panel">
      <summary>Sprite replacement</summary>
      <section aria-label="Sprite replacement">
        <label>
          Artwork asset
          <select
            aria-label="Artwork asset"
            value={state.selectedKey ?? ''}
            disabled={!state.targets.length}
            onChange={(event) => controller.select(event.target.value)}
          >
            {!state.targets.length && <option value="">Loading character…</option>}
            {state.targets.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.key} — {entry.filename}
              </option>
            ))}
          </select>
        </label>
        {target && (
          <>
            <p>Asset: {target.key}</p>
            <p className="artwork-references">
              {target.references.length ? target.references.join(' · ') : 'No current rig references.'}
            </p>
            <label>
              Replacement scope
              <select
                aria-label="Replacement scope"
                value={state.selectedReference ?? 'shared'}
                onChange={(event) =>
                  controller.selectReference(
                    event.target.value === 'shared' ? null : (event.target.value as ArtworkReference),
                  )
                }
              >
                <option value="shared">
                  Replace shared artwork asset — all references ({target.individuals.length})
                </option>
                {target.individuals.map((entry) => (
                  <option key={entry.reference} value={entry.reference}>
                    Replace only {entry.reference}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {state.selectedReference
                ? 'Only this logical attachment or bone changes. Every skin using that attachment sees its replacement.'
                : 'All bones, attachments and skins using this asset update. Explicit individual replacements take precedence.'}
            </p>
            {reason && <p>{reason}</p>}
            <div className="artwork-comparison">
              <figure>
                <figcaption>Original</figcaption>
                {target.url && <img src={target.url} alt="Original artwork" />}
                <small>
                  {target.filename} · {target.width} × {target.height} px
                </small>
              </figure>
              <figure>
                <figcaption>{state.proposed ? 'Proposed replacement' : 'Applied replacement'}</figcaption>
                {replacement ? (
                  <>
                    <img src={replacement.url} alt="Replacement artwork" />
                    <small>
                      {replacement.filename} · {replacement.width} × {replacement.height} px
                    </small>
                  </>
                ) : (
                  <p>No replacement selected.</p>
                )}
              </figure>
            </div>
          </>
        )}
        {state.proposed && state.previousSize && (
          <>
            <p>
              Old size: {state.previousSize.width} × {state.previousSize.height}
              <br />
              New size: {state.proposed.width} × {state.proposed.height}
            </p>
            <label>
              Alignment policy
              <select
                aria-label="Alignment policy"
                value={state.policy ?? ''}
                onChange={(event) => controller.setPolicy(event.target.value as ArtworkAlignmentPolicy)}
              >
                <option value="" disabled>
                  Choose how to preserve the pivot…
                </option>
                <option value="normalized">Preserve normalized origin</option>
                <option value="pixels">Preserve texture-local pivot in pixels</option>
                <option value="manual">Manually realign afterward</option>
              </select>
            </label>
            <p>
              Normalized origins keep the same fractional position, so the pixel pivot moves when dimensions change.
              Pixel preservation keeps the current texture-local pivot and changes its normalized coordinates. Manual
              alignment starts with the current normalized origin; use the artwork alignment tools after Apply.
            </p>
            <p>
              Image size changes its visible size at the existing scale and may shift sprite alignment. Bone positions,
              sprite offsets, scale and animation keys stay intact. Named or numbered atlas frames must remain valid; a
              static image cannot supply those frames.
            </p>
          </>
        )}
        <label>
          Import sprite
          <input
            type="file"
            aria-label="Import sprite"
            accept=".png,.webp,image/png,image/webp"
            disabled={!target || !!reason}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void controller.import(file);
            }}
          />
        </label>
        <div className="artwork-actions">
          <button
            type="button"
            disabled={!state.proposed || state.importing || !state.policy}
            onClick={() => controller.preview()}
          >
            Preview Replacement
          </button>
          <button type="button" disabled={!state.previewing} onClick={() => controller.apply()}>
            Apply Replacement
          </button>
          <button type="button" disabled={!state.proposed && !state.importing} onClick={() => controller.cancel()}>
            Cancel
          </button>
          <button type="button" disabled={!state.applied} onClick={() => controller.revert()}>
            Revert to Original
          </button>
          <button type="button" disabled={!state.canUndo} onClick={() => controller.undo()}>
            Undo Artwork
          </button>
          <button type="button" disabled={!state.canRedo} onClick={() => controller.redo()}>
            Redo Artwork
          </button>
        </div>
        <p role="status">{state.message}</p>
        <p role="status" aria-label="Artwork changes">
          {state.pendingCount ? `${state.pendingCount} pending artwork change(s)` : 'No pending artwork changes'}
        </p>
        <small>
          Session only. Apply keeps artwork in memory; rig and animation JSON downloads do not include images. Editor
          tabs keep replacements and history. Leaving the character workspace or reloading can discard them. Download a
          character ZIP to include images. Artwork Undo/Redo is independent of animation and rig edits.
        </small>
      </section>
    </details>
  );
}
