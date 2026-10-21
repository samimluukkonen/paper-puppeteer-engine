# Animation and Scene ground integration (v0.9.8.3)

[All guides](../README.md#guides) · [Marker authoring](foot-contact-markers.md) · [Ground reference](ground-reference.md)

Foot contacts are deliberate authoring references. Displaying them, scrubbing, playing, changing facing or moving the ground never creates animation keys or moves an Actor. Ground settings remain browser metadata. Marker visibility, selection, tolerance and alignment proposals are session-only view state and do not enter exports or recovery data.

## Transform calculations

Both editors read final synchronized bone-local transforms, after FK, animated IK and all solver passes. The existing evaluator applies the attached bone, each parent, then the full Puppet world affine:

```text
contactWorld = puppetToWorld × root × … × attachedBone × contactLocal
distance = contactWorld.y - groundY
```

Puppet placement includes facing as signed X scale, Actor translation, uniform/nonuniform outer scale, rotation and enclosing transforms. Each applies exactly once. Root-bone animation is independent of the outer Puppet transform and is included. Camera projection never enters this calculation. Animation Editor uses fixed preview-world ground; Scene Editor uses scene-world ground. Neither line follows the character.

Y grows downward. A positive signed distance is below ground, a negative distance is above ground, and `abs(distance) <= tolerance` is on ground. Default tolerance is **0.5 world units**, editable in Animation Editor with a finite positive value. Diagnostics are informational and do not enable collision or constrain playback.

## Animation Editor

1. Load a walking clip. Expand the initially collapsed **Ground reference**, enable **Show ground guide**, and check **Show foot contact markers**.
2. Choose any **Foot contact marker**, or click its crosshair. Dropdown entries include stable IDs to distinguish duplicate display names and overlapping contacts. No left/right/lowest contact is selected automatically. Live distances list every visible contact. Green indicates on ground, blue above, red below; the selected contact is amber. Facing and the optional mirrored-pose overlay also project contacts.
3. Scrub to a desired contact pose. Confirm a **Foot IK constraint** whose end bone is the marker's bone or an ancestor of it. Multiple constraints remain explicit choices; unrelated constraints are excluded. A missing applicable constraint explains that manual posing or an existing IK setup is required.
4. Use **Align Selected Foot Contact to Ground** to pause and preview a proposed correction. The original character pose remains untouched; a purple overlay and purple contact show the proposal. Cancel restores the unmodified view without creating keys or Undo entries.
5. Inspect the signed residual and solver status. **Apply IK target keys** is enabled only when the evaluated marker is within tolerance. Apply writes normal target X/Y keys at the held playhead, as one animation Undo/Redo operation. Bone tracks, events, influence, rig data and ground settings remain unchanged. Undo restores the previous clip, and Redo restores the committed correction.

The requested IK target and contact are different points. Planning preserves requested **world X** and searches target **world Y**, converting each candidate with the full Puppet inverse:

```text
candidateTargetLocal = inverse(puppetToWorld) × (originalTargetWorld.x, candidateWorldY)
```

The planner uses the existing key authoring API on detached candidates and the existing `IsolatedIKSampler`/`TwoBoneIKConstraint` solver. Each candidate starts from the authored pose, runs all rig constraints in order and verifies the final marker, including its own offset, the IK end offset, influence, later constraints and stepped playback. The initial evaluated endpoint provides an additional seed for requests already clamped far beyond reach. A bounded scalar Newton search with line search keeps the best measured residual; it does not implement another IK solver or modify a constraint.

If chain reach, influence, unsupported/singular transforms or interactions prevent convergence, the preview reports **Alignment limited**, signed residual and solver status. It cannot be applied. A bounded search does not prove that no other target could align the foot. It only reports what this operation achieved while retaining target world X. Some stepped poses may also resist a key at a playhead between held frame times; the residual reflects the actual eventual clip evaluation, not a hypothetical unsnapped pose.

Ground, time, clip, mode, rig, selection, draft and outer-affine changes discard proposals. Apply rechecks runtime ownership and the live pose. Finish/cancel temporary edits first. Runtime providers/targets, additional active preview chains, mix overrides and other deviations from authored IK settings are rejected; release those owners before alignment. Pose presets/external pose edits must match the authored clip before planning or applying. No constraint is fabricated, enabled or reconfigured for this workflow.

The existing **Align IK target Y to guide** and temporary target-drag snapping remain available as explicitly labeled requested-target operations. They do not use a foot contact and do not promise sole alignment.

## Scene Editor

1. Add two characters with different skeleton/artwork sizes or existing Puppet scales. Enable the initially collapsed **Scene ground** guide.
2. Select an Actor. **Show selected Actor contacts** shows only that Actor's evaluated markers, including during scene playback and scrubbing. Choose **Actor foot contact marker**; choosing one also reveals its contacts.
3. Stop playback and use **Snap Actor to Ground**. Initial-pose FK/IK, rig/bone transforms, facing and the live Puppet scale determine the selected contact's actual world position. The explicit operation records only the Actor's initial Y in one scene Undo/Redo edit:

```text
offsetY = contactWorld.y - actor.position.y
newInitialY = groundY - offsetY
             = oldInitialY + (groundY - contactWorld.y)
newInitialX = oldInitialX
```

4. Repeat for the second Actor. Different contacts can be at different heights; only the chosen marker determines alignment. No bone is moved to force another contact down.
5. Play or scrub choreography. Markers follow the current runtime pose and position, while paths and animation remain authoritative. Grounding is disabled until Stop restores authoring. A scrubbed runtime pose is diagnostic and is never written back as an initial transform.

Optional **Snap to Ground** placement drags use the same selected marker and existing gesture history; Shift bypasses snapping. Numeric Actor fields remain ordinary unconstrained edits. Marker selection never defaults to a left/right/lowest contact or falls through to legacy artwork when a rig has contacts but none is selected/available.

For rigs without markers, the existing **Align Feet to Ground** attachment-contact calculation remains available and is labeled **Legacy fallback**. It uses the lowest authored sole point on loaded active foot artwork, not an inferred rig marker or Actor origin. Without a usable legacy sole point, alignment is disabled and manual placement is required. There is no invented contact. Scene format v2 remains unchanged and does not gain a new Actor scale field; existing rig/Puppet scaling is included in the measurements.

Snapping never edits character rigs, animation keys, movement destinations, timing or physics. Contact IDs are transient editor selections, not serialized references. Switching scenes clears these selections. Both scene and animation Undo/Redo retain their existing document boundaries.

## Implementation and verification

- `shared/footContactGround.ts`: synchronized marker evaluation and signed diagnostics.
- `animation-editor/footContactAlignment.ts`: detached candidate planning and final post-IK verification.
- `FootContactGroundController.ts`, `FootContactGroundPanel.tsx`, `AnimationGroundPanel.tsx`, `AnimationEditorScene.ts`, `AnimationEditorGhostLayer.ts`, `editorMarkup.tsx`, `main.tsx`: view state, explicit preview/apply, overlays, rendering, selection and teardown.
- `scene-editor/SceneActorPreview.ts`, `SceneEditorDocument.ts`, `SceneGroundPanel.tsx`, `SceneStage.tsx`: initial-pose measurements, explicit marker selection, chosen-contact snapping, legacy fallback and selected runtime overlay.
- `tests/footContactGroundIntegration.test.ts`: FK/IK, root motion, animation playback/scrubbing, distance sign/tolerance, full coordinate inversion, distinct marker/endpoint offsets, initially clamped/unreachable targets, partial influence, stepped sampling, missing constraints, shared rig edits, proposal cancellation, ownership, single-edit Undo/Redo, two Actors, facing/scale, scene seeks and authored-data isolation.
- `tests/browser/footContactGroundIntegration.spec.ts`: local desktop React/Phaser preview/cancel/apply, Undo/Redo, animation scrubbing/facing, selected-marker grounding for two shipped character sizes and scene preview isolation. Test-only marker definitions are injected into fetched rigs; shipped assets remain unchanged.
- Existing `tests/animationEditorScene.test.ts`, `tests/sceneGroundGuide.test.ts`, and `tests/browser/animationGroundGuide.spec.ts`: updated scene fixtures and legacy fallback/target-command assertions.
- `shared/guides/animationGuides.ts`, `shared/guides/sceneGuides.ts`, `docs/development.md`, `docs/foot-contact-markers.md`, `docs/ground-reference.md`, `docs/scene-editor.md`, and `CHANGELOG.md`: feature tours, architecture, artist workflows and versioned release notes.

No physics, automatic foot locking, gait detection, sliding correction, terrain or runtime grounding is added. Browser checks stay local-only.

Verification on 2026-10-21:

| Command             | Result                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | Passed.                                                                                                                                       |
| `npm run test`      | Passed: 190 test files, 3,317 tests; 5 files / 56 tests skipped. Final run: 46.69 seconds.                                                    |
| `npm run check`     | Passed: formatting, lint and typecheck.                                                                                                       |
| `npm run build`     | Passed: demo, library, declarations and Node core-entry verification. Vite reports the existing lucide-react `use client` directive warnings. |

`PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/footContactGroundIntegration.spec.ts tests/browser/animationGroundGuide.spec.ts tests/browser/groundGuide.spec.ts` passed all **10 local desktop scenarios** across development and production in **2.5 minutes**.

The first sandboxed local-browser launch failed with `EPERM` binding localhost. Local servers were then run outside the sandbox. An initial new browser test used an exact label lookup that missed select controls despite their correct accessible names; role/name selectors corrected the test. These failures did not change authored data or require browser/CI configuration changes. There are no outstanding verification failures.
