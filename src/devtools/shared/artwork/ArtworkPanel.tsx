import { useSyncExternalStore } from 'react';
import type { ArtworkController } from './ArtworkController.js';
import './artwork.css';

export function ArtworkPanel({ controller }: { controller: ArtworkController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const target = state.targets.find((entry) => entry.key === state.selectedKey);
  const replacement = state.proposed ?? state.applied;
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
            {target.reason && <p>{target.reason}</p>}
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
        <label>
          Import sprite
          <input
            type="file"
            aria-label="Import sprite"
            accept=".png,.webp,image/png,image/webp"
            disabled={!target || !!target.reason}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void controller.import(file);
            }}
          />
        </label>
        <div className="artwork-actions">
          <button type="button" disabled={!state.proposed || state.importing} onClick={() => controller.preview()}>
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
        </div>
        <p role="status">{state.message}</p>
        <p role="status" aria-label="Artwork changes">
          {state.pendingCount ? `${state.pendingCount} pending artwork change(s)` : 'No pending artwork changes'}
        </p>
        <small>
          Session only. Apply keeps artwork in memory; rig and animation JSON downloads do not include images.
          Navigating away discards replacements. Dimensions and origins are not recalculated.
        </small>
      </section>
    </details>
  );
}
