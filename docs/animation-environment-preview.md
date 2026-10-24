# Animation Environment Preview

[All guides](../README.md#guides)

Open **Feature Guide → Animation → Environment Preview** for a seven-step tour of the real controls. The tour reveals panels without changing settings, images, playback or authored data. It is available with a valid character and a selected animation, including an empty clip; no background image is required.

Enable **Environment Preview** above the Animation Editor canvas. Open the initially collapsed **Environment Preview** inspector section to choose a background from the project image library or import a PNG/static WebP. **Load project character images** also offers existing character artwork. Select a background, enter its center X/Y and uniform scale, then choose **Apply background transform**. **Show background** hides artwork while retaining its selection and transform; **Clear background** releases the preview without deleting the shared asset.

The background uses animation preview-world pixels: positive X points right, positive Y points down, and position identifies the image center. The character's fixed preview origin is `(380, 435)`; background `(0, 0)` identifies the world origin. A scale of `1` uses the image's native pixel size. Wheel zoom, middle-button pan and editor resizing change the camera view while retaining these world coordinates.

**Show Ground Reference** controls the existing guide, also available in **Ground reference**. **Align image bottom to ground** sets background center Y to `ground Y − image height × scale / 2`, preserving X and scale. For a visible floor inside an image, adjust Background Y until that floor meets the guide. Background alignment never changes bones, IK targets or keys. **Reset background transform** restores `(0, 0)` and scale `1`; **Reset Environment** clears the selection and disables Environment Preview while keeping shared assets and ground settings.

Environment settings belong to the current editor session and are shared across its animation selections. Reloading starts with the environment disabled. Project imports enter the existing shared image registry and are included in project ZIPs; standalone imports last for the editor session. Neither character/animation JSON nor character ZIPs contain environment settings or background binaries. Detailed environment persistence is deferred to v1.1.6.4.

React's `EnvironmentPreviewController` owns immutable typed settings, image discovery/import requests and feedback. `EnvironmentPreviewPanel` uses the existing inspector controls; both checkboxes subscribe to that same owner. The project bridge supplies the project's existing `SceneImageRegistry`, while standalone editing uses a session registry. No Blob URL becomes an asset reference.

`AnimationEditorScene` owns an `EnvironmentPreviewLayer` adapter over the existing `SceneImageLayer`. It creates a world image at background depth with scroll factor `1`, using the same camera as the character. The layer stays inactive in Rig Editor/Rig Tweak and releases images/textures on hiding, clearing, disabling or shutdown. Image decoding, byte/pixel guards, cancellation and temporary URL cleanup reuse the scene renderer. Missing assets report a recoverable error and retry when registered. The authoritative Puppet, evaluator, IK, attachments, skins, facing and playback remain under their existing owners.

Regression coverage lives in `environmentPreview.test.ts`, `sceneImageLayer.test.ts`, `animationEditorScene.test.ts` and the local-only `animationEnvironmentPreview.spec.ts` desktop browser workflow. It checks settings, import/deduplication/cancellation, world placement, ground alignment, missing-image recovery, character continuity, multiple animations, unchanged authored packages, texture cleanup and browser zoom/pan/resizing.

## Implementation files

- `src/devtools/shared/environmentPreview.ts`: reusable session-settings type, validation and renderer adapter.
- `src/devtools/animation-editor/EnvironmentPreviewController.ts`, `EnvironmentPreviewPanel.tsx` and `EnvironmentPreviewLayer.ts`: request/settings ownership, React controls and existing Phaser image-layer integration.
- `src/devtools/animation-editor/AnimationEditorScene.ts`, `main.tsx`, `editorMarkup.tsx` and `style.css`: workspace wiring, mode/shutdown lifetime and compact inspector layout.
- `src/devtools/project/projectBridge.ts` and `ProjectEditorHosts.ts`: share the existing project image registry with character editors.
- `tests/environmentPreview.test.ts`, `tests/sceneImageLayer.test.ts`, `tests/animationEditorScene.test.ts` and `tests/browser/animationEnvironmentPreview.spec.ts`: unit/integration and local desktop regressions.
- `src/devtools/shared/guides/anchors.ts` and `animationGuides.ts`, plus `tests/animationGuides.test.ts`, `guideRegistry.test.ts` and `tests/browser/animationEnvironmentGuide.spec.ts`: the seven-step Explain guide and target/prerequisite/state-preservation regressions.
- `AGENTS.md`, `CHANGELOG.md`, `README.md` and this guide: version policy, milestone `1.1.6-1` changelog and documentation. The existing higher package version `1.2.6` is preserved, with matching lockfile metadata.

## Environment foundation verification

Foundation verification on 2026-10-25 used Node 24.19.0. Test commands ran sequentially with one worker per runner.

| Command                                                                                                                                                         | Result                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (also repeated by checks/build)                                                                                                             | Passed, exit 0                                                                                          |
| `npm test -- --maxWorkers=1 --no-file-parallelism --reporter=dot`                                                                                               | 204 files passed, 6 skipped; 3,539 tests passed, 47 skipped; exit 0                                     |
| Focused `environmentPreview`, `sceneImageLayer` and `animationEditorScene` unit files with the same worker limits                                               | 32 tests passed; exit 0                                                                                 |
| `npm run check`                                                                                                                                                 | Formatting, lint and TypeScript passed; exit 0                                                          |
| `npm run check:version`                                                                                                                                         | Package, lockfile and changelog agree on `1.2.6` (rechecked after restoring the higher version); exit 0 |
| `npm run build`                                                                                                                                                 | Authoring app, library/declarations and Node entry-point checks passed; exit 0                          |
| `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationEnvironmentPreview.spec.ts --workers=1 --reporter=list` (with diagnostic logging enabled) | 4 passed across development and production; exit 0                                                      |
| `git diff --check`                                                                                                                                              | Passed                                                                                                  |

The local browser runs verified PNG/WebP rendering, image selection, synchronized enable/visibility controls, transform/reset commands, shared guide alignment, zoom/pan/desktop resize, playback/facing, multiple animation exports, retained Rig/Animation navigation and reload defaults. The project workflow selected existing character artwork, imported a second image, exported/reimported a project with both images and unchanged animation tracks, and verified that no scene was created. Canvas screenshots were also inspected for background depth, guide placement and shared editor styling.

## Feature Guide verification

The follow-up guide passed `npm run check` (formatting, lint and typecheck) and `npm run build:demo`. The focused command `npx vitest run tests/animationGuides.test.ts tests/guide*.test.ts --maxWorkers=1 --no-file-parallelism` passed 46 tests in 8 files. The local command `PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationEnvironmentGuide.spec.ts --workers=1 --reporter=list` passed all 4 cases across development and production, with and without a selected background. All commands exited 0 and test runners ran sequentially with one worker.

Browser checks resolved all seven unique anchors, opened collapsed sections, aligned spotlights and exercised Back, Restart, Finish and Escape. Preview controls, imported-image selection, shared ground metadata, animation selection, playhead, dirty state, Undo/Redo availability and authored JSON remained unchanged. The guide triggered no downloads. A screenshot of the ground-alignment step was inspected for layout and target placement.
