import { setAttribute } from '../../shared/domUpdates.js';
import type { AnimationEditorState } from './AnimationEditorState.js';

/** An empty reason means the command is available. Hidden keys retain their authored scope. */
export function retimeSelectionReason(state: AnimationEditorState): string {
  if (!state.workingAnimation) return 'Load a valid animation first.';
  return state.selectedKeys.length || state.selectedIKKeyframe
    ? ''
    : 'Select bone keyframes or an IK channel key to retime. Events cannot be retimed.';
}

/** Keep native disabled behavior and an actionable explanation on the same control. */
export function setCommandAvailability(button: HTMLButtonElement, reason: string, enabledTitle: string): void {
  if (button.disabled !== !!reason) button.disabled = !!reason;
  setAttribute(button, 'title', reason || enabledTitle);
}
