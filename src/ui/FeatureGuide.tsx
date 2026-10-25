import { GraduationCap } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { projectEditorContext } from '../devtools/project/projectBridge.js';
import type { GuideLauncher } from '../devtools/shared/guides/GuideLauncher.js';
import type { GuideEditor, GuideTargetResolver } from '../devtools/shared/guides/types.js';
import { FeatureGuideCatalog } from './FeatureGuideCatalog.js';
import { GuideSpotlight } from './GuideSpotlight.js';

const OpenFeatureGuide = createContext<(() => void) | null>(null);

/** Header entry points share one modal across both retained editor views. */
export function FeatureGuideButton({ onOpen }: { onOpen?: () => void } = {}) {
  const contextOpen = useContext(OpenFeatureGuide);
  const open = onOpen ?? contextOpen;
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
  const [requestedGuide, setRequestedGuide] = useState<string>();
  const guides = launcher.registry.getGuidesForEditor(editor);
  const open = useCallback(
    (guideId?: string): void => {
      setRequestedGuide(guideId);
      launcher.refresh();
      setEditor(launcher.controller.getSnapshot().context.editor);
      setError('');
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.current?.showModal();
    },
    [launcher],
  );
  useEffect(() => projectEditorContext()?.bindGuide(open), [open]);
  useEffect(() => {
    if (!requestedGuide) return;
    const guide = launcher.registry.getGuideById(requestedGuide);
    const ready = snapshot.context.capabilities.includes(
      guide?.editor === 'project' ? 'tool:project' : guide?.editor === 'scene' ? 'tool:scene' : 'character',
    );
    if (!ready) return;
    setRequestedGuide(undefined);
    const result = launcher.launch(requestedGuide);
    if (result.ok) dialog.current?.close();
    else setError(result.reason);
  }, [requestedGuide, snapshot.context, launcher]);
  return (
    <OpenFeatureGuide.Provider value={() => open()}>
      {children}
      <dialog
        ref={dialog}
        className="workspace-dialog feature-guide-dialog"
        aria-label="Feature Guide"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const buttons = event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]',
          );
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
        onCancel={() => setRequestedGuide(undefined)}
        onClose={() => {
          if (launcher.controller.getSnapshot().status === 'active') return;
          // Cross-editor launch hides the opener; restore to the new editor's entry point instead.
          const target = opener.current;
          if (target?.isConnected && !target.closest('[hidden], [inert]')) target.focus({ preventScroll: true });
          else document.querySelector<HTMLElement>('.workspace-shell:not([hidden]) .feature-guide-open')?.focus();
        }}
      >
        <FeatureGuideCatalog
          editor={editor}
          setEditor={setEditor}
          guides={guides}
          getAvailability={(guideId) => launcher.getAvailability(guideId)}
          getPrerequisiteGuide={(guideId) => launcher.getPrerequisiteGuide(guideId)}
          onStart={(guideId) => launcher.launch(guideId)}
          onClose={() => dialog.current?.close()}
          hasCharacter={snapshot.context.capabilities.includes('character')}
          currentGuide={snapshot.status === 'active' ? snapshot.currentGuide : undefined}
          onExit={() => launcher.controller.exit()}
          error={error}
          setError={setError}
        />
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
