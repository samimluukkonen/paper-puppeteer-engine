# Environment Preview integration — v1.1.6.4

## Readiness

**Automated readiness: PASS.** Environment Preview uses the existing Animation Editor pose, displacement and camera implementations. This milestone integrates their editor preferences with project packaging and complete local drafts. It preserves package/lockfile version **1.2.6**, which is higher than milestone **1.1.6-4**. Validation results are recorded below; artistic acceptance remains a human review.

## Architecture and ownership

`EnvironmentPreviewController` owns shared character presentation and the image registry; `MotionPreviewController` retains immutable clip-specific trajectories and preview loop flags. `AnimationPreviewPreferencesBinding` captures only changed settings, image revisions and completed ground gestures. Playback ticks, selections and repeated seeking do not write preferences. It releases subscriptions on editor disposal or load failure. Existing Phaser adapters still own rendering and restore the ordinary camera/preview placement during Rig/Rig Tweak and shutdown.

Project format 1 gains optional `editorPreferences.animationPreview[characterId]`. Each value holds `environment`, `camera`, `ground` and an `animations` map of clip ID → `{ motion, loop }`. A legacy project omits the field. Preferences are validated, detached and frozen at the project boundary and remain outside membership history, skeletal documents and production animation behavior. Ground restoration creates no Undo entries; deliberate ground edits keep their existing separate preference history. Preview trajectory/camera/background controls have no Undo stack.

## Background assets

Project hosts supply the existing project `SceneImageRegistry`. Standalone hosts use the same registry implementation, captured into their complete project-shaped local draft. PNG/static WebP bytes use existing header/decode checks, content deduplication, byte/pixel budgets and shared `SceneImageLayer` loading/cancellation. Stable relative project paths are serialized; Blob/data/HTTP URLs are rejected for preview preferences. Shared artwork is packaged once through existing project deduplication.

Clearing/resetting preview configuration does not remove binaries. Scene Editor's explicit unused-image cleanup retains current preview references as well as scene source/checkpoint/history dependencies. A missing optional preview image preserves preferences and character animations, including on project import when its registered binary is absent; selecting/importing a replacement repairs it. Scene artwork dependencies still require valid assets. Corrupt/unsupported registered binaries still fail the existing package validation rather than being silently accepted.

## Motion, transforms and trajectory

Skeletal keys keep bone-local semantics, including authored root translation. Optional displacement adds world pixels to the outer Puppet's fixed preview origin `(380, 435)` before the normal solve/render path. Positive X is right, positive Y down; facing and scale affect the skeleton without mirroring/scaling the trajectory. No root motion is extracted or doubled automatically: artists deliberately enable additive displacement when appropriate.

Trajectories store sorted unique nonnegative millisecond times and finite X/Y offsets, with linear or stepped interpolation and held endpoints. Disabling/resetting preserves authored motion. The environment image remains static in world space; its X/Y identifies its center, and scale is uniform. Ground is a visual reference; contact markers use the final displaced pose and existing full world transform. No locking, physics or scene movement is introduced.

## Camera, playback, seeking and loops

Fixed camera holds a configured world center. Follow adds evaluated preview displacement to that center; authored bone/root motion stays inside the skeleton. Native pan/zoom edits the same preview camera; ordinary navigation is restored when disabled or leaving Animation mode. Stored camera framing is the default on reopening.

Pose, displacement, contacts and camera share the existing millisecond clock and stepped sampling, including exact endpoints. Seeking evaluates from the requested time without accumulating movement or dispatching gameplay events. Each animation retains its Loop preview setting. Every loop samples from the beginning again, including a nonzero first offset. Continuous travel across loops is unsupported.

## Persistence and cross-editor compatibility

Project metadata changes participate in dirty state, autosave revisions and project export checkpoints. Preference edits do not mark the production character package dirty. Standalone autosave revisions include preferences and the registry revision, and preference-only edits can trigger saving. `buildCharacterDraft` captures preferences and binary copies before asynchronous packaging, so subsequent edits cannot alter a pending recovery snapshot.

Recovery uses the existing LocalDraftStore/LocalAutosave flow and installs a detached ProjectWorkspace. Standalone recovery therefore opens Project Workspace; it does not automatically reinstall a draft into the sample character page. Export/import a project ZIP for a portable copy. Animation JSON and character ZIPs intentionally exclude all preview metadata/artwork. CharacterLoader, Puppet, Actor movement and scene choreography APIs are unchanged. Rig/Scene editors retain their own working copies; no preview trajectory becomes a scene action.

## Performance and resources

