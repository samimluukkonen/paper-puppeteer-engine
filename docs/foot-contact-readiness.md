# Foot contact production readiness (v0.9.8.4)

[All guides](../README.md#guides) · [Marker authoring](foot-contact-markers.md) · [Animation and Scene workflow](foot-contact-ground-integration.md)

1. **Overall readiness.** The v0.9.8 workflow supports explicit bone-local contact authoring, evaluated visualization, verified IK correction and independent Actor grounding. This hardening adds three Feature Guide tours, artwork realignment guidance, bounded diagnostic renders, stale Actor-selection cleanup and cross-domain export regressions. All required automated gates pass for the intended explicit authoring workflow; results are recorded below and no human artist acceptance session was performed.

2. **Marker data model.** Rig format version 1 retains optional `footContactMarkers: { id, name, boneId, localX, localY }[]`. IDs are stable and unique; names can change without changing IDs. Coordinates must be finite and the bone must exist. Omitted/empty collections remain valid. Markers do not introduce animation tracks, texture-pixel coordinates or contact-phase data.

3. **Coordinate audit.** Evaluation uses `puppetToWorld × root × … × markerBone × localPoint`. Each bone uses its final local pose after FK/IK; missing pose entries use bind values. Bone-local rotations, negative/nonuniform scales, parent shear, root motion and the full outer affine are retained. Facing is an outer signed X scale and applies once. Actor translation is already in the Puppet world matrix. Camera transforms apply only to drawing and pointer conversion. The marker transform supports affine projection even where the existing IK solver cannot solve nonuniformly scaled chains. The pure evaluator returns no position for missing bones or nonfinite output; inverse-dependent authoring rejects singular transforms. Existing pure/runtime tests compare results against actual bone-container matrix projection to `1e-8` world units. Successful Animation Editor corrections must meet the selected tolerance (default **0.5 world units**); Scene translation checks use `1e-8` in the runtime tests and `0.001` in the shipped-character browser checks.

4. **Rig Editor workflow.** In the initially collapsed Foot Contact Markers section, select any bone, add a contact, name it and position the crosshair or Local X/Y fields at the sole. Show Ground reference and adjust Ground Y for visual alignment. Marker changes use rig Undo/Redo, recovery and rig export. Display-name changes preserve ID references. Marker definitions also remain rig-owned when using the shared workspace and Rig Tweak. All inspector sections retain their initially collapsed behavior and existing editor styling.

5. **Animation Editor workflow.** Enable the ground guide and contact markers, choose a contact and confirm an applicable existing foot IK constraint. Scrubbing, playback, skin/facing changes and marker visibility never create keys. Preview runs detached candidate evaluation and shows the actual residual; only Apply IK target keys commits ordinary target X/Y keys at the playhead as one Undo/Redo operation. Existing bone tracks and events remain unchanged. Time, rig, clip, facing, guide and ownership changes invalidate proposals. Missing/disabled/unreachable IK, externally owned targets and unsupported chains explain their limits and cannot report a successful commit. Mirrored and baked clips continue using the same final-pose marker evaluation.

6. **Scene Editor workflow.** Enable Scene ground, select an Actor, explicitly select its marker and Snap Actor to Ground. Only initial Y changes; X and choreography remain intact. Select the second Actor independently. Playback and scrubbing display runtime contacts without locking or moving them to the guide. Missing/unavailable selections cannot fall through to another rig marker. Rigs without markers retain the labeled legacy attachment-sole fallback; otherwise manual placement is required. Empty scenes keep marker selection disabled. Scene import/switch clears view selections. Actor deletion, character replacement and history transitions discard selections and measurements belonging to the previous Actor/character instance, preventing accidental reuse of a same-named marker.

7. **Export/import.** Rig JSON export/reload, recovery, character ZIP generation/decoding, CharacterLoader and Puppet export preserve definitions. Character ZIP regressions exercise both facings, every shipped clip, authored IK and baked IK. The browser artist workflow authors two contacts through real controls, reloads the rig, commits/undoes/redoes IK alignment, downloads/reloads the character ZIP, serves those exact files as a scene dependency, grounds a second differently proportioned character, plays/scrubs and reloads scene JSON plus the two-character scene ZIP. Scene packages retain rig markers and authored initial placement. Guide preferences, diagnostic positions and temporary marker selections are not exported. There is no separate general project format beyond the character and scene package workflows.

8. **Compatibility and dependency audit.** Old rigs omit the collection and load without migration. Character/rig format 1 and scene format 2 remain unchanged. Animation keys do not implicitly change. A repository reference audit found no persisted Scene grounding marker IDs, project asset marker-ID references or other authored marker-ID consumers: scene selections are view state. `RigEditorStateOptions.footContactReferences(id)` remains the explicit integration hook for hosts with external references. It guards delete, import, reset, recovery, Undo/Redo and ID reuse with messages naming the dependent documents. Current UI edits display names, not stable IDs; there is no silent ID rename. Bone deletion/rename is also blocked while markers reference that bone. External hosts must supply their own document references to the hook; the editor cannot inspect unrelated files outside the loaded workspace.

9. **Changed files and APIs.** `FootContactGroundController.ts` separates proposal invalidation from UI notifications and publishes text diagnostics at most ten times/second during steady playback, including the last pending sample. Canvas contacts remain current each frame. `shared/footContactGround.ts` skips pose/matrix allocation for rigs with no markers. `SceneEditorDocument.ts` clears obsolete selections/measurements across document/history changes. `FootContactMarkersPanel.tsx`, `FootContactGroundPanel.tsx`, `SceneGroundPanel.tsx`, `ArtworkPanel.tsx`, rig `editorMarkup.tsx` and `GroundGuideControls.tsx` add targeted guidance, empty states and stable anchors; `guideAnchors` set to `rig` distinguishes the mounted Rig and Animation controls. Guide `anchors.ts`, `rigGuides.ts`, `animationGuides.ts` and `sceneGuides.ts` register Creating Foot Contact Markers, Aligning Feet to Ground and Grounding Characters. Existing guide infrastructure is reused. No engine runtime API or schema changes are required. The existing `tests/browser/rigIKEditor.spec.ts` selectors now identify the named IK section instead of matching both panels sharing its styling. Tests, guide catalogs, development documentation and the `0.9.8-4` changelog entry record the workflow.

10. **Regression coverage.** New tests cover hidden/visible diagnostic notification rates, the final paused sample, listener release, temporary scene selection reset, stale Actor/character selections, package marker preservation and artwork/skin independence through mirrored, IK, baked and onion-skin previews. Existing suites cover bone/joint editing, IK authoring, foot planting, IK baking, mirroring, onion skins, sprite replacement, Actor movement, scene seeks, Undo/Redo, exports and Ground Reference Guides. Generic guide tests walk the new tours without authoring documents. Phaser marker rendering reuses existing Graphics and cached pose overlays; shutdown and character switches dispose owned overlays and subscriptions.

11. **Actual manual verification.** No hands-on artist session. Two generated desktop guide screenshots were visually inspected (Animation contact selection in production and Rig ground reference in development); the cards and highlighted controls were readable and followed the existing style. Desktop browser verification is automated Playwright running local Chrome against both Vite development and the production subpath. It is not a human artist review. No browser installation or test changes were added to CI.

12. **Command results.** Recorded for this implementation on 2026-10-21 (Europe/Helsinki).

| Command                        | Result                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`            | Passed (exit 0).                                                                                                                                            |
| `npm run test`                 | Passed (exit 0): 190 files / 3,320 tests passed; 5 files / 56 tests skipped.                                                                                |
| `npm run build`                | Passed (exit 0): demo, library, declarations and Node core-entry verification. Existing lucide-react `use client` bundler warnings remain.                  |
| `npm run check`                | Passed (exit 0): formatting, lint and typecheck.                                                                                                            |
| `npm run test:package`         | Passed (exit 0): 3 standalone runtime tests, isolated consumer typecheck/build and Node entry-point checks.                                                 |
| Local desktop browser commands | Passed across the selected suites: 84 unique desktop scenarios in 17 files. Artist workflow: 2 passed (59.3s); final production IK rerun: 2 passed (27.1s). |

The initial sandbox browser launch could not bind localhost (`EPERM`); local checks were relaunched outside the sandbox. An initial combined guide/contact run passed 18 scenarios before a new-test dropdown selector timeout; the production copy retained that old selector in the runner cache and was interrupted. A fresh process using role/name selectors passed both complete artist workflows. The broader production pass then reported 32 passed and two existing IK-test selector ambiguities; those selectors now target the named IK section. The development regression pass completed all 30 scenarios (exit 0, 7.1 minutes). The final production IK rerun passed both scenarios (exit 0, 27.1 seconds), closing those failures. All 84 selected scenarios have passing results; there are no outstanding failures. This is a targeted desktop regression set, not the entire browser catalog. No hosted service or CI browser execution is involved.

Exact local browser commands (in execution order):

```sh
PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  tests/browser/footContactProductionWorkflow.spec.ts \
  tests/browser/footContactMarkers.spec.ts \
  tests/browser/footContactGroundIntegration.spec.ts \
  tests/browser/rigGuides.spec.ts \
  tests/browser/animationGuides.spec.ts \
  tests/browser/sceneGuides.spec.ts

PLAYWRIGHT_CHANNEL=chrome npx playwright test \
  tests/browser/footContactProductionWorkflow.spec.ts

PLAYWRIGHT_CHANNEL=chrome npx playwright test --project=production \
  tests/browser/rigGuides.spec.ts \
  tests/browser/sceneGuides.spec.ts \
  tests/browser/rigIKEditor.spec.ts \
  tests/browser/animationIKBaking.spec.ts \
  tests/browser/animationMirroring.spec.ts \
  tests/browser/animationOnionSkinning.spec.ts \
  tests/browser/artworkReplacement.spec.ts \
  tests/browser/sceneEditor.spec.ts \
  tests/browser/sceneTransfer.spec.ts \
  tests/browser/animationGroundGuide.spec.ts \
  tests/browser/groundGuide.spec.ts \
  tests/browser/animationRigTweak.spec.ts \
  tests/browser/ikAnimationRuntime.spec.ts

PLAYWRIGHT_CHANNEL=chrome npx playwright test --project=development \
  tests/browser/rigIKEditor.spec.ts \
  tests/browser/animationIKBaking.spec.ts \
  tests/browser/animationMirroring.spec.ts \
  tests/browser/animationOnionSkinning.spec.ts \
  tests/browser/artworkReplacement.spec.ts \
  tests/browser/sceneEditor.spec.ts \
  tests/browser/sceneTransfer.spec.ts \
  tests/browser/animationGroundGuide.spec.ts \
  tests/browser/groundGuide.spec.ts \
  tests/browser/animationRigTweak.spec.ts \
  tests/browser/ikAnimationRuntime.spec.ts

PLAYWRIGHT_CHANNEL=chrome npx playwright test --project=production \
  tests/browser/rigIKEditor.spec.ts
```

13. **Remaining limitations.** Replacement artwork and skins preserve bone-local points, but changed sole proportions require manual realignment. No exact visual contact across arbitrary skins is promised. Grounding is an explicit edit at one pose/initial placement; animation movement remains authoritative. IK alignment is limited by the existing solver, reach, influence, supported scale and target ownership. No automatic phase recognition, sliding compensation, movement foot locking, physics, collision, terrain navigation or mesh deformation is introduced. Human artist acceptance remains unperformed.
