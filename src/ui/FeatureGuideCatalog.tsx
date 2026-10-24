import { useId, useRef, useState, type ReactNode } from 'react';
import type {
  GuideAvailability,
  GuideCommandResult,
  GuideDefinition,
  GuideEditor,
} from '../devtools/shared/guides/types.js';

const editors = { rig: 'Rig Editor', animation: 'Animation Editor', scene: 'Scene Editor' } as const;

/** Identical catalog content for the Project workspace and retained editors. */
export function FeatureGuideCatalog({
  editor,
  setEditor,
  guides,
  getAvailability,
  getPrerequisiteGuide,
  onStart,
  onClose,
  hasCharacter,
  currentGuide,
  onExit,
  selection,
  error,
  setError,
  availableLabel = 'Available',
}: {
  editor: GuideEditor;
  setEditor: (editor: GuideEditor) => void;
  guides: readonly GuideDefinition[];
  getAvailability: (id: string) => GuideAvailability;
  getPrerequisiteGuide?: (id: string) => GuideDefinition | undefined;
  onStart: (id: string) => GuideCommandResult;
  onClose: () => void;
  hasCharacter: boolean;
  currentGuide?: GuideDefinition | undefined;
  onExit?: () => void;
  selection?: ReactNode;
  error: string;
  setError: (error: string) => void;
  availableLabel?: string;
}) {
  const id = useId();
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibleGuides = guides
    .filter((guide) => {
      const text = `${guide.title} ${guide.description}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
  return (
    <>
      <div className="workspace-panel-heading">
        <h2 id={`${id}-title`}>Feature Guide</h2>
        <button type="button" onClick={() => onClose()}>
          Close
        </button>
      </div>
      <p id={`${id}-description`}>What would you like to learn?</p>
      <div className="feature-guide-categories" role="group" aria-label="Guide editor">
        {Object.entries(editors).map(([key, title]) => (
          <button
            key={key}
            type="button"
            aria-pressed={editor === key}
            onClick={() => {
              setEditor(key as GuideEditor);
              setError('');
            }}
          >
            {title}
          </button>
        ))}
      </div>
      <h3>{editors[editor]}</h3>
      <div className="feature-guide-search">
        <label htmlFor={`${id}-search`}>Search guides</label>
        <input
          ref={searchInput}
          id={`${id}-search`}
          type="search"
          value={search}
          placeholder="Search titles and descriptions"
          aria-describedby={`${id}-search-help`}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              searchInput.current?.focus();
            }}
          >
            Clear search
          </button>
        )}
      </div>
      <p id={`${id}-search-help`}>Search within the selected editor category.</p>
      {selection}
      {editor !== 'scene' && !hasCharacter && !selection && (
        <p role="status">
          No character is loaded. Guides that need a character will be available after loading or creating one.
        </p>
      )}
      {currentGuide && (
        <div className="feature-guide-current">
          <p>Current guide: {currentGuide.title}</p>
          <button
            type="button"
            onClick={() => {
              onExit?.();
              setError('');
            }}
          >
            Exit guide
          </button>
        </div>
      )}
      <p role="status">
        {guides.length === 0
          ? 'No guides are available for this editor yet.'
          : visibleGuides.length === 0
            ? `No guides match your search in ${editors[editor]}. Try another search or editor category.`
            : `${visibleGuides.length} of ${guides.length} guides`}
      </p>
      <ul className="feature-guide-list">
        {visibleGuides.map((guide, index) => {
          const availability = getAvailability(guide.id);
          const prerequisite = getPrerequisiteGuide?.(guide.id);
          const titleId = `${id}-guide-${index}`;
          const reasonId = `${titleId}-availability`;
          return (
            <li key={guide.id} className="feature-guide-entry" aria-labelledby={titleId}>
              <div>
                <h4 id={titleId}>{guide.title}</h4>
                <p>{guide.description}</p>
                <p id={reasonId} className="feature-guide-availability">
                  {availability.available ? availableLabel : `Unavailable: ${availability.reason}`}
                </p>
              </div>
              {!availability.available && prerequisite && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setEditor(prerequisite.editor);
                    setError(
                      `Prerequisite guide: ${prerequisite.title}. Find it in this category and choose Start Guide when available.`,
                    );
                  }}
                >
                  Show prerequisite: {prerequisite.title}
                </button>
              )}
              <button
                type="button"
                disabled={!availability.available}
                aria-label={`Start Guide: ${guide.title}`}
                aria-describedby={reasonId}
                onClick={() => {
                  const result = onStart(guide.id);
                  if (result.ok) onClose();
                  else setError(result.reason);
                }}
              >
                Start Guide
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
