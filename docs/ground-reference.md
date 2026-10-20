# Ground reference and editor alignment (v0.9.7.4)

[All guides](../README.md#guides) · [Scene Editor](scene-editor.md)

See the [v0.9.7 integration report](ground-reference-readiness.md) for the coordinate audit, regression matrix, exact verification results and remaining acceptance limits.

The ground guide is an optional horizontal authoring reference. It has no physics or collision behavior. Moving it does not change bones, IK targets, Actors, clips, saved checkpoints or animation/scene Undo/Redo history. Both editors have separate guide history. Explicit alignment commands and opt-in placement drags author changes through each editor's existing document history.

Expand the initially collapsed **Ground reference** (Rig Editor or Animation Editor) or **Scene ground** (Scene Editor) inspector section. Enable **Show ground guide**, enter **Ground Y**, and press Enter or leave the field to apply it. Empty and nonfinite values retain the previous valid Y. **Reset Ground Y** restores the workspace default (Animation Editor `435`, Scene Editor `0`) without changing visibility. The guide is hidden by default.

In Rig Editor or Animation Editor, drag the amber **↕ Ground** label vertically to adjust the reference. Only the label captures ground drags; the rest of the line leaves bone/IK picking available. The numeric field follows the live world Y. Release saves one preference change, including release outside the canvas. Escape, focus loss, switching animation or editor mode, rebuilding the rig, and teardown cancel an unfinished drag without storage writes. Ground dragging does not pause or otherwise change playback. The guide is also available for empty/new clips and when no animation is selected.

**Undo ground change** and **Redo ground change** restore guide position, visibility and snapping preferences, independently of authored history. History holds at most 100 changes per character or scene for the current session. Reload restores saved settings, not history.

**Enable ground snapping** opts explicit IK crosshair drags into requested-target snapping within eight preview pixels of the guide. This changes only the temporary draft; **Set Target Key** remains the explicit save command. Hidden guides never snap. Moving a guide or toggling this preference never moves a target.

**Align IK target Y to guide** is a separate explicit authoring action. Select an authored IK target and show the guide, then use this button to set X/Y keys at the held playhead in one animation Undo action. It preserves requested world X, sets requested world Y to the guide, and applies the inverse full puppet transform; a rotated enclosing transform may require both local coordinates to change. Bones, events, duration and IK influence remain unchanged. Provider/runtime-owned, disabled, baked-out and singular/unsupported chains retain the existing manipulation guards. The guide's snapping checkbox does not gate this explicit alignment command.

Animation IK alignment addresses the **requested IK target**. `endOffset` identifies a solver endpoint, without establishing that it is a sole. Optional attachment `groundContacts` support Scene Editor placement (below); they do not change the animation target command. Demo sole offsets belong to `DemoFootPlanting` and its presentation profiles. IK target alignment/snapping therefore do not promise exact foot contact. Solver reach and influence can prevent the solved endpoint reaching the request. Foot planting is unchanged.

## Scene Actor alignment

Scene Editor also supports dragging the amber **↕ Ground** label vertically. The rest of the line leaves Actor picking available. The numeric field follows the live scene-world Y; release commits one guide-history entry, including outside-canvas release through pointer capture. Escape, pointer cancellation/capture loss, window blur, hiding/leaving the page, scene switching/import and stage teardown cancel an unfinished guide drag. Ground adjustment remains available during playback and scrubbing without pausing or rebuilding the runtime context.

Select an Actor and use **Align Feet to Ground**. Active foot attachments define `groundContacts`: one to 32 normalized image points, measured from the image’s top-left corner. For example, `"groundContacts": [{ "x": 0.1, "y": 0.95 }, { "x": 0.9, "y": 0.95 }]` marks a sole segment inside a padded image. Add these points to foot attachment definitions in rig JSON; both shipped characters include them. Skin variants can define their own sole points.

The editor transforms each contact through the active image’s complete world matrix in the initial pose, then shifts the Actor vertically until the lowest contact reaches Ground Y. This includes image origins, attachment/slot/bone transforms, root translation, Puppet scale and facing. X stays unchanged. A raised foot stays above the guide; this command places the character without changing the pose or solving foot IK. Non-foot artwork and props never determine the floor. Characters without visible, loaded contact artwork cannot align and retain free drag placement; there is no origin fallback.

Alignment requires a visible guide, a selected Actor and stopped playback. It updates only that Actor's authored initial position in one scene Undo/Redo entry. Redo restores the recorded position even if Ground Y has since changed. Actions, destinations, timing, rigs and character animations remain unchanged.

**Snap to Ground** places the lowest sole contact at Ground Y only during explicit stage placement drags. X remains free; hold **Shift** to bypass the constraint for jumping, flying or elevated placement. Hidden guides and disabled snapping leave placement free. Changing the guide or toggling snapping never moves an existing Actor. A completed placement drag remains one scene Undo entry; cancel restores the previous position. Numeric Actor properties remain explicit and unconstrained.

The guide remains stable while existing choreography controls runtime movement, including vertical destinations. Forward/backward seeks reconstruct the same authored movement without consulting ground settings. The guide is editor metadata, never a runtime collision plane or exported artwork.

## Coordinate ownership

Both editors use X rightward and Y downward, in world units. Scene guides use **scene-world** Y, default `0`, independent of Actor placement and playback. Animation guides use **animation-preview-world** Y, default `435`, matching the fixed preview placement in `CHARACTER_PREVIEW_ORIGIN`. This is a starting reference, not a calculation of foot height or an assumption that the root bone is at the feet.

Animation Y is fixed in the preview world, outside the puppet transform. Scaling, facing, rig rebuilds and clip switches do not move it. Animation and scene Y values cannot be transferred directly; a future transfer must explicitly map their workspace origins and transforms. The animation overlay is hidden in rig editing mode.

For a requested IK point `p`, the full Puppet container affine transform `P` maps puppet-local coordinates into preview world: `pPreview = P × p`. Alignment computes `inverse(P) × (pPreview.x, groundPreviewY)`; this can change **both** local X and Y when the container is rotated or sheared. Root-bone translation and the IK end offset belong to pose/solver evaluation, not an extra preview-origin adjustment. Singular transforms refuse alignment.

To compare that point with a scene instance, use its own world transform `A`: `pScene = A × inverse(P) × pPreview`. A horizontal preview line is not necessarily horizontal under an arbitrary change of basis. No editor transfers a scalar ground Y between these spaces. Scene feet alignment uses the active artwork’s world matrix to place authored sole points, then subtracts their offset from the Actor origin: `initialY = groundY - soleOffsetY`. Scene Actors are created at the scene root. Contact measurements are transient stage state; only the resulting initial position enters scene history and exports.

`editorWorldViewport` computes visible bounds using the current camera scroll, uniform zoom, viewport size and zoom origin. This avoids stale Phaser matrices between an input update and camera pre-render. The supported editor cameras have no rotation or external camera transform. `groundGuideGeometry` returns world-space line endpoints, label placement and inverse-zoom pixel size; it returns no geometry for hidden/offscreen guides or invalid viewports. DOM/FIT scaling continues to use the existing canvas sizing path. Camera and viewport changes never write guide settings.

## Metadata and persistence

`GroundGuide` contains readonly `enabled`, finite numeric `y` and `snapEnabled`. `defaultGroundGuide` provides domain defaults; `updateGroundGuide` ignores invalid numeric/boolean patches and returns an immutable snapshot. `snapEnabled` enables temporary Animation Editor IK drag snapping or Scene Editor Actor feet placement snapping; changing the setting invokes no authoring command.

`GroundGuideWorkspace` owns settings separately from authored documents. Use `bind(identity)` to select a workspace, `getSnapshot`/`subscribe` to observe it, `update(patch)` to edit preferences, and `resetY()` to restore the domain's default Y. `bind(null)` disables editing and hides the guide. Binding and no-op edits perform no storage writes.

The existing browser-metadata pattern is used with localStorage keys `paper-puppeteer:ground-guide:v1:<space>:<encoded identity>`. Animation identities are resolved absolute character manifest URLs; scene identities are scene IDs within this browser origin. Each domain and identity retains independent settings. Opening the same scene ID intentionally reuses its guide settings. Separate browser tabs keep their own live settings; an explicit later edit replaces the stored value.

The stored envelope is `{ version: 1, guide: { enabled, y, snapEnabled } }`, validated with a strict Zod schema. Missing settings use defaults. Malformed, incompatible or unavailable storage leaves the editor usable; invalid bytes remain untouched until the user makes a valid preference change. Failed writes retain settings for the current session and expose a status message. Reopening the same document in the same browser restores settings when storage is available. Settings do not travel in JSON or character/scene ZIP exports; authored schema versions are unchanged.

Animation draft recovery restores authored clips separately from guide metadata. Recovering, undoing or redoing a draft never overwrites ground preferences. Scene documents have no local authored-draft recovery; export and re-import the scene while its ID restores the browser's independent guide preferences. A character moved to a different manifest URL gets a separate guide workspace.

## Feature Guide tutorials

**Feature Guide → Animation Editor → Using Ground Reference** has five steps: enable, position Ground Y, inspect contact in the preview, explicitly align an IK target where supported, and hide/reset. It is available for a loaded valid rig even without a clip or IK. The alignment control remains visible and disabled until the existing authoring prerequisites are met.

**Feature Guide → Scene Editor → Aligning Actors to Ground** has five steps: enable, adjust scene Y, select an Actor, explicitly align its origin, and preview movement. A scene is required; an Actor is not required to start the explanation.

Both tours reuse the existing wizard and stable React `data-guide-id` anchors. Next/Back/Exit only reveal controls and never toggle a guide, write preferences, select an Actor, author keys, move Actors or start playback. The tutorials explain the missing sole marker, coordinate ownership, browser-only persistence and the difference between guide Undo and authored Undo. Shared show/hide and reset tooltips explain that the line is not a physics floor. Inspector sections still start collapsed.

## Rendering and controls

`GroundGuideOverlay` owns independent Phaser Graphics/Text objects and accepts `render(guide)` and idempotent `dispose()`. Its amber dashed line spans the visible viewport with constant viewport-pixel thickness and an optional **Ground** label (both editors use **↕ Ground**). Constructor options allow a solid line or no label. It has no pointer listeners, hit area, puppet parent or artwork texture writes. Unchanged geometry skips redraws. Both editor stages own and release their overlay; character and scene exports continue to use their existing authored/texture paths.

`GroundGuideControls` subscribes to a workspace and provides a collapsed disclosure with visibility, numeric Y and reset controls in the existing inspector style. `showSnapping` optionally exposes the domain's drag snapping preference, with explanatory text; it defaults to false. Both editor panels use it for their explicit alignment action and separate guide Undo/Redo controls. `AnimationEditorGroundHandle` owns Animation Editor pointer/keyboard listeners. `SceneGroundHandle` owns the scene label gesture and guide subscription; `SceneStage` owns DOM pointer capture, keyboard/focus listeners and their teardown. `GroundGuideOverlay` continues to own rendering only. Scene stage input uses the same current camera viewport calculation as the overlay, rather than a potentially stale Phaser projection matrix.

## Validation

Unit regressions cover defaults, invalid values, visibility, world/screen projection at multiple zooms, pan and resize, domain/document isolation, persistence round trips, unavailable/invalid storage, immutable subscriptions, authored-data/history compatibility, controls and overlay disposal. Animation-scene integration also checks scaling, facing, clip switching, rig rebuilding and reopening. The local-only desktop Playwright scenario exercises real Phaser rendering, numeric controls, camera movement, resize and reload persistence against development and production builds.

Run `npm run typecheck`, `npm run test` and `npm run build`; `npm run check` additionally covers formatting and lint. The focused browser command is `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/groundGuide.spec.ts` after `npm run build:demo`, when local Chrome is available. Browser tests remain local-only.

Additional v0.9.7.2 regressions cover pointer identity, label-only picking, zoom/pan/viewport coordinate conversion, live numeric synchronization, drag cancellation and outside release, bounded per-character guide history, full affine target alignment, opt-in draft snapping, unavailable target ownership, missing-contact explanations, empty selection, lifecycle cleanup and animation data immutability. Preview playback supports positive speeds; reverse navigation is covered by backward scrubbing, with no reverse-playback feature added. Physics/collision, terrain/slopes and automatic foot-contact detection remain separate work.

## Foundation files and APIs

Paths below are relative to the repository root. These are internal editor APIs; engine package exports are unchanged.

| File                                                                                      | Change                                                                                              |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/devtools/shared/groundGuide.ts`                                                      | `GroundGuide`, `GroundGuideSpace`, schema, defaults, validated updates and viewport geometry.       |
| `src/devtools/shared/GroundGuideWorkspace.ts`                                             | Per-workspace binding, immutable subscriptions, updates, Y reset and versioned browser persistence. |
| `src/devtools/shared/GroundGuideOverlay.ts`                                               | Reusable Phaser renderer and disposal.                                                              |
| `src/devtools/shared/GroundGuideControls.tsx`, `groundGuide.css`                          | Shared collapsed controls and inspector styling.                                                    |
| `src/devtools/shared/editorCamera.ts`, `previewPlacement.ts`                              | Current world viewport bounds and the existing fixed character-preview origin.                      |
| `src/devtools/animation-editor/AnimationEditorScene.ts`                                   | `groundGuide` workspace, manifest identity, render and cleanup integration.                         |
| `src/devtools/scene-editor/SceneEditorDocument.ts`                                        | `groundGuide` workspace selected alongside scene documents.                                         |
| `src/devtools/scene-editor/SceneStage.tsx`, `SceneEditorView.tsx`                         | Stage overlay lifecycle and mounted shared controls.                                                |
| `tests/groundGuide.test.ts`, `tests/animationEditorScene.test.ts`                         | 28 new unit/integration regressions.                                                                |
| `tests/browser/groundGuide.spec.ts`                                                       | Local desktop browser scenario, run against both builds.                                            |
| `docs/ground-reference.md`, `docs/development.md`, `docs/scene-editor.md`, `CHANGELOG.md` | Architecture, usage, scope and verification notes.                                                  |

## Foundation verification results (v0.9.7.1)

| Command                                                                           | Result                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                               | Passed. Also passed within `check` and `build`.                                                                                                                                 |
| `npm run test`                                                                    | Passed: 185 files passed, 5 skipped; 3,233 tests passed, 56 skipped (190 files / 3,289 tests total).                                                                            |
| `npm run build`                                                                   | Passed: demo bundle, library bundle, declarations and plain-Node entry-point checks. Vite reported nonblocking `lucide-react` module-level `use client` directive warnings.     |
| `npm run check`                                                                   | Passed: repository formatting, lint and typecheck.                                                                                                                              |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/groundGuide.spec.ts` | Passed: 2 desktop scenarios, development and production. Local server startup required execution outside the filesystem/network sandbox after its initial `EPERM` bind failure. |
| `git diff --check`                                                                | Passed.                                                                                                                                                                         |

## v0.9.7.2 implementation files

- `src/devtools/animation-editor/AnimationGroundPanel.tsx`, `editorMarkup.tsx`, `main.tsx`: collapsed controls, alignment explanation and shared workspace binding.
- `AnimationEditorGroundHandle.ts`, `AnimationEditorScene.ts`: dedicated world-space label gesture, safe alignment command and lifecycle integration.
- `AnimationEditorIKHandles.ts`, `ikTargetCoordinates.ts`: optional draft snapping and affine target-Y projection.
- `AnimationEditorIKCommands.ts`, `AnimationEditorState.ts`: optional explicit XY values through the existing atomic key authoring API.
- `src/devtools/shared/GroundGuideWorkspace.ts`, `GroundGuideControls.tsx`, `GroundGuideOverlay.ts`, `groundGuide.ts`, `groundGuide.css`: independent guide history, gesture drafts, controls and label geometry.
- `tests/animationGroundGuide.test.ts`, `animationEditorScene.test.ts`, `animationEditorIKHandles.test.ts`, `groundGuide.test.ts`: guide workflow and authoring regressions.
- `tests/browser/animationGroundGuide.spec.ts`: local desktop canvas drag, Escape, playback, switching, alignment, exported-data equivalence and reload workflow.

The focused local browser command is `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationGroundGuide.spec.ts tests/browser/groundGuide.spec.ts` after building the demo.

## v0.9.7.2 verification results

- `npm run check`: passed formatting, lint and strict TypeScript checking.
- `npm run test`: passed, 186 files / 3,246 tests; 5 files / 56 tests skipped.
- `npm run build`: passed demo/library bundles, declarations and plain-Node entry-point checks. Vite emitted the existing nonblocking `lucide-react` module-directive warnings.
- `git diff --check`: passed.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationGroundGuide.spec.ts tests/browser/groundGuide.spec.ts`: passed all 4 local desktop scenarios against development and production. The Animation Editor workflow opens the shipped walk, verifies live dragging/Escape/guide Undo, playback and scrub stability, facing/onion skins, camera zoom, clip switching, explicit alignment with animation Undo, identical authored exports and reload persistence. Local servers required sandbox escalation for localhost binding.

## v0.9.7.3 implementation files

- `src/devtools/scene-editor/SceneGroundPanel.tsx`, `SceneEditorView.tsx`: initially collapsed scene controls, explicit origin-alignment explanation and preview/selection guards. The panel observes playback mode without rendering on each clock tick.
- `SceneGroundHandle.ts`, `SceneStage.tsx`: label-only world-space gesture, pointer capture, cancellation, Shift bypass, preview-safe guide adjustment and cleanup.
- `SceneEditorDocument.ts`: explicit initial-origin alignment, opt-in placement constraint and independent scene guide history. Actor alignment and placement reuse authored snapshot Undo/Redo.
- `stageCoordinates.ts`: current camera bounds for DOM/FIT-to-world input, matching overlay projection without waiting for Phaser pre-render.
- `src/devtools/shared/GroundGuideControls.tsx`, `groundGuide.ts`: domain-specific control labels and snapping explanations; shared renderer and metadata persistence are reused.
- `tests/sceneGroundGuide.test.ts`, `sceneActorPlacement.test.ts`, `groundGuide.test.ts`: world input at five zoom levels, camera changes, gesture history/cancellation, origin fallback, distinct rigs/artwork/skins/facing/scales, authored alignment Undo/Redo, drag bypass, scene-ID persistence, deterministic movement/seeks and cleanup.
- `tests/browser/groundGuide.spec.ts`: local desktop numeric/show/hide, camera/resize, two-character alignment, canvas dragging/Escape, guide and scene Undo, Shift bypass, playback/scrubbing, export/reload and navigation cleanup.
- `docs/ground-reference.md`, `docs/scene-editor.md`, `docs/development.md`, `CHANGELOG.md`: usage, coordinate ownership, origin fallback, persistence and verification notes.

Guide settings continue to use the existing browser metadata strategy. Export/import in the same browser restores settings by scene ID. JSON/ZIPs carry authored Actor placements and actions, but do not carry guide preferences to another browser. Runtime schemas and movement remain unchanged.

## v0.9.7.3 verification results

- `npm run typecheck`: passed strict TypeScript checking; also passed within `check` and `build`.
- `npm run test`: passed, 187 files / 3,258 tests; 5 files / 56 tests skipped (192 files / 3,314 tests total).
- `npm run build`: passed demo/library bundles, declarations and plain-Node entry-point checks. Vite emitted the existing nonblocking `lucide-react` module-directive warnings.
- `npm run check`: passed repository formatting, lint and strict TypeScript checking.
- `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/groundGuide.spec.ts tests/browser/animationGroundGuide.spec.ts`: passed all 6 local desktop scenarios against development and production in 1.7 minutes. The scene workflow uses the shipped demo and sketch characters, verifies labelled origin alignment, independent guide/scene Undo, drag snapping and Shift bypass, unchanged choreography, playback/scrubbing, exported initial transforms, scene-ID guide persistence after reload and navigation cleanup. The existing Animation Editor workflow also passes. Local servers required sandbox escalation after an initial `EPERM` localhost-bind failure.
- `git diff --check`: passed.
