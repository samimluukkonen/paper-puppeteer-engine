# Ground reference and Animation Editor IK alignment (v0.9.7.2)

[All guides](../README.md#guides) · [Scene Editor](scene-editor.md)

The ground guide is an optional horizontal authoring reference. It has no physics or collision behavior. Moving it does not change bones, IK targets, Actors, clips, saved checkpoints or animation/scene Undo/Redo history. Animation Editor has separate guide history and optional target-Y snapping during explicit IK drags.

In either editor, expand the initially collapsed **Ground reference** inspector section. Enable **Show ground guide**, enter **Ground Y**, and press Enter or leave the field to apply it. Empty and nonfinite values retain the previous valid Y. **Reset Ground Y** restores the workspace default (Animation Editor `435`, Scene Editor `0`) without changing visibility. The guide is hidden by default.

In Animation Editor, drag the amber **↕ Ground** label vertically to adjust the reference. Only the label captures ground drags; the rest of the line leaves bone/IK picking available. The numeric field follows the live world Y. Release saves one preference change, including release outside the canvas. Escape, focus loss, switching animation or editor mode, rebuilding the rig, and teardown cancel an unfinished drag without storage writes. Ground dragging does not pause or otherwise change playback. The guide is also available for empty/new clips and when no animation is selected.

**Undo ground change** and **Redo ground change** restore guide position, visibility and snapping preferences, independently of authored animation history. History holds at most 100 changes per character for the current session. Reload restores saved settings, not history. Scene Editor retains its existing preferences without guide history.

**Enable ground snapping** opts explicit IK crosshair drags into requested-target snapping within eight preview pixels of the guide. This changes only the temporary draft; **Set Target Key** remains the explicit save command. Hidden guides never snap. Moving a guide or toggling this preference never moves a target.

**Align IK target Y to guide** is a separate explicit authoring action. Select an authored IK target and show the guide, then use this button to set X/Y keys at the held playhead in one animation Undo action. It preserves requested world X, sets requested world Y to the guide, and applies the inverse full puppet transform; a rotated enclosing transform may require both local coordinates to change. Bones, events, duration and IK influence remain unchanged. Provider/runtime-owned, disabled, baked-out and singular/unsupported chains retain the existing manipulation guards. The guide's snapping checkbox does not gate this explicit alignment command.

There is no general sole-contact marker in the authored rig format. `endOffset` identifies a solver endpoint, without establishing that it is a sole. Demo sole offsets and artwork bounds belong to `DemoFootPlanting` and its presentation profiles, and are not used as editor contact metadata. Alignment/snapping therefore place the **requested IK target**, with an explicit missing-contact explanation; they do not promise exact foot contact. Solver reach and influence can prevent the solved endpoint reaching the request. Foot planting is unchanged.

## Coordinate ownership

Both editors use X rightward and Y downward, in world units. Scene guides use **scene-world** Y, default `0`, independent of Actor placement and playback. Animation guides use **animation-preview-world** Y, default `435`, matching the fixed preview placement in `CHARACTER_PREVIEW_ORIGIN`. This is a starting reference, not a calculation of foot height or an assumption that the root bone is at the feet.

Animation Y is fixed in the preview world, outside the puppet transform. Scaling, facing, rig rebuilds and clip switches do not move it. Animation and scene Y values cannot be transferred directly; a future transfer must explicitly map their workspace origins and transforms. The animation overlay is hidden in rig editing mode.

`editorWorldViewport` computes visible bounds using the current camera scroll, uniform zoom, viewport size and zoom origin. This avoids stale Phaser matrices between an input update and camera pre-render. The supported editor cameras have no rotation or external camera transform. `groundGuideGeometry` returns world-space line endpoints, label placement and inverse-zoom pixel size; it returns no geometry for hidden/offscreen guides or invalid viewports. DOM/FIT scaling continues to use the existing canvas sizing path. Camera and viewport changes never write guide settings.

## Metadata and persistence

`GroundGuide` contains readonly `enabled`, finite numeric `y` and `snapEnabled`. `defaultGroundGuide` provides domain defaults; `updateGroundGuide` ignores invalid numeric/boolean patches and returns an immutable snapshot. `snapEnabled` enables only temporary Animation Editor IK drag snapping; changing the setting invokes no authoring command. Scene Editor does not expose it.

`GroundGuideWorkspace` owns settings separately from authored documents. Use `bind(identity)` to select a workspace, `getSnapshot`/`subscribe` to observe it, `update(patch)` to edit preferences, and `resetY()` to restore the domain's default Y. `bind(null)` disables editing and hides the guide. Binding and no-op edits perform no storage writes.

The existing browser-metadata pattern is used with localStorage keys `paper-puppeteer:ground-guide:v1:<space>:<encoded identity>`. Animation identities are resolved absolute character manifest URLs; scene identities are scene IDs within this browser origin. Each domain and identity retains independent settings. Opening the same scene ID intentionally reuses its guide settings. Separate browser tabs keep their own live settings; an explicit later edit replaces the stored value.

The stored envelope is `{ version: 1, guide: { enabled, y, snapEnabled } }`, validated with a strict Zod schema. Missing settings use defaults. Malformed, incompatible or unavailable storage leaves the editor usable; invalid bytes remain untouched until the user makes a valid preference change. Failed writes retain settings for the current session and expose a status message. Reopening the same document in the same browser restores settings when storage is available. Settings do not travel in JSON or character/scene ZIP exports; authored schema versions are unchanged.

## Rendering and controls

`GroundGuideOverlay` owns independent Phaser Graphics/Text objects and accepts `render(guide)` and idempotent `dispose()`. Its amber dashed line spans the visible viewport with constant viewport-pixel thickness and an optional **Ground** label (Animation Editor uses **↕ Ground**). Constructor options allow a solid line or no label. It has no pointer listeners, hit area, puppet parent or artwork texture writes. Unchanged geometry skips redraws. Both editor stages own and release their overlay; character and scene exports continue to use their existing authored/texture paths.

`GroundGuideControls` subscribes to a workspace and provides a collapsed disclosure with visibility, numeric Y and reset controls in the existing inspector style. `showSnapping` optionally exposes the IK drag snapping preference, with explanatory text; it defaults to false. Both editors mount these controls. Animation Editor adds `AnimationGroundPanel`, its explicit alignment action and separate guide Undo/Redo controls. `AnimationEditorGroundHandle` owns pointer/keyboard listeners and their teardown; `GroundGuideOverlay` continues to own rendering only.

## Validation

Unit regressions cover defaults, invalid values, visibility, world/screen projection at multiple zooms, pan and resize, domain/document isolation, persistence round trips, unavailable/invalid storage, immutable subscriptions, authored-data/history compatibility, controls and overlay disposal. Animation-scene integration also checks scaling, facing, clip switching, rig rebuilding and reopening. The local-only desktop Playwright scenario exercises real Phaser rendering, numeric controls, camera movement, resize and reload persistence against development and production builds.

Run `npm run typecheck`, `npm run test` and `npm run build`; `npm run check` additionally covers formatting and lint. The focused browser command is `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/groundGuide.spec.ts` after `npm run build:demo`, when local Chrome is available. Browser tests remain local-only.

Additional v0.9.7.2 regressions cover pointer identity, label-only picking, zoom/pan/viewport coordinate conversion, live numeric synchronization, drag cancellation and outside release, bounded per-character guide history, full affine target alignment, opt-in draft snapping, unavailable target ownership, missing-contact explanations, empty selection, lifecycle cleanup and animation data immutability. Preview playback supports positive speeds; reverse navigation is covered by backward scrubbing, with no reverse-playback feature added. Scene Actor snapping, physics/collision, terrain/slopes and automatic foot-contact detection remain separate work.

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
