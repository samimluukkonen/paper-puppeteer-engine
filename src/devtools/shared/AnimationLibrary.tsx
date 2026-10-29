import { useState } from 'react';
import {
  animationAssetReference,
  animationCompatibility,
  filterAnimationLibrary,
  type AnimationLibraryEntry,
} from './animationLibraryData.js';
import { CharacterRigSelect } from './CharacterRigSelect.js';
import './animationLibrary.css';

export interface AnimationLibraryProps {
  guideTarget?: string;
  entries: readonly AnimationLibraryEntry[];
  targetRig?: string | undefined;
  targets?: readonly { id: string; name: string }[];
  disabled?: boolean | undefined;
  onPreview(this: void, entry: AnimationLibraryEntry): void;
  onUse(this: void, entry: AnimationLibraryEntry): void;
  onLocate?: ((entry: AnimationLibraryEntry) => void) | undefined;
  onCopy?: ((entry: AnimationLibraryEntry) => void) | undefined;
}

/** Shared browser for project inventory and existing editor selection workflows. */
export function AnimationLibrary({
  guideTarget,
  entries,
  targetRig,
  targets,
  disabled,
  onPreview,
  onUse,
  onLocate,
  onCopy,
}: AnimationLibraryProps) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [compatibleOnly, setCompatibleOnly] = useState(false);
  const [open, setOpen] = useState(false);
  const rig = targets ? target || undefined : targetRig;
  const matches = filterAnimationLibrary(entries, query, rig, compatibleOnly);
  return (
    <details
      className="animation-library"
      data-guide-id={guideTarget}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Animation Library ({entries.length})</summary>
      {open && (
        <div className="animation-library-content">
          <label>
            Search animations
            <input
              type="search"
              value={query}
              placeholder="Name or tags"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {targets && (
            <CharacterRigSelect
              label="Compatible character / rig"
              value={target}
              onChange={setTarget}
              choices={targets}
              emptyLabel="All source characters"
            />
          )}
          <label>
            <input
              type="checkbox"
              checked={compatibleOnly}
              onChange={(event) => setCompatibleOnly(event.target.checked)}
            />{' '}
            Compatible rig only
          </label>
          <p className="workspace-caption" role="status">
            {matches.length} of {entries.length} animations
          </p>
          <p className="workspace-caption">
            Use Existing Animation keeps the source ID. Editing that source can affect every scene referencing it.
            Create Independent Copy makes an editable variation.
          </p>
          {!matches.length && <p>No matching animations. Change the search or compatibility filter.</p>}
          <ul className="animation-library-list">
            {matches.map((entry) => {
              const reason = animationCompatibility(entry, rig ?? (targets ? entry.rigIdentity : undefined));
              return (
                <li key={animationAssetReference(entry)}>
                  <strong>{entry.clip.library?.displayName ?? entry.clip.name}</strong>
                  <small>
                    {entry.characterName} · {entry.clip.duration / 1000} s · {entry.clip.loop ? 'Looping' : 'Play once'}
                  </small>
                  <small>
                    Source: {entry.character} · Animation ID: {entry.clip.name}
                  </small>
                  <small>{reason || 'Compatible source rig'}</small>
                  {entry.clip.library?.description && <p>{entry.clip.library.description}</p>}
                  {!!entry.clip.library?.tags?.length && <small>Tags: {entry.clip.library.tags.join(', ')}</small>}
                  <div className="animation-library-actions">
                    <button type="button" disabled={disabled || !entry.rigIdentity} onClick={() => onPreview(entry)}>
                      Preview animation
                    </button>
                    <button
                      type="button"
                      disabled={disabled || !!reason}
                      title={reason || 'Reference the existing asset'}
                      onClick={() => onUse(entry)}
                    >
                      Use Existing Animation
                    </button>
                    {onCopy && (
                      <button
                        type="button"
                        disabled={disabled || !!reason}
                        title={reason}
                        onClick={() => onCopy(entry)}
                      >
                        Create Independent Copy
                      </button>
                    )}
                    {onLocate && (
                      <button type="button" disabled={disabled} onClick={() => onLocate(entry)}>
                        Locate Original Asset
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </details>
  );
}
