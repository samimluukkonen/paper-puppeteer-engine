import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GuideController, GuideSnapshot } from '../devtools/shared/guides/GuideController.js';
import type { GuideCommandResult, GuideTargetResolver } from '../devtools/shared/guides/types.js';
import { containGuideInteraction } from './guideInteraction.js';
import { placeGuideCard } from './guidePositioning.js';
import { observeGuideTarget, type GuideTargetLayout } from './observeGuideTarget.js';
import './guideSpotlight.css';

const unavailableTargets: GuideTargetResolver = { resolve: () => null, reveal: () => false };

/** Explain uses native modality; opt-in practice opens only the real target and the guide card. */
export function GuideSpotlight({
  controller,
  snapshot,
  targets,
  onCatalog,
}: {
  controller: GuideController;
  snapshot: Extract<GuideSnapshot, { status: 'active' }>;
  targets: GuideTargetResolver;
  onCatalog?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const [layout, setLayout] = useState<GuideTargetLayout>({
    rectangle: null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
  const [cardSize, setCardSize] = useState({ width: 360, height: 320 });
  const [error, setError] = useState('');
  const [practicingStep, setPracticingStep] = useState<unknown>(null);
  const { currentGuide: guide, currentStep: step, stepIndex, availability } = snapshot;
  const practice = step.mode === 'try-it' ? step.practice : null;
  const missingPractice = practice?.prerequisites?.find(
    (item) => !snapshot.context.capabilities.includes(item.capability),
  );
  const interactive = practicingStep === step && !!practice && !missingPractice && availability.available;
  const targetId = interactive ? practice.targetId : step.targetId;
  const last = stepIndex === guide.steps.length - 1;

  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      queueMicrotask(() => {
        // Catalog-to-tour handoff can leave body active after the original card is removed.
        // Body cannot restore useful keyboard focus; return to the shared guide entry point.
        if (
          opener?.isConnected &&
          opener !== document.body &&
          opener !== document.documentElement &&
          !opener.closest('[hidden], [inert], dialog:not([open])')
        )
          opener.focus({ preventScroll: true });
        else
          document
            .querySelector<HTMLElement>('.workspace-shell:not([hidden]) .feature-guide-open')
            ?.focus({ preventScroll: true });
      });
    };
  }, []);

  useLayoutEffect(() => {
    const element = dialog.current!;
    if (interactive) element.show();
    else element.showModal();
    heading.current?.focus({ preventScroll: true });
    const release = interactive
      ? containGuideInteraction(
          element,
          () => targets.resolveElement?.(targetId) ?? null,
          () => controller.exit(),
        )
      : undefined;
    return () => {
      release?.();
      element.close();
    };
  }, [interactive, targetId, targets, controller]);

  useLayoutEffect(() => {
    setError('');
    if (!availability.available) setPracticingStep(null);
    heading.current?.focus({ preventScroll: true });
    return observeGuideTarget(availability.available ? targets : unavailableTargets, targetId, setLayout);
  }, [targets, step, availability, targetId]);

  useLayoutEffect(() => {
    const element = card.current!;
    const measure = (): void => {
      const { width, height } = element.getBoundingClientRect();
      setCardSize((held) => (held.width === width && held.height === height ? held : { width, height }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
    // Step content can change card height; place it before painting the new spotlight.
  }, [step, interactive, error, availability]);

  const navigate = (result: GuideCommandResult): void => {
    if (!result.ok) setError(result.reason);
    else setPracticingStep(null);
  };
  const missing = !layout.rectangle;
  const position = placeGuideCard(layout.rectangle, cardSize, layout.viewport);
  return createPortal(
    <dialog
      ref={dialog}
      className={`guide-spotlight feature-guide-dialog${interactive ? ' guide-spotlight-interactive' : ''}`}
      aria-modal={!interactive}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-explanation ${id}-policy`}
      onCancel={(event) => {
        event.preventDefault();
        controller.exit();
      }}
      onClose={() => {
        if (!dialog.current?.open && controller.getSnapshot().status === 'active') controller.exit();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (interactive || event.key !== 'Tab') return;
        const buttons = card.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        const first = buttons[0];
        const final = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
          event.preventDefault();
          final?.focus();
        } else if (!event.shiftKey && document.activeElement === final) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onKeyUp={(event) => event.stopPropagation()}
    >
      {layout.rectangle ? (
        <div
          className="guide-spotlight-hole"
          aria-hidden="true"
          style={{
            left: layout.rectangle.x,
            top: layout.rectangle.y,
            width: layout.rectangle.width,
            height: layout.rectangle.height,
          }}
        />
      ) : (
        <div className="guide-spotlight-dimmer" aria-hidden="true" />
      )}
      <section ref={card} className="guide-step-card" style={position}>
        <h2 ref={heading} tabIndex={-1} id={`${id}-title`}>
          {guide.title}
        </h2>
        <p className="guide-step-progress">
          Step {stepIndex + 1} of {guide.steps.length}
        </p>
        <h3>{step.title}</h3>
        <p id={`${id}-explanation`}>{step.description}</p>
        <p id={`${id}-policy`} className="guide-step-policy">
          {interactive
            ? practice.instruction
            : practice
              ? 'Explain mode. Choose Try It to use the highlighted control, or continue with Next.'
              : 'Read-only tour. Editor controls are paused for interaction; exit the guide to try them.'}
        </p>
        {practice && !interactive && (
          <div>
            <p>
              {practice.changesProject
                ? 'Optional practice changes your real project using normal validation and Undo/Redo.'
                : 'Optional practice changes selection or preview preferences only.'}
            </p>
            {missingPractice && <p>{missingPractice.reason}</p>}
            <button
              type="button"
              disabled={!!missingPractice || !availability.available}
              onClick={() => setPracticingStep(step)}
            >
              Try It
            </button>
          </div>
        )}
        {interactive && (
          <div>
            <p role="status" aria-live="polite">
              {practice.completion && snapshot.context.capabilities.includes(practice.completion.capability)
                ? practice.completion.message
                : 'Practice is optional. Continue with Next whenever you are ready.'}
            </p>
            <button type="button" onClick={() => setPracticingStep(null)}>
              Explain
            </button>
          </div>
        )}
        {missing && (
          <p role="status">
            {availability.available
              ? 'This target is currently unavailable. Skip this step or exit the guide.'
              : availability.reason}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="guide-step-tools">
          <button
            type="button"
            onClick={() => {
              setPracticingStep(null);
              navigate(controller.restart());
            }}
          >
            Restart guide
          </button>
          {onCatalog && (
            <button type="button" onClick={onCatalog}>
              Choose another guide
            </button>
          )}
        </div>
        <nav aria-label="Guide steps">
          <button type="button" disabled={stepIndex === 0} onClick={() => navigate(controller.previous())}>
            Back
          </button>
          <button
            type="button"
            disabled={!availability.available}
            onClick={() => navigate(last ? controller.finish() : controller.next())}
          >
            {missing ? (last ? 'Skip / Finish' : 'Skip') : last ? 'Finish' : 'Next'}
          </button>
          <button type="button" onClick={() => controller.exit()}>
            Exit
          </button>
        </nav>
      </section>
    </dialog>,
    document.body,
  );
}
