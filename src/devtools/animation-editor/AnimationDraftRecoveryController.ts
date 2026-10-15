import { inspectAnimationDefinition } from '../../engine/externalData.js';
import { JsonWorkloadBudget } from '../../engine/jsonWorkloadLimits.js';
import type { DraftRecovery } from '../shared/DraftRecovery.js';
import { draftSource } from '../shared/draftSource.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';

type Recovery = Pick<DraftRecovery<ReadonlyAnimation | null>, 'bind' | 'unbind' | 'update'>;

/** Bind recovery to character/animation sources and distinguish explicit imports from ordinary navigation. */
export class AnimationDraftRecoveryController {
  private release: (() => void) | undefined;
  private state: AnimationEditorState | undefined;
  private characterId = '';
  private animation: string | null | undefined;
  private source: ReadonlyAnimation | null | undefined;
  private importRevision = 0;
  private visitedSources = new WeakSet<object>();

  constructor(
    private readonly recovery: Recovery,
    private readonly pathname: string,
  ) {}

  bind(state: AnimationEditorState, characterId: string): void {
    this.unbind();
    this.visitedSources = new WeakSet();
    this.state = state;
    this.characterId = characterId;
    this.importRevision = state.importRevision;
    this.release = state.subscribe(() => this.synchronize());
    this.synchronize();
  }

  private synchronize(): void {
    const state = this.state;
    if (!state) return;
    const animation = state.selectedAnimationId;
    const source = state.sourceAnimation;
    const imported = state.importRevision !== this.importRevision;
    this.importRevision = state.importRevision;
    if (animation !== this.animation || source !== this.source) {
      // A same-name import establishes a new baseline and clears this session's previous draft.
      if (animation === this.animation) this.recovery.update();
      // Restoration notifies state subscribers synchronously; publish identity before binding.
      this.animation = animation;
      this.source = source;
      const recover = !imported && !!source && !this.visitedSources.has(source);
      if (source) this.visitedSources.add(source);
      if (animation === null) this.recovery.unbind();
      else
        this.recovery.bind(
          {
            key: JSON.stringify([
              this.pathname.replace(/\/rig-editor(?=\/|$)/, '/animation-editor'),
              this.characterId,
              animation,
            ]),
            source: draftSource({ rig: state.sourceRig, animation: source }),
            label: `animation "${animation}"`,
            snapshot: () => state.workingAnimation,
            dirty: () => state.dirty,
            data: (snapshot) => snapshot,
            validate: (data) => {
              try {
                new JsonWorkloadBudget().checkAnimation(data);
                return inspectAnimationDefinition(data, state.rig).data?.name === animation;
              } catch {
                return false;
              }
            },
            restore: (data) => state.replaceWorkingAnimation(data),
          },
          { recover },
        );
    }
    this.recovery.update();
  }

  /** Flush and release the old state before scene errors, replacements, or view teardown. */
  unbind(): void {
    this.release?.();
    this.release = undefined;
    this.recovery.unbind();
    this.state = undefined;
    this.animation = undefined;
    this.source = undefined;
  }

  dispose(): void {
    this.unbind();
  }
}
