import { Subscribers } from '../shared/subscriberNotifications.js';
import type { AnimationEditorState } from './AnimationEditorState.js';
import type { NewAnimationOptions } from './createEmptyAnimation.js';

/** React bridge with one subscription per workspace and no clock-driven form resets. */
export class NewAnimationController {
  private state: AnimationEditorState | undefined;
  private release: (() => void) | undefined;
  private readonly subscribers = new Subscribers({ label: 'New animation listeners failed.' });
  private reason = 'Load a valid character rig before creating an animation.';
  readonly subscribe = this.subscribers.subscribe;
  readonly getSnapshot = (): string => this.reason;

  bind(state: AnimationEditorState): void {
    this.release?.();
    this.state = state;
    this.release = state.subscribe(() => this.refresh());
    this.refresh();
  }
  private refresh(): void {
    const reason = !this.state?.rig
      ? 'Load a valid character rig before creating an animation.'
      : !this.state.animationAuthoringEnabled
        ? 'Switch to Animation mode to create an animation.'
        : '';
    if (reason === this.reason) return;
    this.reason = reason;
    this.subscribers.notify();
  }
  create(options: NewAnimationOptions): string {
    if (this.reason || !this.state) return this.reason;
    return this.state.createAnimation(options)
      ? ''
      : this.state.validationIssues.map((issue) => issue.message).join('\n') || 'Could not register the animation.';
  }
  unbind(): void {
    this.release?.();
    this.release = undefined;
    this.state = undefined;
    this.refresh();
  }
  dispose(): void {
    this.unbind();
    this.subscribers.clear();
  }
}
