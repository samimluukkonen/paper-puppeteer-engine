# Architecture candidate 03 — Selection as one union per editor

Continue developing Paper Puppeteer Engine.

Source: architecture review 2026-11-14 (candidate 3), revised 2026-11-17 after checking the call sites.

## Problem

Each editor stores its selection as several independent fields and keeps them consistent by hand in every
`select*` method.

- **Scene editor**: `SceneEntry` (`src/devtools/scene-editor/SceneEditorDocument.ts:52`) holds `cameraSelected`,
  `selectedCameraKey`, `selectedImage`, `selectedActor`, `selectedAction`, `selectedActions`,
  `selectedTransition`, `selectedAudioClip` and `selectedDialogueLine`. Seven methods reset the other fields by
  hand: `selectCamera` (:445), `selectImage` (:569), `selectActor` (:627), `selectDialogueLine` (:872),
  `selectAudioClip` (:894), `selectTransition` (:943) and `selectAction` (:962). Adding a kind means editing every
  method body, and nothing stops an invalid combination of fields.
- **Rig editor**: `RigEditorState` already has a tagged union, `selection: { type: 'bone' | 'slot'; id }`. IK
  constraints and foot-contact markers are kept in separate fields, `selectedIKConstraintId` and
  `selectedFootContactMarkerId` (:132–133). `selectIKConstraint` (:1025), `selectBone` (:1261), `selectSlot` (:1268)
  and `clearSelection` (:1276) each reset the other two. `selectFootContactMarker` (:1090) already delegates to
  `clearSelection`.

The hand-written resets have also let bugs in (see "Bugs fixed here").

## Why not a shared `ExclusiveSelection<Kind>` module

The original version of this plan proposed one shared module with `select(kind, id, additive)` and
`current(): {kind, id}`. This revision rejects it for two reasons:

- Selecting an action also selects its actor (:985), and actions form a set with a primary item. A single
  `{kind, id}` can't represent that.
- Nothing differs between the two editors, so the shared module would be a helper, not a real seam. Deleting it
  would remove about 15 lines. The real per-method complexity stays in the editors either way: existence checks,
  per-kind drag cancellation and notification.

Instead, each editor gets **one selection value whose type admits only legal states**, and one private setter
writes it. Adding a kind takes one new union variant plus its `select*` method.

## Decisions

- **The camera and actors are mutually exclusive.** Today `selectCamera(true)` keeps `selectedActor`, and
  **Frame Selected Actor** in the camera panel (`SceneCameraPanel.tsx:111`) depends on that: you select an actor,
  select the camera, then frame the actor. Once they're exclusive, framing takes an explicit target:
  `frameSelectedActor()` becomes `frameActor(id: string)`, and the camera panel gets an **actor dropdown** next to
  the button. The dropdown defaults to the first actor; an empty scene disables it. The dropdown's value is view
  state in the panel, not document selection.
- **Bugs are fixed in this change**, not carried over. Each fix gets a test that fails on the current code.

## Bugs fixed here

1. **Double notify.** `selectDialogueLine`, `selectAudioClip` and `selectTransition` call `selectActor(null)`,
   which notifies `'selection'`, and then notify again. Fix: each `select*` notifies exactly once, through
   `setSelection`.
2. **Toggling preview clears unrelated selection.** `setCameraPreview` calls `selectCamera(this.cameraSelected)`,
   so toggling preview while a dialogue line, audio clip or transition is selected deselects it. It also clears
   the selected camera key. Fix: `setCameraPreview` cancels gestures and the ground-guide drag as it does now, but
   leaves selection alone.
3. **Toggling key-edit mode drops the selected key.** `setCameraKeyEditing(enabled)` always calls `selectCamera()`,
   which clears `selectedCameraKey`, even when enabling key editing with a key already selected. Fix:
   `setCameraKeyEditing(true)` selects the camera only if it isn't selected already, so the key survives.
   `setCameraKeyEditing(false)` keeps the camera selected and clears the key. A key selection implies key-edit
   mode, as `selectCameraKey` already enforces.
