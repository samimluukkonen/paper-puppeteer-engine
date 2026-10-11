# React IK Baking

[All guides](../README.md#guides)

The Animation Editor's **IK Baking** panel converts selected hand or foot IK into ordinary bone rotation tracks over the entire animation. It uses the existing [sampler](ik-bake-sampling.md), [generator](ik-bake-generation.md) and [atomic commit](ik-bake-commit.md). Source assets and rig constraints stay immutable.

## Artist workflow

1. Open the Animation Editor with Demo Puppet or Random paperdoll sketch and select an animation with authored hand IK targets. You can create a reach with the [visual IK controls](visual-ik-targets.md).
2. Turn off **fixed-target IK preview**. Baking consumes authored animation; runtime targets and providers cannot be baked.
3. Open **IK Baking** in the command bar. Check the intended hand constraint. No constraints are selected automatically. Each row identifies the two bones that receive rotation keys. Disabled or previously baked constraints show their reason.
4. Enter a positive sampling FPS, for example **10**. The range is always the full animation, including its exact endpoint. Output interpolation is **Linear**, the supported version-1 mode. Sampling FPS controls key density; authored smooth/stepped playback and its FPS are preserved.
5. Review **Bake summary**: selected constraints, affected bones, generated property keys, existing rotation keys to replace, sampling FPS and constraints to deactivate for this animation. Counts come from the validated plan. Warnings describe the limits of between-sample fidelity.
6. Click **Preview Bake**. Playback pauses. The normal puppet shows original IK; the violet overlay shows the proposed baked animation. Scrub the existing timeline to compare both results, including between samples. Hide the overlay to inspect the original alone. Preview does not create keys, mark dirty, add history or fire animation events.
7. Click **Bake IK**. Playback pauses, selected bone rotation tracks update, selected IK tracks are removed and those constraints are deactivated for this animation. Other tracks, events, constraints and playback metadata are preserved. The timeline and puppet refresh through the existing editor subscription.
8. Close the panel and expand the affected bones to inspect the generated rotation tracks. Play the result. Click **Undo** once to restore the exact original IK animation; **Redo** restores the baked result.
9. Repeat with an authored leg/foot IK target. Multiple disjoint constraints can be selected together. Download JSON to save the committed animation in your project.

Errors disable Preview and Bake. Feedback covers missing constraints, invalid FPS or animations, missing references, unsupported scales, overlapping driven bones, and runtime ownership/non-deterministic providers. Fix the reported condition and review the regenerated summary. Very dense sample grids are subject to the existing sampler's limits.

## State and preview ownership

`IKBakePanel` subscribes to cached `IKBakeController` snapshots through React's `useSyncExternalStore`. The controller owns selection of bake constraints, FPS text, the detached plan and feedback. Animation data, bone/IK selection, time and history belong exclusively to `AnimationEditorState`.

The controller validates a proposal by invoking pure engine `commitIKBake` without installing its result. Preview evaluates that exact candidate with the existing `IsolatedIKSampler`, preserving sibling bone properties, unselected procedural IK and authored playback quantization. `AnimationPoseOverlay` draws it independently of the active puppet and onion skins. Facing, placement and artwork changes follow the active puppet. Preview start clears temporary authoring drafts; a new draft hides the comparison.

Clock updates sample the cached candidate without rerunning full-clip planning or rerendering the panel. Options, authored snapshot changes and runtime configuration invalidate the candidate; changing animation, importing or replacing a session also clears constraint selection. Closing/unmounting the panel releases the overlay. Unbinding/disposal releases editor subscriptions and cached clips; scene shutdown destroys artwork resources.

**Bake IK** invokes `AnimationEditorState.commitIKBake` once. Its existing document installation boundary handles dirty state, timeline reconciliation and one history snapshot. The React component contains no animation mutation logic.

## Verification

Unit coverage exercises selection, real summary counts, FPS validation, unknown/overlapping constraints, unsupported scales, runtime ownership without provider calls, preview scrubbing/non-mutation/events, commit invocation, exact Undo/Redo, document/session synchronization, replaced-state subscriptions, React unmount and render-layer disposal.

The local browser scenario `tests/browser/animationIKBaking.spec.ts` walks through both animated hand and leg IK: selection, FPS/error recovery, summary, visual preview/scrubbing, runtime guard, commit, generated timeline keys, playback, one-step Undo, original artwork restoration, animation switching and reload. Run it against development and production builds:

```bash
npm run typecheck
npm run test
npm run build
npx playwright test tests/browser/animationIKBaking.spec.ts
```

Browser checks remain local-only. The numbered artist workflow is also the manual verification checklist; automated coverage does not constitute a human visual review.

Partial ranges, automatic key reduction, solver configuration, mirrored IK baking, retargeting and physics remain deferred.
