import { dispatchListeners, throwNotificationErrors } from '../../../engine/core.js';
import { freezeData } from '../editorData.js';
import { getGuideAvailability, type GuideRegistry, guideRegistry } from './registry.js';
import type {
  GuideAvailability,
  GuideCommandResult,
  GuideContext,
  GuideDefinition,
  GuideStep,
  GuideTargetResolver,
} from './types.js';

export type GuideSnapshot = { readonly context: GuideContext } & (
  | {
      readonly status: 'idle' | 'exited' | 'finished';
      readonly currentGuide: null;
      readonly currentStep: null;
      readonly stepIndex: null;
      readonly availability: GuideAvailability;
    }
  | {
      readonly status: 'active';
      readonly currentGuide: GuideDefinition;
      readonly currentStep: GuideStep;
      readonly stepIndex: number;
      readonly availability: GuideAvailability;
    }
);

const success: GuideCommandResult = Object.freeze({ ok: true });
const failure = (reason: string): GuideCommandResult => ({ ok: false, reason });
const inactive = (status: 'idle' | 'exited' | 'finished', context: GuideContext): GuideSnapshot =>
  freezeData({
    status,
    context,
    currentGuide: null,
    currentStep: null,
    stepIndex: null,
    availability: { available: true },
  });

/** Session-only UI store. Compatible with useSyncExternalStore; no document or scene dependency. */
export class GuideController {
  private readonly listeners = new Set<() => void>();
  private context: GuideContext;
  private snapshot: GuideSnapshot;

  constructor(
    context: GuideContext,
    private readonly registry: GuideRegistry = guideRegistry,
  ) {
    this.context = freezeData(structuredClone(context));
    this.snapshot = inactive('idle', this.context);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = (): GuideSnapshot => this.snapshot;

  getAvailability(id: string): GuideAvailability {
    const guide = this.registry.getGuideById(id);
    if (!guide) return { available: false, reason: `Guide not found: ${id}` };
    // Browsing the catalog can show guides from either editor; start() enforces the active editor.
    return getGuideAvailability(guide, this.context, guide.steps[0]);
  }

  setContext(context: GuideContext): void {
    if (
      context.editor === this.context.editor &&
      context.capabilities.length === this.context.capabilities.length &&
      context.capabilities.every((capability, index) => this.context.capabilities[index] === capability)
    )
      return;
    this.context = freezeData(structuredClone(context));
    const held = this.snapshot;
    if (held.status !== 'active') {
      this.publish(inactive(held.status, this.context));
      return;
    }
    this.publish(
      freezeData({ ...held, context: this.context, availability: this.checkStep(held.currentGuide, held.currentStep) }),
    );
  }

  start(id: string): GuideCommandResult {
    if (this.snapshot.status === 'active') return failure('Exit or finish the active guide first.');
    const guide = this.registry.getGuideById(id);
    if (!guide) return failure(`Guide not found: ${id}`);
    return this.activate(guide, 0);
  }

  next(): GuideCommandResult {
    const held = this.snapshot;
    if (held.status !== 'active') return failure('No active guide.');
    if (!held.availability.available) return failure(held.availability.reason);
    if (held.stepIndex === held.currentGuide.steps.length - 1) return failure('Already at the last step.');
    return this.activate(held.currentGuide, held.stepIndex + 1);
  }

  previous(): GuideCommandResult {
    const held = this.snapshot;
    if (held.status !== 'active') return failure('No active guide.');
    if (!held.stepIndex) return failure('Already at the first step.');
    return this.activate(held.currentGuide, held.stepIndex - 1);
  }

  /** Explicit UI-only preparation after mounting the correct editor. Navigation never clicks controls. */
  prepareCurrentStep(targets: GuideTargetResolver): GuideCommandResult {
    const held = this.snapshot;
    if (held.status !== 'active') return failure('No active guide.');
    if (!held.availability.available) return failure(held.availability.reason);
    if (!held.currentStep.preparation) return success;
    return targets.reveal(held.currentStep.targetId)
      ? success
      : failure(`Target unavailable: ${held.currentStep.targetId}`);
  }

  exit(): GuideCommandResult {
    if (this.snapshot.status !== 'active') return failure('No active guide.');
    this.publish(inactive('exited', this.context));
    return success;
  }

  finish(): GuideCommandResult {
    const held = this.snapshot;
    if (held.status !== 'active') return failure('No active guide.');
    if (!held.availability.available) return failure(held.availability.reason);
    if (held.stepIndex !== held.currentGuide.steps.length - 1) return failure('Reach the last step before finishing.');
    this.publish(inactive('finished', this.context));
    return success;
  }

  restart(): GuideCommandResult {
    const held = this.snapshot;
    return held.status === 'active' ? this.activate(held.currentGuide, 0) : failure('No active guide.');
  }

  reset(): void {
    if (this.snapshot.status !== 'idle') this.publish(inactive('idle', this.context));
  }

  private checkStep(guide: GuideDefinition, step: GuideStep): GuideAvailability {
    if (guide.editor !== this.context.editor)
      return { available: false, reason: `Open the ${guide.editor} editor first.` };
    return getGuideAvailability(guide, this.context, step);
  }

  private activate(guide: GuideDefinition, stepIndex: number): GuideCommandResult {
    const step = guide.steps[stepIndex];
    if (!step) return failure(`Step not found: ${stepIndex}`);
    const availability = this.checkStep(guide, step);
    if (!availability.available) return failure(availability.reason);
    this.publish(
      freezeData({
        status: 'active',
        context: this.context,
        currentGuide: guide,
        currentStep: step,
        stepIndex,
        availability,
      }),
    );
    return success;
  }

  private publish(snapshot: GuideSnapshot): void {
    this.snapshot = snapshot;
    throwNotificationErrors(
      dispatchListeners(this.listeners, (listener) => listener()),
      'Guide UI listeners failed.',
    );
  }
}
