# Visual layers, depth and parallax — v1.2.2

[Scene Editor](scene-editor.md) · [Artwork and packaging](scene-artwork.md)

Open **Feature Guide → Scene → Backgrounds, Layers and Parallax** for an eight-step tour of image import, placement, layers, parallax preview and saving. It requires an open scene, works before adding artwork, and only reveals controls.

Expand **Scene Layers** in the inspector. Its hierarchy shows frontmost layers first. **Add Layer** creates an artwork layer in front; edit its name and parallax together with **Apply layer**. **Forward / Backward** changes layer order, including the Actors band. Each image row selects the element, assigns its artwork layer and moves it forward/backward within that layer. The hierarchy can select obscured or hidden elements independently of canvas hits. Inspector sections start collapsed.

**Visible** hides a layer without removing elements or stopping choreography. Artwork layers also have an editor-only **Lock**: locked images cannot be dragged, resized, reassigned, reordered, replaced, removed or edited numerically. They remain selectable from the hierarchy. Unlock in Scene Layers to edit them. Locks belong to the editor session, scoped to each scene, and do not enter history, exports or recovery. Explicit layer visibility/name/parallax controls remain available while locked.

Removing an artwork layer moves all its elements into **Background** in one Undo/Redo operation. The UI describes this policy beside Remove layer; elements and assets are retained, so no destructive confirmation is needed. Background and Actors are reserved bands: they can be renamed/reordered/hidden but cannot be removed. There are at most 64 layers and 256 image elements. Creating, renaming, ordering, assigning, visibility, parallax and safe removal use ordinary scene Undo/Redo. Asset cleanup continues protecting retained history dependencies.

## Depth contract

The serialized `layers` array is **back to front**. Each layer occupies a distinct Phaser depth band. Within artwork layers, higher image `order` draws later; equal orders use the original image-array index. Within the Actors band, later entries in the Actors array draw later. Each Actor's entire outer Puppet container occupies one scene depth slot; its internal bone/attachment ordering remains intact. Artwork can draw behind or in front of the Actors band, but cannot interleave individual Actors or split Puppet bones across scene layers. Put a tree in a foreground layer and mountains in a background layer, then move the Actors band between them.

For hosts adding other Phaser objects, the base depth is `(layerIndex - 1) * 100`. An artwork slot adds `(order + originalImageIndex / 257) / 256`; an Actor slot adds `actorIndex / 257`. Legacy scenes without explicit layers retain Actor depths equal to their original array indices. All supported bands stay below the editor ground overlay at depth 9000.

Canvas hits follow the displayed depth of visible, unlocked elements. Selected Actor movement handles and selected image scale handles take priority and remain above artwork. Select an obscured Actor or image in the hierarchy to expose its handles. Ground remains a reference overlay above every supported artwork layer, separate from visibility, parallax, layer history and scene exports.

## Camera and parallax contract

