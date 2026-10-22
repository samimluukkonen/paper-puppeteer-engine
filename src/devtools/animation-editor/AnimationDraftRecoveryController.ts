import { z } from 'zod';
import { inspectAnimationDefinition } from '../../engine/externalData.js';
import { JsonWorkloadBudget } from '../../engine/jsonWorkloadLimits.js';
import type { DraftRecovery } from '../shared/DraftRecovery.js';
import { draftSource, sameDraftSource } from '../shared/draftSource.js';
import type { AnimationEditorState, ReadonlyAnimation } from './AnimationEditorState.js';
import { inspectEditorAnimation } from './validatedAnimation.js';

type Recovery = Pick<DraftRecovery<ReadonlyAnimation | null>, 'bind' | 'unbind' | 'update' | 'recoverDocuments'>;
const catalogContext = z.strictObject({ rigSource: z.string(), animation: z.unknown() });

/** Bind recovery to character/animation sources and distinguish explicit imports from ordinary navigation. */
export class AnimationDraftRecoveryController {
  private release: (() => void) | undefined;
  private state: AnimationEditorState | undefined;
  private characterId = '';
  private animation: string | null | undefined;
  private source: ReadonlyAnimation | null | undefined;
  private importRevision = 0;
  private visitedSources = new WeakSet<object>();
  private loadedIds = new Set<string>();

  constructor(
    private readonly recovery: Recovery,
    private readonly pathname: string,
  ) {}

  bind(state: AnimationEditorState, characterId: string): void {
    this.unbind();
    this.visitedSources = new WeakSet();
    this.state = state;
    this.characterId = characterId;
    this.loadedIds = new Set(state.animationIds);
    this.importRevision = state.importRevision;
    this.recoverMissingAnimations(state);
    this.release = state.subscribe(() => this.synchronize());
    this.synchronize();
  }

  private recoverMissingAnimations(state: AnimationEditorState): void {
    const rigSource = draftSource({ rig: state.sourceRig });
    const missingName = (key: string): string | undefined => {
      try {
        const parts = z.tuple([z.string(), z.string(), z.string()]).parse(JSON.parse(key));
        return parts[0] === this.pathname.replace(/\/rig-editor(?=\/|$)/, '/animation-editor') &&
          parts[1] === this.characterId &&
          !state.animationIds.includes(parts[2])
          ? parts[2]
          : undefined;
      } catch {
        return undefined;
      }
    };
    this.recovery.recoverDocuments(
      (key) => missingName(key) !== undefined,
      (draft) => {
        const name = missingName(draft.key);
        if (!name || !state.rig) return undefined;
        const context = catalogContext.safeParse(draft.context);
        if (draft.context !== undefined && (!context.success || context.data.rigSource !== rigSource)) return undefined;
        // Legacy orphan drafts have no source metadata; offer their validated data as a new unsaved clip.
        const sourceInput = context.success ? context.data.animation : draft.data;
        try {
          new JsonWorkloadBudget().checkAnimation(sourceInput);
          new JsonWorkloadBudget().checkAnimation(draft.data);
          const source = inspectEditorAnimation(sourceInput, state.rig).data;
          const working = inspectEditorAnimation(draft.data, state.rig).data;
          if (!source || !working || source.name !== name || working.name !== name) return undefined;
          const sourceIdentity = draftSource({ rig: state.sourceRig, animation: source });
          if (context.success && !sameDraftSource(draft.source, sourceIdentity)) return undefined;
          return {
            label: `animation "${name}"${context.success ? '' : ' (legacy draft)'}`,
            source: sourceIdentity,
            restore: () => {
              const restored = state.recoverAnimation(source, working);
              if (restored && state.sourceAnimation) this.visitedSources.add(state.sourceAnimation);
              return restored;
            },
          };
        } catch {
          return undefined;
        }
      },
    );
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
            ...(!this.loadedIds.has(animation)
              ? {
                  context: { rigSource: draftSource({ rig: state.sourceRig }), animation: source },
                }
              : {}),
            label: `animation "${animation}"`,
            snapshot: () => state.workingAnimation,
            dirty: () => state.dirty,
            committed: () => !state.hasPendingAnimationEdits,
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
