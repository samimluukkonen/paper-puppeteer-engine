# Ground reference foundation (v0.9.7.1)

[All guides](../README.md#guides) · [Scene Editor](scene-editor.md)

The ground guide is an optional horizontal authoring reference. It has no physics, collision or snapping behavior. Moving it does not change bones, IK targets, Actors, clips, saved checkpoints or Undo/Redo history.

In Scene Editor, expand the initially collapsed **Ground reference** inspector section. Enable **Show ground guide**, enter **Ground Y**, and press Enter or leave the field to apply it. Empty and nonfinite values retain the previous valid Y. **Reset Ground Y** restores zero without changing visibility. The guide is hidden by default.

## Coordinate ownership

Both editors use X rightward and Y downward, in world units. Scene guides use **scene-world** Y, default `0`, independent of Actor placement and playback. Animation guides use **animation-preview-world** Y, default `435`, matching the fixed preview placement in `CHARACTER_PREVIEW_ORIGIN`. This is a starting reference, not a calculation of foot height or an assumption that the root bone is at the feet.

Animation Y is fixed in the preview world, outside the puppet transform. Scaling, facing, rig rebuilds and clip switches do not move it. Animation and scene Y values cannot be transferred directly; a future transfer must explicitly map their workspace origins and transforms. The animation overlay is hidden in rig editing mode.

`editorWorldViewport` computes visible bounds using the current camera scroll, uniform zoom, viewport size and zoom origin. This avoids stale Phaser matrices between an input update and camera pre-render. The supported editor cameras have no rotation or external camera transform. `groundGuideGeometry` returns world-space line endpoints, label placement and inverse-zoom pixel size; it returns no geometry for hidden/offscreen guides or invalid viewports. DOM/FIT scaling continues to use the existing canvas sizing path. Camera and viewport changes never write guide settings.

## Metadata and persistence

`GroundGuide` contains readonly `enabled`, finite numeric `y` and `snapEnabled`. `defaultGroundGuide` provides domain defaults; `updateGroundGuide` ignores invalid numeric/boolean patches and returns an immutable snapshot. `snapEnabled` is reserved metadata and invokes no commands.

`GroundGuideWorkspace` owns settings separately from authored documents. Use `bind(identity)` to select a workspace, `getSnapshot`/`subscribe` to observe it, `update(patch)` to edit preferences, and `resetY()` to restore the domain's default Y. `bind(null)` disables editing and hides the guide. Binding and no-op edits perform no storage writes.

The existing browser-metadata pattern is used with localStorage keys `paper-puppeteer:ground-guide:v1:<space>:<encoded identity>`. Animation identities are resolved absolute character manifest URLs; scene identities are scene IDs within this browser origin. Each domain and identity retains independent settings. Opening the same scene ID intentionally reuses its guide settings. Separate browser tabs keep their own live settings; an explicit later edit replaces the stored value.

The stored envelope is `{ version: 1, guide: { enabled, y, snapEnabled } }`, validated with a strict Zod schema. Missing settings use defaults. Malformed, incompatible or unavailable storage leaves the editor usable; invalid bytes remain untouched until the user makes a valid preference change. Failed writes retain settings for the current session and expose a status message. Reopening the same document in the same browser restores settings when storage is available. Settings do not travel in JSON or character/scene ZIP exports; authored schema versions are unchanged.

## Rendering and controls

`GroundGuideOverlay` owns independent Phaser Graphics/Text objects and accepts `render(guide)` and idempotent `dispose()`. Its amber dashed line spans the visible viewport with constant viewport-pixel thickness and an optional **Ground** label. Constructor options allow a solid line or no label. It has no pointer listeners, hit area, puppet parent or artwork texture writes. Unchanged geometry skips redraws. Both editor stages own and release their overlay; character and scene exports continue to use their existing authored/texture paths.

`GroundGuideControls` subscribes to a workspace and provides a collapsed disclosure with visibility, numeric Y and reset controls in the existing inspector style. `showSnapping` optionally exposes the reserved preference, with explanatory text; it defaults to false. Scene Editor mounts these shared controls. Animation Editor exposes `scene.groundGuide` and renders the shared overlay, but dedicated animation controls remain deferred.

## Validation and next milestone

Unit regressions cover defaults, invalid values, visibility, world/screen projection at multiple zooms, pan and resize, domain/document isolation, persistence round trips, unavailable/invalid storage, immutable subscriptions, authored-data/history compatibility, controls and overlay disposal. Animation-scene integration also checks scaling, facing, clip switching, rig rebuilding and reopening. The local-only desktop Playwright scenario exercises real Phaser rendering, numeric controls, camera movement, resize and reload persistence against development and production builds.

Run `npm run typecheck`, `npm run test` and `npm run build`; `npm run check` additionally covers formatting and lint. The focused browser command is `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/groundGuide.spec.ts` after `npm run build:demo`, when local Chrome is available. Browser tests remain local-only.

For v0.9.7.2, integrate the shared controls into the Animation Editor's preview UI and add its dedicated authoring workflow. IK target snapping, Scene Actor snapping, physics/collision, terrain/slopes and automatic foot-contact detection remain separate work.

## Changed files and APIs

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

## Verification results

| Command                                                                           | Result                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                               | Passed. Also passed within `check` and `build`.                                                                                                                                 |
| `npm run test`                                                                    | Passed: 185 files passed, 5 skipped; 3,233 tests passed, 56 skipped (190 files / 3,289 tests total).                                                                            |
| `npm run build`                                                                   | Passed: demo bundle, library bundle, declarations and plain-Node entry-point checks. Vite reported nonblocking `lucide-react` module-level `use client` directive warnings.     |
| `npm run check`                                                                   | Passed: repository formatting, lint and typecheck.                                                                                                                              |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/groundGuide.spec.ts` | Passed: 2 desktop scenarios, development and production. Local server startup required execution outside the filesystem/network sandbox after its initial `EPERM` bind failure. |
| `git diff --check`                                                                | Passed.                                                                                                                                                                         |
