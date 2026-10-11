# Visual IK target manipulation

[All guides](../README.md#guides)

Milestone **v0.5.5.4** (package `0.5.5-4`) adds draggable target crosshairs to the Animation Editor. The bundled Demo Puppet exposes `rightArmIK` and the existing `rightLegIK` chain for hand and foot authoring. Random paperdoll sketch exposes all four existing chains: `leftArmIK`, `rightArmIK`, `leftLegIK`, and `rightLegIK`. Choose it from the Character picker to drag either hand or foot.

## Authoring behavior

Select a crosshair or its IK timeline row. Dragging pauses playback and holds the exact current time. The inspector and timeline selection follow the constraint, including when a handle overlaps the hand/foot joint. Dragging preserves the initial grab offset.

Release retains temporary X/Y values. **Set Target Key** writes both coordinates at the held playhead in one history operation. Individual **Set Key** buttons retain their property-only behavior. Influence is preserved and is never automatically raised. Temporary values neither dirty the document nor enter exports, recovery drafts, source animations, bind poses, or neighboring onion-skin samples.

**Escape during a drag** restores the preview from before that gesture, including any earlier numeric draft or released drag. Cancel IK edits clears all provisional IK values. Selection changes, time navigation, imports/session changes, history, hiding/locking handles, loss of window focus, and shutdown cancel active gestures. Play is blocked during a drag; after release it discards drafts using existing playback semantics.

The crosshair is the **requested target**; the small circle at the hand/foot is the **solved contact point**. A connecting line shows the difference, including partial influence and unreachable targets. Requested coordinates remain unclamped. Selected handles are larger gold crosshairs with a translucent highlight; ordinary handles are teal, and disabled/locked handles gray. Thick white and dark outlines keep both selected and unselected targets visible against the artwork. Hit areas match the enlarged markers, and the selected marker draws last. Show IK targets and Drag IK targets independently control visibility and manipulation. Hidden handles do not intercept bone selection. Wheel zoom and middle-button pan reuse the existing editor camera utilities.

## Rendering and coordinates

`AnimationEditorIKHandles` owns one Phaser Graphics object per scene session, reused for all real rig constraints. It is created and disposed alongside `AnimationEditorPreview`; production character rendering never creates these objects. Rendering and hit radii remain stable in preview viewport pixels as camera zoom changes.

`pointerToIKTarget` calls the camera's `getWorldPoint`, then applies the inverse of the full outer puppet world matrix through the existing affine utility. `ikTargetToWorld` performs the forward conversion. Camera zoom/pan, puppet translation, scale, rotation, facing, and enclosing containers therefore use explicit coordinate conversions. Singular transforms disable manipulation instead of writing nonfinite keys.

Preview overlays the selected constraint's draft channels on its existing sampled animation pose. `Puppet.setIKAnimationSource` now accepts a read-only source with `ikAnimation`, including the existing AnimationPlayer. This keeps provisional channels outside the working clip and routes every solver pass through the same existing priority ordering and mathematics. Bend, joint hierarchy, influence, and unreachable behavior remain owned by the existing solver.

## Ownership and React synchronization

`TwoBoneIKConstraint.targetOwnership` exposes read-only position ownership: `provider`, `runtime`, or `animation`. Installed providers, including providers returning no point, retain priority over authored targets. Runtime world targets retain their position ownership. Disabled constraints and singular puppet transforms also prevent direct dragging. The inspector explains how to release the owner; the handle still selects its constraint. The new combined commit is unavailable while an owner blocks manipulation. Existing single-property authoring remains available to prepare animation keys beneath that owner.

No target setter/provider is installed or cleared by dragging. Weapon primary/secondary grip, foot planting, explicit influence overrides, and dependent constraint order retain their existing policy. Fixed-target preview explicitly owns targets; disabling it restores normal authoring.

The state facade coordinates gesture notifications with playback and document history. `IKInspectorController` exposes cached snapshots for React, including dragging and disabled reasons. External canvas draft changes replace stale numeric text. Scene shutdown/error handling releases Graphics, input/window listeners and subscriptions; React does not recreate Phaser handles on renders. Onion skins and mirror overlays remain independent render-only layers sampled from committed data.

## Files and APIs

| Files                                                                              | Changes                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AnimationEditorIKHandles.ts`, `ikTargetCoordinates.ts`                            | Editor overlay, picking, pointer ownership, cancellation, camera controls, explicit affine conversion.                                     |
| `AnimationEditorIKCommands.ts`, `AnimationEditorState.ts`                          | `beginIKTargetDrag`, `previewIKTargetDrag`, `endIKTargetDrag`, `cancelIKTargetDrag`, `commitIKTarget`, gesture and availability accessors. |
| `AnimationEditorPreview.ts`, `AnimationEditorScene.ts`                             | Draft IK channel overlay, handle lifecycle, visibility/interaction setters, bone-picking priority.                                         |
| `IKInspectorController.ts`, `IKInspectorPanel.tsx`, `editorMarkup.tsx`, `main.tsx` | Cached drag/status snapshots, combined commit, controls and lifecycle bindings.                                                            |
| `Puppet.ts`, `TwoBoneIKConstraint.ts`                                              | Structural read-only animation source and read-only position ownership; unchanged precedence/solver.                                       |
| Demo Puppet rig, package manifests, unit/browser tests, guides                     | Existing foot chain exposed for authoring, milestone metadata and verification.                                                            |

The serialized format stays at version 1. No new solver or export field is introduced.

## Verification and manual checklist

`tests/animationEditorIKHandles.test.ts` covers hand/foot selection, live solver preview, explicit combined commit and history, cancellation restoring prior drafts, exact playhead preservation, source/working immutability, dirty/export behavior, onion sampling isolation, unreachable targets, zero/partial influence, both facing directions, nested affine transforms and puppet scale, ownership including empty providers, hidden/locked controls, pointer identity, camera controls, React adapter synchronization, and disposal.

`tests/browser/animationIKHandles.spec.ts` exercises actual Phaser crosshair pixels and React controls in local development and production. It walks through hand and foot drag/cancel, release/commit, two keys, playback interruption, history, draft-free export, facing, zoom/pan, onion skinning, ownership, visibility/interaction toggles, export reload and page reload. Browser tests remain local-only, outside CI.

Human manual checklist (use Demo Puppet in Animation Editor):

1. Select `rightArmIK`; drag its crosshair and verify the arm follows. Escape restores the prior target.
2. Drag again, release, and choose Set Target Key. Scrub to another time, drag and commit a second key, then play.
3. Repeat for `rightLegIK`. Verify that Undo/Redo restores X and Y together.
4. Switch facing, wheel zoom, and middle-drag pan; repeat dragging at each view.
5. Request a distant unreachable target; confirm the crosshair stays at that position while the limb stops at its reachable extent.
6. Preview influence at 0 and between 0 and 1; dragging must preserve the value.
7. Enable onion skins; provisional movement must not change neighboring ghosts. Export before commitment and verify that keys are unchanged.
8. Enable fixed IK preview; confirm gray handles and the provider explanation. Disable it to resume direct authoring.
9. Hide handles or lock dragging during a gesture, navigate away, reload, and confirm clean cancellation and working input after return.

Verification on 2026-10-11:

| Check                                       | Result                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run typecheck`                         | Passed.                                                                      |
| `npm run test`                              | 1,795 passed; 32 existing skipped tests. Includes 25 new handle regressions. |
| `npm run build`                             | Passed: demo, library, declarations, and built Node `/core` verification.    |
| `npm run check`                             | Formatting, type-aware lint, and typecheck passed.                           |
| `npm run check:version`, `git diff --check` | Passed.                                                                      |

All 12 final local Chrome scenarios passed across development and production: hand/foot handles, numeric IK authoring, runtime ownership, timeline selection, demo controls, and mirrored commits with onion skins. The hand/foot walkthrough drags and commits a second target key at another time before playback. The facing/onion-skin screenshot was visually reviewed. Playback uses quarter speed for reliable pixel-based picking of moving crosshairs. This is automated browser verification with screenshot review; the human checklist above remains available for manual testing.

The Random paperdoll sketch follow-up also passed typecheck, the full 1,795-test suite, build, formatting and lint. Its dedicated local browser walkthrough passed in development and production, dragging and committing all four targets, verifying Undo/Redo and exported X/Y keys, both facing directions, and fixed-preview ownership. Its four-handle onion-skin screenshot was visually reviewed.

## Deferred features

IK baking, mirrored target copying, generic IK batch/clipboard/marker dragging, new solvers, constraint creation UI, physics, scene choreography, and rig joint modification remain outside this milestone. Existing bone/key mirroring is unchanged.
