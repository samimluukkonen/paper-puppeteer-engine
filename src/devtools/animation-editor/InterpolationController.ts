import { animationClipSchema } from '../../engine/schemas.js';
import { setAttribute, setText } from '../../shared/domUpdates.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { selectedInterpolationControl } from './interpolationPresentation.js';

/** Selection inspection and explicitly scoped clip declaration edits through the existing state APIs. */
export class InterpolationController {
  private readonly abort = new AbortController();
  private readonly selection: HTMLSelectElement;
  private readonly help: HTMLElement;
  private readonly declaration: HTMLSelectElement;
  private animation: AnimationEditorState['workingAnimation'] | undefined;
  private keys: AnimationEditorState['selectedKeys'] | undefined;
  private control: ReturnType<typeof selectedInterpolationControl> | undefined;

  constructor(
    app: HTMLElement,
    private readonly getState: () => AnimationEditorState,
  ) {
    const element = <T extends HTMLElement>(selector: string): T => {
      const found = app.querySelector<T>(selector);
      if (!found) throw new Error(`Missing animation editor element ${selector}.`);
      return found;
    };
    this.selection = element('#timeline-interpolation');
    this.help = element('#timeline-interpolation-help');
    this.declaration = element('#animation-interpolation');
    this.declaration.addEventListener(
      'change',
      () => {
        const state = this.getState();
        const parsed = animationClipSchema.shape.interpolation.unwrap().safeParse(this.declaration.value);
        if (!this.declaration.disabled) {
          if (this.declaration.value === '') state.setAuthoredInterpolation(undefined);
          else if (parsed.success) state.setAuthoredInterpolation(parsed.data);
        }
        // Restore the held declaration after rejected/no-op edits, including programmatic events.
        this.render();
      },
      { signal: this.abort.signal },
    );
  }

  render(): void {
    const state = this.getState();
    if (!this.control || this.animation !== state.workingAnimation || this.keys !== state.selectedKeys) {
      this.control = selectedInterpolationControl(state.selectedInterpolation);
      this.animation = state.workingAnimation;
      this.keys = state.selectedKeys;
    }
    const control = this.control;
    if (this.selection.value !== control.value) this.selection.value = control.value;
    this.selection.disabled = control.disabled;
    setAttribute(this.selection, 'data-unavailable-reason', control.reason);
    setAttribute(this.selection, 'title', control.help);
    setText(this.help, control.help);
    const value = state.workingAnimation?.interpolation ?? '';
    if (this.declaration.value !== value) this.declaration.value = value;
    this.declaration.disabled = !state.workingAnimation;
  }

  dispose(): void {
    this.abort.abort();
  }
}
