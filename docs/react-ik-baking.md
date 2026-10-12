# React IK Baking

[All guides](../README.md#guides)

The Animation Editor's **IK Baking** panel converts selected hand or foot IK into ordinary bone rotation tracks over the entire animation. It uses the existing [sampler](ik-bake-sampling.md), [generator](ik-bake-generation.md) and [atomic commit](ik-bake-commit.md). Source assets and rig constraints stay immutable.

## Artist workflow

1. Open the Animation Editor with Demo Puppet or Random paperdoll sketch and select an animation with authored hand IK targets. You can create a reach with the [visual IK controls](visual-ik-targets.md).
2. Turn off **fixed-target IK preview**. Baking consumes authored animation; runtime targets and providers cannot be baked.
3. Open **IK Baking** in the command bar. Check the intended hand constraint. No constraints are selected automatically. Each row identifies the two bones that receive rotation keys. Disabled or previously baked constraints show their reason.
4. Enter a positive sampling FPS, for example **10**. The range is always the full animation, including its exact endpoint. Output interpolation is **Linear**, the supported version-1 mode. Sampling FPS controls key density; authored smooth/stepped playback and its FPS are preserved.
5. Wait for **Preparing bake…** to finish, then review **Bake summary**: selected constraints, affected bones, generated property keys, existing rotation keys to replace, sampling FPS and constraints to deactivate for this animation. Counts come from the validated plan. **Bake fidelity** separates agreement at generated keys from measured midpoint/near-end drift, with maximum joint angles and endpoint distances. Between-key targets are 2° and 1 rig unit; warnings report actual error beyond those targets. Increase FPS and preview again. Key-time disagreement blocks baking. See [fidelity conventions and limits](ik-bake-hardening.md).
6. Click **Preview Bake**. Playback pauses. The normal puppet shows original IK; the violet overlay shows the proposed baked animation. Scrub the existing timeline to compare both results, including between samples. Hide the overlay to inspect the original alone. Preview does not create keys, mark dirty, add history or fire animation events.
7. Click **Bake IK**. Playback pauses, selected bone rotation tracks update, selected IK tracks are removed and those constraints are deactivated for this animation. Other tracks, events, constraints and playback metadata are preserved. The timeline and puppet refresh through the existing editor subscription.
8. Close the panel and expand the affected bones to inspect the generated rotation tracks. Select, edit, move/group-move, delete, copy/paste or duplicate them as ordinary bone keys. Interpolation remains clip-wide linear; smooth/stepped playback is independent. Each edit has normal Undo history; undoing the bake restores the exact original IK animation. **Redo** restores the baked result.
9. Repeat with an authored leg/foot IK target. Multiple disjoint constraints can be selected together. Download JSON to save the committed animation in your project.

Errors disable Preview and Bake. Feedback covers missing constraints, invalid FPS or animations, missing references, unsupported scales, overlapping driven bones, and runtime ownership/non-deterministic providers. Fix the reported condition and review the regenerated summary. Very dense sample grids are subject to the existing sampler's limits.

## Example: convert a reaching arm

Use IK keys while positioning a hand is more convenient than posing both arm joints. In Demo Puppet, create `rightArmIK` target X/Y keys at the start, halfway through and at the end of a one-second reach, keeping influence at 1. Move the hand toward the object with the visual IK handle and **Set Target Key**. The solver poses `rightUpperArm` (shoulder) and `rightForearm` (elbow); IK keys store desired hand positions and influence rather than those bone angles.

Open **IK Baking**, select only `rightArmIK` and start with 10 FPS. A one-second clip generates 11 rotation keys per driven bone, including zero and the exact endpoint. Preview the violet result at keys and halfway between them. If the hand drifts or the report warns, try 12 or 60 FPS. Sampling does not lengthen the reach. For authored stepped playback, use its FPS or an integer multiple; incompatible grids can fail key-time checks.

Commit when the approximation suits the shot. The shoulder and elbow now have editable rotation keys; the selected IK target track is removed and its constraint is deactivated for this animation. Select the elbow's midpoint rotation key to refine its silhouette, move shoulder/elbow keys together, or copy them to another time. Onion skins show the authored baked arm motion. Bone mirroring preserves remaining IK data and suppression. Undo edits first, then Undo the bake to return to target authoring.

Bake for direct joint control, ordinary bone-key editing or a saved clip that reproduces authored solved poses without procedural IK. Keep IK authoring when the hand/foot should remain target-driven. Smooth interpolation approximates continuous solving; finite probes cannot guarantee every moment. Crossfades and partial layers retain runtime suppression weighting, so IK-to-baked transitions may differ from either fully owned pose. See [transition limitations](ik-bake-hardening.md#constraint-and-transition-behavior).

## State and preview ownership

`IKBakePanel` subscribes to cached `IKBakeController` snapshots through React's `useSyncExternalStore`. The controller owns selection of bake constraints, FPS text, the detached plan and feedback. Animation data, bone/IK selection, time and history belong exclusively to `AnimationEditorState`.

The controller debounces option and authored-data changes for 200 ms while the panel is open. A dedicated Web Worker performs sampling, generation and pure engine `commitIKBake` verification without installing its result. Pending work disables Preview and Bake; subsequent edits terminate the previous worker and discard late replies. Runtime ownership is checked without invoking providers before work starts, when its result returns and before installation. Preview evaluates that exact candidate with the existing `IsolatedIKSampler`, preserving sibling bone properties, unselected procedural IK and authored playback quantization. `AnimationPoseOverlay` draws it independently of the active puppet and onion skins. Facing, placement and artwork changes follow the active puppet. Preview start clears temporary authoring drafts; a new draft hides the comparison.

Clock updates sample the cached candidate without rerunning full-clip planning or rerendering the panel. Options, authored snapshot changes and runtime configuration invalidate the candidate; changing animation, importing or replacing a session also clears constraint selection. Closing/unmounting the panel releases the overlay and cancels pending planning. Unbinding/disposal also cancels timers/workers and releases editor subscriptions and cached clips; scene shutdown destroys artwork resources.

**Bake IK** installs the exact worker-verified candidate through `AnimationEditorState.replaceWorkingAnimation` after confirming that its source and runtime configuration remain current. This avoids rerunning full-clip solving on the UI thread. The existing document installation boundary validates authored JSON and its export budget, handles dirty state and timeline reconciliation, and records one history snapshot. The synchronous engine/state `commitIKBake` APIs remain available to other callers with their complete plan validation. The React component contains no animation mutation logic.

## Verification

Unit coverage exercises debounce, cancellation, stale replies, worker failures, exact transferred logical joints, selection, real summary counts, FPS validation, unknown/overlapping constraints, unsupported scales, runtime ownership without provider calls, preview scrubbing/non-mutation/events, commit invocation, exact Undo/Redo, document/session synchronization, replaced-state subscriptions, React unmount and render-layer disposal.

The local browser scenario `tests/browser/animationIKBaking.spec.ts` walks through both animated hand and leg IK: selection, FPS/error recovery, summary, visual preview/scrubbing, runtime guard, commit, generated timeline keys, playback, one-step Undo, original artwork restoration, animation switching and reload. A dense clip scenario also checks timeline navigation during preparation and worker termination when the panel closes. Run it against development and production builds:

```bash
npm run typecheck
npm run test
npm run build
npx playwright test tests/browser/animationIKBaking.spec.ts
```

Browser checks remain local-only. The numbered artist workflow is also the manual verification checklist; automated coverage does not constitute a human visual review.

Partial ranges, automatic key reduction, solver configuration, mirrored IK baking, retargeting and physics remain deferred.