4. **Deselecting the camera leaves a stale actor.** Under the old model, Escape (`SceneKeyboardController.ts:17`
   calls `selectCamera(false)`) with the camera and an actor co-selected left the actor selected, and the
   inspector (`SceneInspector.tsx:80`) then switched to that actor without the user selecting it. The exclusive
   model removes this: deselecting the camera sets the selection to `null`.

## What to build

### 1. Scene editor: `SceneSelection` union

Add a new pure module, `src/devtools/scene-editor/SceneSelection.ts`, with no Phaser or DOM dependencies:

```ts
export type SceneSelection =
  | null
  | { kind: 'actor'; id: string }
  | { kind: 'actions'; actorId: string; ids: readonly string[] } // non-empty; primary = ids.at(-1)
  | { kind: 'camera'; key: { property: CameraProperty; id: string } | null }
  | { kind: 'image'; id: string }
  | { kind: 'dialogue'; id: string }
  | { kind: 'audio'; id: string }
  | { kind: 'transition'; id: string };
```

It also gets pure helpers for the transitions that are currently spread across the methods:

- `toggleAction(selection, id, actorOf, additive): SceneSelection` handles additive add and remove, and sets the
  actor from the primary action. If an additive toggle removes the last action, the result is
  `{ kind: 'actor', id: <that actorId> }`, which matches today's "actor stays" behaviour.
- Read accessors for the getters: `selectedActorOf` (returns the id for `actor`, the `actorId` for `actions`, and
  `null` otherwise), `selectedActionIdsOf`, `cameraKeyOf` and `idOf(selection, kind)`.

Only add helpers that the current call sites need.

In `SceneEditorDocument`:

- Replace the nine selection fields on `SceneEntry` with `selection: SceneSelection`, defaulting to `null` in
  `register`. `cameraKeyEdit`, `cameraPreview` and `cameraOverlays` aren't selection state and stay as they are.
- Add a private `setSelection(next: SceneSelection): void` that assigns the value and calls
  `notify('selection')` once.
