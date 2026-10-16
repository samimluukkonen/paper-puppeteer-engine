# IK constraint authoring foundation

[All guides](../README.md#guides)

The Rig Editor model and controller can create, select, edit and remove constraints for loaded characters and New Character drafts. React authoring controls and draggable rig handles are deferred. The existing two-bone solver, animation tracks and baking format remain in use.

## Data and APIs

`TwoBoneIKDefinition.name` is the persistent ID, shared with `ikTracks` and `disabledIKConstraints`. A chain requires `rootBone → middleBone → endBone`, with both links directly parented. Bone names have no anatomical meaning. Supported optional settings are `endOffset`, `target`, `mix`, `bendDirection`, `enabled` and `priority`. Lower priorities solve first; ties retain array/registration order. Overlapping chains remain supported in that order; constraints do not reference one another by ID.

The renderer-independent `/core` entry point exports these immutable operations and their option types:

```ts
import {
  createIKConstraint,
  updateIKConstraint,
  removeIKConstraint,
  ikConstraintDependencies,
} from 'paper-puppeteer-engine/core';

const created = createIKConstraint(rig, {
  name: 'tailIK',
  rootBone: 'tailBase',
  middleBone: 'tailMiddle',
  endBone: 'tailTip',
});
const edited = updateIKConstraint(created, 'tailIK', {
  target: { x: 30, y: 80 },
  mix: 0.7,
  bendDirection: -1,
  enabled: true,
  priority: 2,
});
const dependencies = { animations: allWorkingClips, references: hostReferencesForIK };
const references = ikConstraintDependencies(edited, 'tailIK', dependencies);
const removed = removeIKConstraint(edited, 'tailIK', dependencies);
```

`CreateIKConstraintOptions` uses the existing definition. `IKConstraintPatch` excludes `name`; runtime validation also rejects identity changes and unknown settings. `getIKConstraint(rig, id)` resolves a stable name. Standalone callers must supply all relevant animations and host references when changing chains or removing constraints.

`RigEditorState` exposes matching create/update/remove/get/dependency methods, `selectIKConstraint(id)` and `selectedIKConstraintId`. Creation selects the new constraint. Bone/slot selection clears IK selection; deletion clears an absent IK selection. Each successful authored command forms one history entry, with no entry for a no-op. Invalid commands leave the working snapshot and history untouched. `RigEditor` wraps the authoring commands and refreshes/rebinds preview consumers; it supplies the current bone-local pose for initial placement. Existing constraints retain their IDs and array positions when edited. Preview reconstruction does not replace document owners or histories.

## Coordinates and defaults

The optional `target: { x, y }` is in the outer puppet container's local coordinates, the same space as animation IK positions. It includes the rig's root transform and excludes facing, camera, host placement and enclosing containers. `endOffset` remains in end-bone local coordinates.

Creation without an explicit target composes existing affine utilities through the hierarchy and places the target at the current end contact point. Pure/model calls use the current bind rig unless supplied a `ReadonlyMap<string, Readonly<JointTransform>>` as the third argument; supplied transforms are bone-local and missing entries use bind transforms. Explicit parent lengths use the existing `Rig` normalization. Omitted bend direction follows the current signed chain turn, choosing `1` for a straight chain, to preserve the initial pose where the existing solver supports its scales.

Runtime providers and explicit world targets retain precedence. Animation position channels override the default target; missing coordinates and unowned fractions use that default. Without a default target, previous endpoint fallback and position-ownership fading remain unchanged. Clearing runtime overrides returns control to animation/defaults. The shared isolated sampler uses the same default for inspector and bake evaluation. Existing solver limitations, including internal nonuniform root scale, are unchanged.

## Validation, dependencies and history

Authoring validates the complete candidate through existing schemas and `Rig`: bone existence, hierarchy/cycles, directly connected chains, unique names, finite coordinates/priority/offsets, mix in `0..1`, bend `1 | -1` and boolean enablement. No persistent identity uses an index.

Removal and chain/endpoint changes inspect every working animation's IK track, including empty track placeholders, baked suppression metadata and live host references. `createCharacterDocuments` supplies all animation sessions automatically; `RigEditorStateOptions.ikReferences` supplies specialized foot/weapon/provider dependencies and reserves their names. Source data and animation keys are never cascaded or rewritten. Errors identify the dependent animation or host and require explicit resolution before retrying. Target, mix, bend, enabled and priority edits retain animation references.

The same checks protect rig undo/redo, reset and recovery when new references were added after a rig edit. Animation undo/redo, source revert and saved-session restoration validate against the current rig before restoring an older reference. Restore the required rig constraint first to recover those animation snapshots. Valid current recovery envelopes preserve authored IK changes; legacy raw imports retain compatibility checks.

## Serialization and verification

Rig JSON stays at version 1: `target` is an additive optional field in the existing IK definition and generated rig schema. Older rigs without targets retain their previous behavior. Export preserves constraint order and exact IK numbers, including targets, offsets, mix and priority, when constraints are edited, removed or inserted. The source rig is immutable, and selection, preview settings and history stay outside exported JSON.

`tests/ikAuthoring.test.ts` covers arm/leg/nonhuman chains, endpoint placement, patches, rejection, dependencies, history/recovery, source immutability, JSON round trips, new documents, shipped compatibility and animation restoration. `tests/rigEditorActivation.test.ts` exercises real controller reconstruction; `tests/ikAnimationRuntime.test.ts` checks local defaults, facing, animation and runtime/provider precedence. Run `npm run typecheck`, `npm run test` and `npm run build`. Browser smoke tests remain local-only.

## Files changed

| Area                                      | Files                                                                                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring APIs and exports                | `src/engine/ik/ikAuthoring.ts`, `src/engine/core.ts`, `src/engine/data.ts`                                                                                                                                              |
| Existing IK model, schema and evaluation  | `src/engine/ik/types.ts`, `src/engine/schemas.ts`, `schemas/rig.schema.json`, `src/engine/ik/TwoBoneIKConstraint.ts`, `src/engine/ik/IsolatedIKSampler.ts`                                                              |
| Rig document and controller               | `src/devtools/rig-editor/RigEditorState.ts`, `src/devtools/rig-editor/RigEditor.ts`, `src/devtools/rig-editor/rigDraftRecovery.ts`, `src/devtools/rig-editor/rigSerialization.ts`                                       |
| Shared workspace and animation references | `src/devtools/shared/newCharacter.ts`, `src/devtools/animation-editor/AnimationEditorScene.ts`, `src/devtools/animation-editor/AnimationEditorDocument.ts`, `src/devtools/animation-editor/AnimationEditorSelection.ts` |
| Regression tests                          | `tests/ikAuthoring.test.ts`, `tests/rigEditorActivation.test.ts`, `tests/ikAnimationRuntime.test.ts`, `tests/animationEditorScene.test.ts`                                                                              |
| Documentation                             | `README.md`, `docs/ik-constraint-authoring.md`, `docs/ik-animation-runtime.md`, `docs/rig-editor.md`, `docs/schema-compatibility.md`                                                                                    |