Layer parallax uses [Phaser's scroll-factor convention](https://docs.phaser.io/phaser/concepts/gameobjects/components): **0** is fixed for scrolling, **1** follows normal world scrolling, fractional values move more slowly, and values above 1 move faster. One nonnegative finite factor applies to both axes. The Actors band always uses 1; changing artwork parallax does not alter Actor movement paths or animation.

The authored [Cinematic Camera](cinematic-camera.md) defines audience framing and initial zoom. The stage's **Preview camera X/Y** fields add a temporary parallax inspection offset in scene pixels outside audience preview. Increase X by 100 to see a layer with factor 0.2 move left by 20 world units, a normal Actor by 100, and a layer with factor 1.2 by 120. Zoom scales those screen distances. Preview camera values, editor pan/zoom, selections and hover state are view state, excluded from exports, history and recovery. **Reset view** resets both navigation and preview scroll.

Authored image positions remain unchanged. The editor renders an image at `authoredPosition + (1 - parallax) * (cameraCenter + inspectionOffset)`, then projects it with normal editor navigation plus the temporary inspection offset. Audience preview uses only the authored camera center and zoom, excluding the inspection offset. This is equivalent to Phaser scroll factors for the cinematic part while keeping editor panning at ordinary world scrolling. Hit bounds and selection overlays use that displayed position; pointer deltas edit the authored transform at the current zoom. Dragging is grouped as before, and Escape cancels it. Ordinary wheel zoom and middle/right/Alt-drag navigation never preview parallax or create history entries. Preview camera changes can be made during choreography playback.

At runtime, loading alone preserves native Phaser image `scrollFactorX/Y` and authored image positions for existing hosts. Explicitly call `LoadedScene.applyCamera(camera, viewport)` to use the authored audience frame and center-relative parallax compensation shared with the editor. Reapply with the full host viewport after resizing. As in Phaser, scroll-factor zero cancels scrolling, not zoom. Camera animation and transitions remain out of scope. See the [camera runtime contract](cinematic-camera.md#runtime-integration).

## Persistence and implementation

Scene format 2 adds optional `layers` entries (`id`, `name`, `visible`, `parallax`) and image `layerId`. Missing `layers` resolves to Background then Actors, both visible with parallax 1. Images without `layerId` belong to Background. Legacy scenes are not rewritten until a layer command materializes the defaults. Duplicate/missing layer IDs, missing reserved bands, artwork assigned to Actors, invalid factors and unknown layer references are rejected. Project format 1 remains unchanged. Scene/project ZIP rebasing, binary deduplication, saved snapshots and recovery retain layer data through the existing scene serialization paths.

`src/engine/sceneLayers.ts` owns shared depth/default/parallax calculations. `SceneDefinition.ts` and `schemas/scene.schema.json` define the format; `SceneImageLayer.ts`, `SceneRunner.ts`, `SceneLoader.ts` and the editor's Actor preview/playback use it. `SceneEditorDocument.ts` owns layer/image commands and session locks. React's `SceneLayersPanel.tsx`, `SceneArtworkPanel.tsx` and `SceneStage.tsx` provide hierarchy, guarded inspectors, camera preview and transformed picking, using the existing shared header and editor styles.

Unit regressions cover default compatibility and invalid data, render bands and Actor/image ordering at limits, reassignment/deletion, visibility, locks, history, native versus editor parallax, zoom/pan coordinates, Actor playback identity/clock/movement and scene packages. Local desktop browser coverage exercises actual canvas layering/picking, parallax, navigation, locks, playback, undo and scene/project reopening. Browser tests remain local-only.

## Recorded verification

Verified locally on Node.js 24.19.0. Public layer types are exported through `src/engine/core.ts`, `data.ts` and `serialization.ts`; `package.json`, `package-lock.json` and `CHANGELOG.md` use version 1.2.2. Regressions live in `tests/sceneLayers.test.ts`, `sceneImageLayer.test.ts`, `sceneRunner.test.ts` and `tests/browser/sceneArtwork.spec.ts`.

| Command                 | Result                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | Exit 0                                                                                                |
| `npm run test`          | Exit 0: 199 files passed, 6 skipped; 3,487 tests passed, 47 skipped. Includes 17 new unit regressions |
| `npm run build`         | Exit 0: authoring application and library/declarations built; Node entry points verified              |
| `npm run check`         | Exit 0: formatting, lint and typecheck                                                                |
| `npm run check:version` | Exit 0: package, lockfile and changelog agree on 1.2.2                                                |
| `npm run test:package`  | Exit 0: isolated package consumer, public declarations, documentation and browser bundling            |

The build retains the existing nonfatal Lucide React `use client` directive warnings. Desktop browser checks use the installed Chrome channel. Screenshots were visually inspected for a Puppet between opaque background and foreground artwork, collapsed inspectors after import, hierarchy controls and project reopening. No separate artist acceptance session was performed.

`PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/sceneArtwork.spec.ts tests/browser/sceneEditor.spec.ts tests/browser/sceneTransfer.spec.ts` exited 0: **22 desktop checks passed** across development and production in 3.3 minutes. This includes the new layer workflow, extended project round trip, existing artwork/recovery workflows and the scene editor/transfer regressions. Browser tests and installation remain outside CI.

The Feature Guide follow-up passed `npm run check`, `npm run build` and 22 focused unit tests across scene guides, the registry, launcher and target resolver. The catalog tour checks passed on development and production with empty artwork. The selected, locked-artwork tour checks also passed on both servers after comparing the normalized scene export before and after the tour; selection, locks, history and preview values were preserved.
