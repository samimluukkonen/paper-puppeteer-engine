# Architecture candidate 15 — `SceneEditorDocument`: one drag handle, one cancel rule, domain handles

Continue developing Paper Puppeteer Engine.

Source: codebase-design scan of the whole repo on 2026-11-17 (measured at `64f7e6e`). This is the scene-editor counterpart of architecture-11 (the animation editor facade shrink).

## Problem

`src/devtools/scene-editor/SceneEditorDocument.ts` is 1060 lines with about 130 public members. 33 source files and 28 test files depend on its whole surface. Three problems:

1. **Pass-through members.** 27 members are one-line delegates to the domain command modules: `SceneArtworkCommands`, `SceneAudioCommands`, `SceneCameraCommands`, `SceneDialogueCommands` and `SceneTransitionCommands`. Examples are `addLayer`, `updateLayer`, `reorderLayer`, `addDialogueLine` and `removeAudioClip`. Removing them would lose nothing; callers could reach the command module directly.
2. **24 kind-specific drag methods over one well-designed module.** `SceneEditorGestures` already models "one active gesture, bound to the history it started on" generically: `begin(kind, target, history)`, `end(...kinds)`, `cancel(...kinds)`. The document still re-exposes it as six separate begin/move/end/cancel sets:
   - `begin/move/end/cancelCameraDrag`
   - `begin/changeCameraKeyDrag`
   - `begin/move/end/cancelImageDrag`
   - `begin/move/end/cancelActorDrag`
   - `begin/change/end/cancelAudioDrag`
   - `begin/change/end/cancelActionDrag`

   Most callers are tests (for example, `beginActorDrag` has 1 source caller and 14 test calls).
3. **Drag cancelling on selection change is written out by hand, three ways.** There are 20 `this.cancel…Drag()` calls inside the document:
   - `selectCamera` and `setCameraPreview` call `gestures.cancel()` (cancel everything);
   - `selectActor`, `selectDialogueLine`, `selectAudioClip` and `selectTransition` call `cancelDragsForActor(id | null)`;
   - `selectImage` (`:557-565`), `selectAction` (`:943-955`) and `setCameraOverlays` (`:455-462`) list kinds by hand.

   The lists disagree. `setCameraOverlays` cancels camera, image and actor drags but not audio or action drags. `selectImage` and `selectAction` keep a drag of the item being selected alive, but `selectAudioClip` goes through `cancelDragsForActor(null)`, so re-selecting the audio clip being dragged cancels that drag. The invariant ("a selection change cancels any drag that isn't on the new selection") exists only as copies.

## Goal

The document's interface is: session lifecycle (create, select, import, replace, undo, redo, revert, export, markSaved), selection, one drag entry point, and one handle per domain. The selection/drag invariant is enforced in one place.

## What to build

1. **One drag entry point.** Replace the six sets with:
   ```ts
   beginDrag(target: SceneDragTarget): SceneDrag | null;
   type SceneDragTarget =
     | { kind: 'actor'; id: string } | { kind: 'image'; id: string } | { kind: 'action'; id: string }
     | { kind: 'audio'; id: string } | { kind: 'camera' } | { kind: 'cameraKey'; property: CameraProperty; id: string };
   interface SceneDrag<Change> { change(value: Change): boolean; end(): void; cancel(): void; }
   ```
   The per-kind `Change` type is today's move/change argument: a position plus `bypassGround` for actors, a position/scale patch for images, `SceneActionDefinition`, `SceneAudioClip`, a position for the camera, and a time for camera keys. `beginDrag` returns `null` wherever today's `begin…Drag` returns `false`, covering locked images, camera preview, keyed camera tracks without key editing, and unknown ids. A handle whose gesture has ended or been replaced becomes inert (`change` → `false`). Keep `hasActiveGesture` and a single `cancelDrag()` for callers that don't hold the handle, such as keyboard Escape and view unmount.
