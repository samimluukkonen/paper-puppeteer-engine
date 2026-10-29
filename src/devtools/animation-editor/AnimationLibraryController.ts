import type { AnimationLibraryMetadata } from '../../engine/AnimationClip.js';
import { independentAnimationName, type AnimationLibraryEntry } from '../shared/animationLibraryData.js';
import { notifySubscribers } from '../shared/subscriberNotifications.js';
import type { AnimationEditorState } from './AnimationEditorState.js';

/** Bridges the browser to the existing document, history and Environment Preview canvas. */
export class AnimationLibraryController {
  private state: AnimationEditorState | undefined;
  private release: (() => void) | undefined;
  private listeners = new Set<() => void>();
  private snapshot = {
    entries: [] as readonly AnimationLibraryEntry[],
    source: null as AnimationEditorState['workingAnimation'],
    reason: 'Load a character first.',
  };
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = () => this.snapshot;
  bind(state: AnimationEditorState, character: string): void {
    this.unbind();
    this.state = state;
    let ids: readonly string[] | undefined;
    let rig: AnimationEditorState['rig'];
    const refresh = (): void => {
      const source = state.workingAnimation;
      const reason = !state.rig
        ? 'Load a character first.'
        : !state.animationAuthoringEnabled
          ? 'Switch to Animation mode.'
          : state.hasPendingAnimationEdits
            ? 'Commit or cancel temporary edits first.'
            : '';
      // Playback ticks do not rebuild library rows or notify React.
      if (
        source === this.snapshot.source &&
        reason === this.snapshot.reason &&
        ids === state.animationIds &&
        rig === state.rig
      )
        return;
      ids = state.animationIds;
      rig = state.rig;
      const clips = state.packageAnimations();
      this.snapshot = {
        source,
        reason,
        entries: clips.map((clip) => ({
          character,
          characterName: character,
          rigIdentity: state.rig ? character : undefined,
          clip,
        })),
      };
      notifySubscribers(this.listeners, 'Animation library listeners failed.');
    };
    this.release = state.subscribe(refresh);
    refresh();
  }
  select(name: string, preview = false): boolean {
    const state = this.state;
    if (!state || this.snapshot.reason || !state.animationIds.includes(name)) return false;
    if (state.selectedAnimationId !== name && !state.selectAnimation(name, { keepChanges: true })) return false;
    state.pause();
    if (preview) {
      state.restart();
      state.play();
    }
    return true;
  }
  copy(name: string): boolean {
    return (
      this.select(name) &&
      !!this.state?.createVariation({ name: independentAnimationName(name, this.state.animationIds) })
    );
  }
  metadata(library: AnimationLibraryMetadata): boolean {
    return !!this.state?.setLibraryMetadata(library);
  }
  unbind(): void {
    this.release?.();
    this.release = undefined;
    this.state = undefined;
    this.snapshot = { source: null, entries: [], reason: 'Load a character first.' };
    notifySubscribers(this.listeners, 'Animation library listeners failed.');
  }
  dispose(): void {
    this.unbind();
    this.listeners.clear();
  }
}