- Rewrite each `select*` method and `selectCameraKey` (:392) in this order: validate the id, cancel drags (keeping
  each method's current rules), then call `setSelection(...)`. Delete every manual field reset.
  - `selectCamera(true)` sets `{ kind: 'camera', key: null }` and clears the actor.
  - `selectCamera(false)` sets `null` if the camera is selected and does nothing otherwise.
  - `selectDialogueLine`, `selectAudioClip` and `selectTransition` stop calling `selectActor(null)`. They cancel
    the same drags directly and set their own variant.
- Keep the public getters' signatures and their filtering to ids that still exist. The getters are
  `selectedActorId`, `selectedActionId`, `selectedActionIds`, `selectedImageId`, `selectedDialogueLine`,
  `selectedAudioClip`, `selectedTransition`, `cameraSelected` and `selectedCameraKey`, and they now read from the
  union.
- Replace `frameSelectedActor()` with `frameActor(id)`. Add the actor dropdown to `SceneCameraPanel`, following the
  existing panel controls and docs/style-guide.md, and update `cinematicCamera.test.ts:159` to call
  `frameActor(id)`.

### 2. Rig editor: widen `RigEditorSelection`

- Extend the union with `{ type: 'ik'; id }` and `{ type: 'footContact'; id }`.
- Replace the `selectedIKConstraintId` and `selectedFootContactMarkerId` fields with read-only getters derived
  from `selection`. `RigIKPanel`, `FootContactMarkersPanel`, `RigEditorOverlay` and `RigWorkspaceController` read
  these fields but never assign them, so those readers don't change.
- `selectIKConstraint`, `selectFootContactMarker`, `selectBone`, `selectSlot` and `clearSelection` each become a
  single assignment to `selection`.
- `reconcileSelection` (:517) becomes one switch over `selection.type` that clears the selection when its bone,
  slot, IK constraint or marker no longer exists.
- Audit the 54 readers of `selection?.type`. Comparisons against `'bone'` or `'slot'` stay correct. Fix any code
  that assumes a non-null selection is always a bone or a slot, for example a ternary like
  `selection.type === 'bone' ? … : <slot branch>` (the index lookup in `reconcileSelection` is one).
- **Identity trap:** `inspectorTab` compares `inspectorSelection.selection === this.selection` (:130). Only assign
  a new object when the selection actually changes, and never rebuild `selection` inside a getter.

## Target semantics (each row gets a test)

| Call | Effect |
| --- | --- |
| `selectActor(id)` | Selection becomes `actor` (or `null` when `id` is `null`). Cancels camera, image, audio and action drags; cancels the actor drag only if the id changes. Notifies once. |
| `selectImage(id)` | Selection becomes `image`. Cancels camera, actor, audio and action drags; cancels the image drag only if the id changes. Notifies once. |
| `selectDialogueLine`, `selectAudioClip`, `selectTransition(id)` | Selection becomes its own variant (or `null`). Cancels the same drags `selectActor(null)` cancels today. **Notifies once.** |
| `selectAction(id, additive)` | Non-additive: `actions [id]`. `id = null` steps back to the selected actor (`actor`) or `null`, which the Escape ladder action → actor → nothing relies on. Additive: toggles `id`; removing the last action leaves `actor`. The actor is the primary action's `actorId`. Notifies once. |
| `selectCamera(true)` | Selection becomes `camera` with `key: null`. **The actor is cleared.** Cancels all gestures. |
| `selectCamera(false)` | `null` if the camera is selected; otherwise no change. |
| `selectCameraKey(p, id)` | `camera` with `key` set, and `cameraKeyEdit = true`, if the key exists. |
| `setCameraKeyEditing(true)` | Selects the camera if it isn't selected; **keeps an existing key.** |
| `setCameraKeyEditing(false)` | Keeps the camera selected and clears the key. |
| `setCameraPreview(enabled)` | Cancels gestures and the ground-guide drag. **Selection doesn't change.** |
| `frameActor(id)` | Frames the actor `id` whatever the selection; returns `false` for an unknown id. |
| Escape (`SceneKeyboardController`) | With the camera selected, the selection becomes `null`; it no longer reveals a hidden actor. |
| Rig `select*` | Exactly one of bone, slot, IK constraint or marker is selected. `selectSlot` with a tab sets `inspectorSelection`. Invalid ids throw before any state changes. |

Rows in **bold** change behaviour on purpose. Every other row matches today's behaviour. Write tests for the
unchanged rows against the current code **before** refactoring so the refactor is checked against them.

## Constraints

- Behaviour stays the same everywhere except the bold rows above. Existing scene and rig editor tests pass, except
  where they assert a bug fixed here or camera and actor co-selection. Update those tests and list each one in
  the changelog.
- `SceneSelection.ts` is pure and unit-testable directly.
- No public getter signatures change. `frameSelectedActor()` → `frameActor(id)` is the only change to the public
  method surface.
- Follow existing style; run `npm run check:fix`.
- Add the changelog entry under **Unreleased**, since this plan has no version.

## Verification

- `npm run typecheck`, `npm run check`.
- `npm run test` sequentially with one worker (per AGENTS.md). The relevant suites include
  `sceneEditorDocument`, `sceneEditorGestures`, `cinematicCamera`, `sceneActorPlacement`, `sceneArtwork`,
  `sceneAudio`, `sceneDialogue`, `sceneTransitions`, `sceneTimeline`, `sceneGuides`, `rigEditorState`,
  `rigIKEditor`, `rigEditorOverlay`, `rigEditorNavigation` and `rigWorkspaceController`.
- New unit tests for `SceneSelection.ts`: action toggles (additive add and remove, the primary action setting the
  actor, removing the last action leaving the actor), camera select and deselect, and each accessor.
- A test per row of the semantics table. Each of bugs 1–4 gets a test that fails on the current code.
- A test that `selectCamera()` after `selectActor(id)` leaves `selectedActorId === null`.

## Acceptance

- `SceneEntry` has a single `selection` field. `RigEditorState` has a single `selection` field covering bone,
  slot, IK constraint and foot-contact marker.
- No `select*` method in either editor resets other selection fields by hand.
- Illegal combinations can't be represented in either type. That includes camera + actor and image + action.
- Adding a selectable kind takes one union variant plus its `select*` method, with no edits to other `select*`
  methods.
- Bugs 1–4 are fixed and each has a test. **Frame Selected Actor** works through the dropdown with the camera
  selected.
- All tests pass.
