import { useId, type ReactNode } from 'react';
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
      {guides.length === 0 && <p>No guides are available for this editor yet.</p>}
      <ul className="feature-guide-list">
        {guides.map((guide, index) => {
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