2. **One cancel rule in `setSelection`.** Before writing the new selection, `setSelection(next)` cancels the active gesture unless it targets the item `next` selects. Delete `cancelDragsForActor` and the hand-written lists in `selectImage`, `selectAction` and `selectCamera`. Decide explicitly whether `setCameraOverlays` and `setLayerLocked` should cancel every gesture or only stage gestures, and record the choice. Default: cancel every gesture, as `setCameraPreview` already does.
3. **Domain handles instead of pass-throughs.** Expose the command modules as `document.artwork`, `document.audio`, `document.camera`, `document.dialogue` and `document.transitions`, each typed as a narrow interface (the command module's public methods). Then delete the 27 delegates. Keep selection getters/setters on the document itself, because selection spans domains. Each domain handle must still route its edits through the document's history and notification path. The command modules already take the document as `state`, so this is about the interface, not the behaviour.
4. **Migrate callers.** Update the 33 source files and the 28 test files. Tests should mostly change mechanically (`document.beginActorDrag(id); document.moveActorDrag(p); document.endActorDrag()` becomes `const drag = document.beginDrag({ kind: 'actor', id })!; drag.change(p); drag.end()`).

## Constraints

- Behaviour-preserving apart from making the cancel rule consistent (item 2). Undo/redo grouping of drags must be unchanged: one history entry per completed drag, and none for a cancelled one.
- Notifications stay batched as today (`SceneEditorNotifications` channels). No extra renders per drag frame.
- Follow the style guide and keep `ViewHeader` usage unchanged. This plan doesn't touch layout.
- Changelog entry goes under Unreleased (a "Changed" line for the consistent drag cancelling).

## Verification

- `npm run check` and `npm run test` (sequential, one worker)
- `npm run test:browser` locally: drag an actor, image, audio clip, action and camera, then undo/redo each; press Escape mid-drag; select a different item mid-drag.
- New unit tests:
  - `beginDrag` returns `null` for each refusal case;
  - a handle goes inert after `end`, `cancel` or a replacing `beginDrag`;
  - selecting the dragged item keeps the drag, and selecting anything else cancels it, for every kind (one table-driven test);
  - one history entry per completed drag, and none after `cancel`.

## Acceptance

- No `begin|move|change|end|cancel(Camera|CameraKey|Image|Actor|Audio|Action)Drag` members on `SceneEditorDocument`.
- No `this.cancel…Drag()` lists remain; the cancel rule lives in `setSelection`.
- `SceneEditorDocument` has no one-line delegates to a `*Commands` module.
- Public member count is roughly halved. Record the before and after counts here.
- Full test suite passes.

## Outcome (2026-11-18)

- Public members of `SceneEditorDocument`: **147 before, 105 after** (29% fewer; file 1060 → 942 lines). Counted as distinct non-private member names, so a get/set pair counts once. The plan's estimate started from about 130, and removing the 24 drag methods and 27 delegates while adding `beginDrag`, `cancelDrag` and five handles cannot halve 147. Halving would also need the next candidates moved into handles: Actor commands (`addActor`, `updateActor`, `setActorAppearance`, `duplicateActor`, `removeActor`, `reorderActor`, `actorReferences`), action commands (`addAction`, `updateAction`, `removeAction`, `duplicateAction`) and ground-contact state (about 10 members).
- Cancel rule: `SceneEditorGestures.keepFor(next)`, called from `setSelection`, keeps the active gesture only when `next` selects its target: the same Actor, image, audio clip or transition; the primary (last) selected action; the camera with no key; or the same camera key.
- Decision: `setCameraOverlays` and `setLayerLocked` cancel **every** gesture, like `setCameraPreview`. Both change what may be dragged on the stage, so no drag should outlive them.
- Gesture finishing moved into the command modules through a `finishGestures(unlessDragging?)` callback. For example, `artwork.updateImage` finishes other gestures unless an image drag is active, and `camera.updateCameraKey` unless a camera-key drag is active. As a result, `addImage` and `updateImage` now also commit an active audio drag; before, they skipped that one kind.
- `beginDrag` always cancels the active drag first, including when it then refuses (a locked image used to leave it running).
- The stage and timeline keep the handles of the drags they start, and cancel only those drags on pointer cancel, blur, scroll, preview and unmount.