The new binding subscribes to configuration owners, without adding a frame listener or React clock subscription. Automated checks assert zero preference writes across playback ticks and repeated seeks. Image rendering reuses the existing loader, budgets, deduplication and shutdown cleanup. Existing lifecycle regressions cover late imports, texture retry/disposal, observers, camera restoration, rig/skin changes and unchanged authored data. Large PNG/WebP backgrounds remain subject to existing per-image and aggregate guards; this milestone does not claim a new GPU/memory benchmark or unlimited image sizes.

## Files and APIs

- New shared schema: `src/devtools/shared/animationPreviewPreferences.ts`.
- New binding: `src/devtools/animation-editor/AnimationPreviewPreferences.ts`.
- Project ownership: `ProjectDefinition.ts`, `ProjectWorkspace.ts` (`animationPreviewPreferences`, `setAnimationPreviewPreferences`), `projectBridge.ts`, `ProjectEditorHosts.ts`, `projectPackage.ts`.
- Existing owners: `EnvironmentPreviewController.restorePreferences`, `MotionPreviewController.capturePreferences/restorePreferences`, `GroundGuideWorkspace.restore`, `SceneEditorDocument` external image retention and `buildCharacterDraft` optional preview capture.
- Workspace wiring, saving descriptions and existing guide content: animation `main.tsx`, both preview panels, `environmentPreview.ts`, `animationGuides.ts`, changelog and user guides.
- Regressions: `animationPreviewPersistence.test.ts`, updated `animationGuides.test.ts` and local-only `animationEnvironmentPreview.spec.ts`.

## Verification

Commands ran sequentially on Node **24.19.0**, with one worker for each test runner.

| Command                                                                      | Result                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                                          | Passed, exit 0.                                                                                                                                                                |
| `npm run test -- --maxWorkers=1`                                             | Passed, exit 0: 207 files passed, 6 skipped; 3,572 tests passed, 47 skipped (136.22 s).                                                                                        |
| `npm run build`                                                              | Passed, exit 0: application, library/declarations and built Node core/runtime smoke check. Existing Lucide `use client` bundling warnings remain.                              |
| `npm run check`                                                              | Passed, exit 0: repository formatting, lint and typecheck.                                                                                                                     |
| `npm run check:version`                                                      | Passed, exit 0: package/lockfile/changelog agree at 1.2.6.                                                                                                                     |
| Focused preview/project regressions (`vitest`, five files, `--maxWorkers=1`) | Passed, exit 0: 58 tests; repeated after the final identifier/point-limit validation changes.                                                                                  |
| Local Chrome Playwright, four preview/motion/guide specs, `--workers=1`      | Passed, exit 0: 20 tests on development and production (8.7 min).                                                                                                              |
| `npm run test:package`                                                       | Passed, exit 0: isolated offline consumer, documentation links, public declarations, Node loading/animation/IK/disposal, runtime example, compatibility and browser isolation. |

The exact focused and browser commands were:

```bash
npx vitest run tests/animationPreviewPersistence.test.ts tests/motionPreview.test.ts tests/environmentPreview.test.ts tests/animationGuides.test.ts tests/projectWorkspace.test.ts --maxWorkers=1
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationEnvironmentPreview.spec.ts tests/browser/animationMotionPreview.spec.ts tests/browser/animationEnvironmentGuide.spec.ts tests/browser/animationMotionPreviewGuide.spec.ts --workers=1
```

The browser run passed sword-cut-with-root-step, jump and bundled walk workflows; PNG/WebP import and ground alignment; fixed/follow camera, zoom/pan, seeking/looping, facing and clip switching; unchanged animation exports; guide targets and unchanged guide state; and project plus standalone refresh/recovery with project ZIP export/reimport. The shared browser fixture also requires no browser exceptions or failed local asset requests. Only these targeted browser specs were run, not the entire browser catalog.

The initial sandboxed Playwright attempt exited 1 because localhost port 4173 could not be bound (`EPERM`); the authorized run uses local server access and installed Chrome. Browser scenarios are automated local desktop checks, not manual artist testing. No manual canvas interaction or artistic approval is claimed.

## Remaining limitations

- No automatic foot locking, collision, physics, new solver, camera animation, artwork animation or scene conversion.
- Additive movement requires deliberate artist judgment when source clips already translate.
- Preferences are not included in production character/animation exports; use project ZIPs and local drafts.
- Removing a clip retains its editor preferences under that clip ID; recreating that ID can reuse them.
- Explicit unused-image cleanup can delete an image after its scene and preview references are cleared.
- Preview/background controls do not have Undo/Redo; Ground reference keeps its existing separate preference history.
- Local draft durability depends on browser storage and the most recent successful autosave.
