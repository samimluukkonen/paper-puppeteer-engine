# Scene backgrounds and image assets — v1.2.1

[Scene Editor](scene-editor.md) · [Project Workspace](project-workspace.md)

Open a scene and expand **Scene Artwork** in the inspector. **Add Background** opens a compact PNG/static WebP picker. **Add Image From Project** offers previously imported scene images and current character package images, including committed character artwork replacements. Choosing an image creates an independent scene element; it does not modify rig attachments. Merely opening the picker does not change the project.

Select an image in the list or click its visible bounds on the stage. Drag to position its center in scene-world pixels. Drag the lower-right corner handle to scale each axis around that center. Wheel zoom and middle/right/Alt-drag panning use the existing stage coordinate adapter. Actors have click priority where they overlap artwork. Placement gestures are available while the stage shows authored placement; stop playback to return there. Numeric transforms and visibility remain available during playback without resetting Actors or their clock.

**Apply image transform** commits the four numeric fields together. Scales must be positive and finite. **Reset transforms** restores position `(0, 0)` and scale `(1, 1)`. **Visible** toggles rendering. **Replace Image** imports a new binary for just the selected element; **Replace from project** uses the existing library. **Remove Element** removes its placement. Every completed drag is one Undo/Redo operation; Escape, lost pointer capture, navigation and teardown cancel a provisional drag. Inspector disclosures start collapsed. There are no mobile layouts.

Images stay in the library after removal so another scene or Undo/Redo can reuse them. **Clean unused images** removes only assets absent from all retained scene sources, saved checkpoints, working copies and history snapshots. It also releases unused picker-only imports. GPU textures and temporary decoding URLs are independently released when their last active placement disappears or the preview shuts down.

## Authored data and rendering

Scene format **2** gains an optional `images` array. Older scenes omit it and load without migration. Each element stores a stable element `id`, stable PNG/WebP `image` path, center `position`, positive `scale`, `visible`, integer background `order` (0–255), and optional `opacity` (0–1). All artwork renders behind Actors; equal orders preserve authored array order. No Phaser object, texture key or Blob URL is serialized.

`SceneEditorDocument` owns immutable snapshots, image selection and grouped image gestures. Its `SceneImageRegistry` owns detached binaries and content-based paths. React's `SceneArtworkPanel` issues document commands. Phaser's `SceneImageLayer` reconciles independent image objects and private texture leases, shared by the editor stage and `SceneLoader`. Transform/visibility changes reuse textures. Background edits preserve character rigs, Actor definitions, runtime Actor identity and playback time.

Local file imports reuse `importSprite`, image headers, dimension/byte limits and an abortable browser decoder. Empty files, corrupt images, mismatched extensions/MIME types, animated WebP, oversized images and collisions are rejected. Package tooling validates headers without requiring a browser; browser imports/exports also decode pixels. At most 256 image elements are allowed per scene, with existing artwork/scene/package memory bounds. Missing-reference drafts can still be edited or repaired; production validation and export require their binaries.

## Saving and handoff

**Download scene JSON** stores references only. It cannot put imported images onto your hosting server or overwrite repository files. Use **Download scene package** for a portable scene and its required artwork/characters. That ZIP rebases image references under `images/` in a detached copy. `SceneLoader.loadPackage` restores images behind Actors and owns their private textures until disposal. Hosted `SceneLoader.load` / `fromDefinition` resolve image paths relative to the scene JSON; a host may supply `SceneAssetOptions.loadImage` for a binary cache.

**Export Project** includes the scene image registry in project format 1 and maps logical image paths to physical ZIP resources. Identical image content is stored once, including images shared with character packages. Import restores original scene references, transforms, visibility and binaries. Autosave uses the same complete project payload; standalone scene recovery opens a recovered Project Workspace with its artwork. Downloads and local drafts are separate checkpoints.

## Verification and limits

`tests/sceneArtwork.test.ts` covers model compatibility, validation, immutable Actor data, placement/scale/visibility, gesture cancellation, history, cleanup, binary sharing, scene/project ZIPs and standalone recovery payloads. `tests/sceneImageLayer.test.ts` covers texture reuse, ordering, replacement, disposal, late decoding and retry. `tests/sceneLoader.test.ts` checks artwork-only playback preservation. Existing sprite, scene, project and autosave regressions remain applicable.

Local-only `tests/browser/sceneArtwork.spec.ts` exercises PNG import with an animated Actor, canvas move/scale, zoom/pan, Escape, Undo/Redo, visibility, playback/scrubbing, JSON/scene ZIP downloads, actual local-draft recovery, existing character image selection, WebP import, project ZIP reopening and rendered foreground/background pixels. These checks run on desktop against development and production paths. They are automated browser verification; separate human acceptance remains available through the workflow above.

No v1.2.2 plan is present. Parallax, camera animation, advanced layer editing, image painting, lighting, physics, transitions and dialogue/audio remain outside this release; no later feature scope is implied.

## Implementation files and APIs

| Area                         | Files and entry points                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authored format              | `SceneDefinition.ts`: `SceneImageDefinition`, optional `SceneDefinition.images`, `SceneValidationOptions.images`; public `/core`, `/data`, `/serialization` type exports; `schemas/scene.schema.json`                                       |
| Asset resolution and runtime | `SceneAssets.ts`: `ResolvedScene.images`, `SceneAssetOptions.loadImage`; `ScenePackage.ts`; `SceneLoader.ts`; new `SceneImageLayer.ts` and `decodeImage.ts`                                                                                 |
| Scene authoring              | `SceneEditorDocument.ts`: image selection/add/update/remove, grouped gestures, retained-asset cleanup; new `SceneImageRegistry.ts` and `SceneArtworkPanel.tsx`; stage, keyboard, transfer, playback and inspector CSS integration           |
| Project integration          | `ProjectDefinition.ts`, `ProjectWorkspace.ts`, `projectPackage.ts`, `projectInspection.ts`, `ProjectEditorHosts.ts`, `projectBridge.ts`: image registrations, shared physical resources, live character image choices and export validation |
| Shared services              | `spriteImport.ts` reuses the shared decoder; `editorDrafts.ts` captures independent image binaries in standalone scene recovery                                                                                                             |
| Release                      | `package.json`, `package-lock.json`, `CHANGELOG.md`, this guide and the Scene Editor guide                                                                                                                                                  |

## Recorded verification

Verified locally on Node.js 24.19.0. All required scripts exist with their requested names.

| Command                 | Result                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check:release` | Exit 0: formatting, lint, typecheck, release-version validation, unit tests, both builds and isolated packed-package consumer checks passed |
| `npm run typecheck`     | Exit 0, also run by the build and release checks                                                                                            |
| `npm test`              | Exit 0: 198 files passed, 6 skipped; 3,470 tests passed, 47 skipped. Includes 28 new unit regressions                                       |
| `npm run build`         | Exit 0: authoring application and reusable library/declarations built; renderer-independent entry points verified in Node                   |
| `npm run test:package`  | Exit 0: documentation, Node imports, declarations, runtime example, compatibility and browser bundle isolation passed                       |

`PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneArtwork.spec.ts tests/browser/sceneEditor.spec.ts tests/browser/sceneTransfer.spec.ts` exited 0: **20 desktop checks passed** across development and production in 3.0 minutes, including all four new artwork workflows.

Desktop browser runs use the installed Chrome channel because the bundled Playwright Chromium executable is absent. Screenshots were visually inspected for the real animated character in front of the background, compact transform/visibility controls and correct project reopening. These are local automated workflows plus screenshot inspection; no separate artist acceptance session was performed. CI browser configuration and dependency-audit scheduling were not changed.
