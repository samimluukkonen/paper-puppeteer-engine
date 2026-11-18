import { animationClipSchema } from '../../engine/core.js';
import { setAttribute, setText } from '../../shared/domUpdates.js';
import { requireElement } from '../shared/editorElements.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import { ANIMATION_IDS } from './elementIds.js';
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
    this.selection = requireElement(app, ANIMATION_IDS.timelineInterpolation, HTMLSelectElement);
    this.help = requireElement(app, ANIMATION_IDS.timelineInterpolationHelp, HTMLElement);
    this.declaration = requireElement(app, ANIMATION_IDS.interpolation, HTMLSelectElement);
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
    if (this.selection.disabled !== control.disabled) this.selection.disabled = control.disabled;
    setAttribute(this.selection, 'data-unavailable-reason', control.reason);
    setAttribute(this.selection, 'title', control.help);
    setText(this.help, control.help);
    const value = state.workingAnimation?.interpolation ?? '';
    if (this.declaration.value !== value) this.declaration.value = value;
    const declarationDisabled = !state.workingAnimation;
    if (this.declaration.disabled !== declarationDisabled) this.declaration.disabled = declarationDisabled;
  }

  dispose(): void {
    this.abort.abort();
  }
}
