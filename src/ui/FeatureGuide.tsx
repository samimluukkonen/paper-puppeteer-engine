import { GraduationCap } from 'lucide-react';
import { createContext, useContext, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { GuideLauncher } from '../devtools/shared/guides/GuideLauncher.js';
import type { GuideEditor, GuideTargetResolver } from '../devtools/shared/guides/types.js';
import { GuideSpotlight } from './GuideSpotlight.js';

const OpenFeatureGuide = createContext<(() => void) | null>(null);
const editors = { rig: 'Rig Editor', animation: 'Animation Editor' } as const;

/** Header entry points share one modal across both retained editor views. */
export function FeatureGuideButton() {
  const open = useContext(OpenFeatureGuide);
  if (!open) return null;
  return (
    <button type="button" className="feature-guide-open" aria-haspopup="dialog" onClick={open}>
      <GraduationCap size={16} aria-hidden="true" />
      Feature Guide
    </button>
  );
}

export function FeatureGuide({
  launcher,
  targets,
  children,
}: {
  launcher: GuideLauncher;
  targets: GuideTargetResolver;
  children: ReactNode;
}) {
  const snapshot = useSyncExternalStore(
    launcher.controller.subscribe,
    launcher.controller.getSnapshot,
    launcher.controller.getSnapshot,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [editor, setEditor] = useState<GuideEditor>(snapshot.context.editor);
  const [error, setError] = useState('');
  const id = useId();
  const guides = launcher.registry.getGuidesForEditor(editor);
  const open = (): void => {
    launcher.refresh();
    setEditor(launcher.controller.getSnapshot().context.editor);
    setError('');
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
  };
  return (
    <OpenFeatureGuide.Provider value={open}>
      {children}
      <dialog
        ref={dialog}
        className="workspace-dialog feature-guide-dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClose={() => {
          if (launcher.controller.getSnapshot().status === 'active') return;
          // Cross-editor launch hides the opener; restore to the new editor's entry point instead.
          const target = opener.current;
          if (target?.isConnected && !target.closest('[hidden], [inert]')) target.focus({ preventScroll: true });
          else document.querySelector<HTMLElement>('.workspace-shell:not([hidden]) .feature-guide-open')?.focus();
        }}
      >
        <div className="workspace-panel-heading">
          <h2 id={`${id}-title`}>Feature Guide</h2>
          <button type="button" onClick={() => dialog.current?.close()}>
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
        {!snapshot.context.capabilities.includes('character') && (
          <p role="status">
            No character is loaded. Guides that need a character will be available after loading or creating one.
          </p>
        )}
        {snapshot.status === 'active' && (
          <div className="feature-guide-current">
            <p>Current guide: {snapshot.currentGuide.title}</p>
            <button
              type="button"
              onClick={() => {
                launcher.controller.exit();
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
            const availability = launcher.getAvailability(guide.id);
            const prerequisite = launcher.getPrerequisiteGuide(guide.id);
            const titleId = `${id}-guide-${index}`;
            const reasonId = `${titleId}-availability`;
            return (
              <li key={guide.id} className="feature-guide-entry" aria-labelledby={titleId}>
                <div>
                  <h4 id={titleId}>{guide.title}</h4>
                  <p>{guide.description}</p>
                  <p id={reasonId} className="feature-guide-availability">
                    {availability.available ? 'Available' : `Unavailable: ${availability.reason}`}
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
                    const result = launcher.launch(guide.id);
                    if (result.ok) dialog.current?.close();
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
      </dialog>
      {snapshot.status === 'active' && (
        <GuideSpotlight
          controller={launcher.controller}
          snapshot={snapshot}
          targets={targets}
          onCatalog={() => {
            launcher.controller.exit();
            open();
          }}
        />
      )}
    </OpenFeatureGuide.Provider>
  );
}
